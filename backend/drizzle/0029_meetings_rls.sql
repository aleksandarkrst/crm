-- Meetings (CD-130): the foreign keys that null one column, row-level security, the version
-- trigger (If-Match), change history and live updates.

-- Deleting a deal keeps its meetings without a deal; deleting a contact keeps the participant row
-- (its name says who it was, shown as "(deleted)"). ON DELETE SET NULL (column) nulls only that
-- column (PostgreSQL 15+), never tenant_id, so it lives here rather than in the Drizzle schema.
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE SET NULL ("deal_id");--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE SET NULL ("contact_id");--> statement-breakpoint

ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meetings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "meetings" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "meeting_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_participants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "meeting_participants" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- updated_at is the version for If-Match, as on deals (see 0020_record_changes_rls.sql).
CREATE TRIGGER meetings_version BEFORE INSERT OR UPDATE ON "meetings" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- Field history of meetings, with the same function as deals, companies and contacts.
CREATE TRIGGER meetings_history AFTER INSERT OR UPDATE OR DELETE ON "meetings" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'meeting', 'title', 'title:title', 'type:type', 'starts_at:startsAt', 'ends_at:endsAt', 'location:location', 'agenda:agenda',
  'company_id:companyId', 'deal_id:dealId', 'organizer_user_id:organizerUserId', 'status:status', 'cancel_reason:cancelReason');--> statement-breakpoint

-- Participants are history of their meeting: added and removed, with the person's name. The ones
-- a meeting is created with belong to its "created" row (the meeting's created_at is now(), the
-- start of this transaction), and the ones deleted together with their meeting aren't recorded
-- (the meeting's "deleted" row says it). A contact's deletion (contact_id set to null) is not a
-- change of the meeting.
CREATE OR REPLACE FUNCTION crm_record_participant_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ts timestamptz := date_trunc('milliseconds', clock_timestamp());
  meeting_created timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM meetings WHERE id = OLD.meeting_id) THEN
      RETURN NULL;
    END IF;
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, label, actor_user_id, client_id, changed_at)
    VALUES (OLD.tenant_id, 'meeting', OLD.meeting_id, 'participant_removed', 'participants',
      jsonb_build_object('kind', OLD.kind, 'userId', OLD.user_id, 'contactId', OLD.contact_id, 'name', OLD.name), OLD.name,
      app_current_user(), app_current_client(), ts);
    RETURN NULL;
  END IF;
  SELECT created_at INTO meeting_created FROM meetings WHERE id = NEW.meeting_id;
  IF meeting_created = now() THEN
    RETURN NULL;
  END IF;
  INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, new_value, label, actor_user_id, client_id, changed_at)
  VALUES (NEW.tenant_id, 'meeting', NEW.meeting_id, 'participant_added', 'participants',
    jsonb_build_object('kind', NEW.kind, 'userId', NEW.user_id, 'contactId', NEW.contact_id, 'name', NEW.name), NEW.name,
    app_current_user(), app_current_client(), ts);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER meeting_participants_history AFTER INSERT OR DELETE ON "meeting_participants" FOR EACH ROW EXECUTE FUNCTION crm_record_participant_changes();--> statement-breakpoint

-- Live updates. crm_notify_changes gains an optional second argument: the column whose values are
-- the hint's ids (default "id"). Participants report their meeting, so the browser re-reads the
-- meetings by id. Otherwise the same function as in 0020_record_changes_rls.sql.
CREATE OR REPLACE FUNCTION crm_notify_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r record;
  id_col text := coalesce(TG_ARGV[1], 'id');
BEGIN
  FOR r IN
    SELECT x ->> 'tenant_id' AS tenant,
      count(DISTINCT x ->> id_col) AS n,
      (array_agg(DISTINCT x ->> id_col) FILTER (WHERE x ? id_col))[1:50] AS ids,
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
    ('meetings', 'meeting', 'id'), ('meeting_participants', 'meeting', 'meeting_id')
  ) AS v(tbl, kind, id_col)
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes(%L, %L)', t.tbl || '_notify_ins', t.tbl, t.kind, t.id_col);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes(%L, %L)', t.tbl || '_notify_upd', t.tbl, t.kind, t.id_col);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes(%L, %L)', t.tbl || '_notify_del', t.tbl, t.kind, t.id_col);
  END LOOP;
END
$$;
