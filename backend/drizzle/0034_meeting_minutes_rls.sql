-- Meeting minutes (CD-132): row-level security, the version trigger (If-Match), change history
-- on the meeting and live updates.

ALTER TABLE "meeting_minutes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_minutes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "meeting_minutes" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- updated_at is the version for If-Match, as on deals and meetings.
CREATE TRIGGER meeting_minutes_version BEFORE INSERT OR UPDATE ON "meeting_minutes" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- The internal minutes are history of their meeting (entity "meeting", fields summary, agreements
-- and nextSteps), so the meeting's History tab shows them and an If-Match edit of the minutes
-- conflicts like a meeting field (RecordHistoryService.assertNoConflict). The row is created when
-- someone first writes the minutes: what it is created with counts as changed from empty. Rows
-- deleted with their meeting aren't recorded (the meeting's "deleted" row says it). The external
-- text (CD-133) has its own send log.
CREATE OR REPLACE FUNCTION crm_record_minutes_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  o jsonb;
  n jsonb := to_jsonb(NEW);
  pair text;
  col text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    o := jsonb_build_object('summary', NULL, 'agreements', NULL, 'next_steps', '[]'::jsonb);
  ELSE
    o := to_jsonb(OLD);
  END IF;
  FOREACH pair IN ARRAY ARRAY['summary:summary', 'agreements:agreements', 'next_steps:nextSteps'] LOOP
    col := split_part(pair, ':', 1);
    IF (o -> col) IS DISTINCT FROM (n -> col) THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, actor_user_id, client_id, changed_at)
      VALUES (NEW.tenant_id, 'meeting', NEW.meeting_id, 'updated', split_part(pair, ':', 2), o -> col, n -> col, app_current_user(), app_current_client(), NEW.updated_at);
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER meeting_minutes_history AFTER INSERT OR UPDATE ON "meeting_minutes" FOR EACH ROW EXECUTE FUNCTION crm_record_minutes_changes();--> statement-breakpoint

-- Live updates: minutes report their meeting (type "meeting"), so the browser re-reads it; its
-- minutesUpdatedAt tells an open minutes tab to read the minutes again.
CREATE TRIGGER meeting_minutes_notify_ins AFTER INSERT ON "meeting_minutes" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('meeting', 'meeting_id');--> statement-breakpoint
CREATE TRIGGER meeting_minutes_notify_upd AFTER UPDATE ON "meeting_minutes" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('meeting', 'meeting_id');
