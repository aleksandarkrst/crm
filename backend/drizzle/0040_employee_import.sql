-- Employee import (CD-141). Two transaction-local switches the import sets with set_config(…, true):
--
-- * app.change_action = 'imported': the history row of a created record says "imported" instead of
--   "created" (spec 8.7: "History records each created employee as Imported"). Only the INSERT
--   branch reads it; updates and deletes are recorded as before.
-- * app.quiet_notify = 'on': no live-update hints for the statements of that transaction. The
--   import's last transaction sends one "re-read the list" hint per type instead (spec 8.7).
--
-- Unset (every other write path), both functions behave exactly as before (0020, 0029).

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
    VALUES (NEW.tenant_id, entity, NEW.id, coalesce(NULLIF(current_setting('app.change_action', true), ''), 'created'), to_jsonb(NEW) ->> name_col,
      app_current_user(), app_current_client(), NEW.updated_at);
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
CREATE OR REPLACE FUNCTION crm_notify_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r record;
  id_col text := coalesce(TG_ARGV[1], 'id');
BEGIN
  IF current_setting('app.quiet_notify', true) = 'on' THEN
    RETURN NULL;
  END IF;
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
