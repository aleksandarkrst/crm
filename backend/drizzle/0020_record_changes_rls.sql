-- Change history (CD-69) and live updates (CD-20). Self-contained: functions, triggers and RLS.
--
-- DatabaseService.withTenant sets, per transaction, app.tenant_id (RLS), app.user_id (who acts)
-- and app.client_id (the browser tab, from X-Client-Id). The triggers below read them.

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_client() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.client_id', true), '') $$;
--> statement-breakpoint

-- record_changes is append-only for the app: it may read and add rows of its tenant, never change
-- or delete them (there is no UPDATE or DELETE policy).
ALTER TABLE "record_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_read ON "record_changes" FOR SELECT USING (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY tenant_append ON "record_changes" FOR INSERT WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- ---------------------------------------------------------------- versions (optimistic concurrency)
-- updated_at is the version clients send back in If-Match. The database sets it, in whole
-- milliseconds (so it survives a round trip through a JavaScript Date unchanged) and strictly
-- increasing per row, and the history rows of a change carry the same moment.
CREATE OR REPLACE FUNCTION crm_touch_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ts timestamptz := date_trunc('milliseconds', clock_timestamp());
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := greatest(ts, OLD.updated_at + interval '1 millisecond');
  ELSE
    NEW.updated_at := ts;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER deals_version BEFORE INSERT OR UPDATE ON "deals" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER companies_version BEFORE INSERT OR UPDATE ON "companies" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER contacts_version BEFORE INSERT OR UPDATE ON "contacts" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- ---------------------------------------------------------------- field history
-- Arguments: the entity type, the column that names the record, then "column:apiField" pairs of
-- the tracked fields. One row per changed field; creation and deletion get one row each.
CREATE OR REPLACE FUNCTION crm_record_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  entity text := TG_ARGV[0];
  name_col text := TG_ARGV[1];
  o jsonb;
  n jsonb;
  col text;
  i int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, label, actor_user_id, client_id, changed_at)
    VALUES (NEW.tenant_id, entity, NEW.id, 'created', to_jsonb(NEW) ->> name_col, app_current_user(), app_current_client(), NEW.updated_at);
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, label, actor_user_id, client_id, changed_at)
    VALUES (OLD.tenant_id, entity, OLD.id, 'deleted', to_jsonb(OLD) ->> name_col, app_current_user(), app_current_client(), date_trunc('milliseconds', clock_timestamp()));
    RETURN NULL;
  END IF;
  o := to_jsonb(OLD);
  n := to_jsonb(NEW);
  FOR i IN 2 .. TG_NARGS - 1 LOOP
    col := split_part(TG_ARGV[i], ':', 1);
    IF (o -> col) IS DISTINCT FROM (n -> col) THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, actor_user_id, client_id, changed_at)
      VALUES (NEW.tenant_id, entity, NEW.id, 'updated', split_part(TG_ARGV[i], ':', 2), o -> col, n -> col, app_current_user(), app_current_client(), NEW.updated_at);
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER deals_history AFTER INSERT OR UPDATE OR DELETE ON "deals" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'deal', 'title', 'title:title', 'funnel_id:funnelId', 'stage_id:stageId', 'company_id:companyId', 'primary_contact_id:primaryContactId',
  'owner_user_id:ownerUserId', 'source:source', 'amount:amount', 'currency:currency', 'close_date:closeDate', 'fit_score:fitScore',
  'headline:headline', 'discovery_need:need', 'discovery_constraint:constraint', 'decision_maker:decisionMaker', 'discovery_date:discoveryDate',
  'lost_reason:lostReason', 'lost_note:lostNote');--> statement-breakpoint
CREATE TRIGGER companies_history AFTER INSERT OR UPDATE OR DELETE ON "companies" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'company', 'name', 'name:name', 'industry:industry', 'hq:hq', 'team_size:teamSize', 'source:source', 'domain:domain',
  'owner_user_id:ownerUserId', 'notes:notes');--> statement-breakpoint
CREATE TRIGGER contacts_history AFTER INSERT OR UPDATE OR DELETE ON "contacts" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'contact', 'full_name', 'full_name:fullName', 'company_id:companyId', 'job_title:jobTitle', 'email:email', 'phone:phone',
  'linkedin:linkedin', 'buyer_role:buyerRole', 'owner_user_id:ownerUserId');--> statement-breakpoint

-- Deal lines are history of their deal: added, changed (only the fields that changed) and
-- removed, with the product's name at the time. Lines deleted together with their deal aren't
-- recorded (the deal's own "deleted" row says it).
CREATE OR REPLACE FUNCTION crm_line_json(r jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT jsonb_build_object('lineId', r -> 'id', 'productId', r -> 'product_id', 'quantity', r -> 'quantity', 'unitPrice', r -> 'unit_price',
    'vatRate', r -> 'vat_rate', 'schedule', r -> 'schedule', 'startDate', r -> 'start_date', 'months', r -> 'months', 'milestones', r -> 'milestones') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_record_line_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  o jsonb;
  n jsonb;
  old_diff jsonb := '{}';
  new_diff jsonb := '{}';
  k text;
  product text;
  ts timestamptz := date_trunc('milliseconds', clock_timestamp());
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM deals WHERE id = OLD.deal_id) THEN
      RETURN NULL;
    END IF;
    SELECT name INTO product FROM products WHERE id = OLD.product_id;
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, label, actor_user_id, client_id, changed_at)
    VALUES (OLD.tenant_id, 'deal', OLD.deal_id, 'line_removed', 'line', crm_line_json(to_jsonb(OLD)), product, app_current_user(), app_current_client(), ts);
    RETURN NULL;
  END IF;
  SELECT name INTO product FROM products WHERE id = NEW.product_id;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, new_value, label, actor_user_id, client_id, changed_at)
    VALUES (NEW.tenant_id, 'deal', NEW.deal_id, 'line_added', 'line', crm_line_json(to_jsonb(NEW)), product, app_current_user(), app_current_client(), ts);
    RETURN NULL;
  END IF;
  o := crm_line_json(to_jsonb(OLD));
  n := crm_line_json(to_jsonb(NEW));
  FOR k IN SELECT jsonb_object_keys(n) LOOP
    IF k <> 'lineId' AND (o -> k) IS DISTINCT FROM (n -> k) THEN
      old_diff := old_diff || jsonb_build_object(k, o -> k);
      new_diff := new_diff || jsonb_build_object(k, n -> k);
    END IF;
  END LOOP;
  IF new_diff <> '{}' THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, label, actor_user_id, client_id, changed_at)
    VALUES (NEW.tenant_id, 'deal', NEW.deal_id, 'line_changed', 'line', old_diff || jsonb_build_object('lineId', n -> 'lineId'), new_diff, product,
      app_current_user(), app_current_client(), ts);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER deal_lines_history AFTER INSERT OR UPDATE OR DELETE ON "deal_lines" FOR EACH ROW EXECUTE FUNCTION crm_record_line_changes();--> statement-breakpoint

-- ---------------------------------------------------------------- live updates (NOTIFY)
-- One notification per statement and tenant on channel crm_changes, sent when the transaction
-- commits (never for a rolled-back change). It carries hints only: the type, the ids (null when
-- more than 50 rows changed: "reload this list"), the deals they belong to, and the tab that made
-- the change. The API forwards it to that tenant's open event streams.
CREATE OR REPLACE FUNCTION crm_notify_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT x ->> 'tenant_id' AS tenant,
      count(DISTINCT x ->> 'id') AS n,
      (array_agg(DISTINCT x ->> 'id') FILTER (WHERE x ? 'id'))[1:50] AS ids,
      count(DISTINCT x ->> 'deal_id') AS nd,
      (array_agg(DISTINCT x ->> 'deal_id') FILTER (WHERE x ? 'deal_id'))[1:50] AS deals
    FROM (SELECT to_jsonb(c) AS x FROM changed_rows c) s
    GROUP BY 1
  LOOP
    PERFORM pg_notify('crm_changes', json_build_object(
      't', r.tenant,
      'type', TG_ARGV[0],
      'op', lower(TG_OP),
      'ids', CASE WHEN r.n > 50 THEN NULL ELSE to_json(coalesce(r.ids, '{}')) END,
      'dealIds', CASE WHEN r.nd > 50 THEN NULL ELSE to_json(coalesce(r.deals, '{}')) END,
      'client', app_current_client())::text);
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('deals', 'deal'), ('companies', 'company'), ('contacts', 'contact'), ('deal_contacts', 'deal_contact'), ('deal_lines', 'deal_line'),
    ('deal_tasks', 'task'), ('activities', 'activity'), ('products', 'product'), ('funnels', 'funnel'), ('funnel_stages', 'funnel')
  ) AS v(tbl, kind)
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes(%L)', t.tbl || '_notify_ins', t.tbl, t.kind);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes(%L)', t.tbl || '_notify_upd', t.tbl, t.kind);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes(%L)', t.tbl || '_notify_del', t.tbl, t.kind);
  END LOOP;
END
$$;
