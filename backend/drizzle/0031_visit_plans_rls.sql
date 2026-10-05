-- Visit plans (CD-134): row-level security (same policy as 0001_rls.sql), versions for If-Match,
-- change history and live updates (see 0020_record_changes_rls.sql).

ALTER TABLE "visit_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visit_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "visit_plans" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "visit_plan_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visit_plan_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "visit_plan_lines" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- updated_at is the version clients send back in If-Match (CD-20). Saving a plan's lines touches
-- the plan too, so its version moves with every change.
CREATE TRIGGER visit_plans_version BEFORE INSERT OR UPDATE ON "visit_plans" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- Field history of the plan itself. The period's first day names it on "created" and "deleted".
CREATE TRIGGER visit_plans_history AFTER INSERT OR UPDATE OR DELETE ON "visit_plans" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'visit_plan', 'period_start', 'salesperson_user_id:salespersonUserId', 'period_type:periodType', 'period_start:periodStart', 'note:note');--> statement-breakpoint

-- Plan lines are history of their plan, like deal lines of their deal: added, changed (planned
-- visits) and removed, labelled with the company's name at the time. Lines deleted together with
-- their plan aren't recorded (the plan's own "deleted" row says it).
CREATE OR REPLACE FUNCTION crm_record_visit_plan_line_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  company text;
  ts timestamptz := date_trunc('milliseconds', clock_timestamp());
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM visit_plans WHERE id = OLD.plan_id) THEN
      RETURN NULL;
    END IF;
    SELECT name INTO company FROM companies WHERE id = OLD.company_id;
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, label, actor_user_id, client_id, changed_at)
    VALUES (OLD.tenant_id, 'visit_plan', OLD.plan_id, 'line_removed', 'line',
      jsonb_build_object('lineId', OLD.id, 'companyId', OLD.company_id, 'plannedVisits', OLD.planned_visits), company, app_current_user(), app_current_client(), ts);
    RETURN NULL;
  END IF;
  SELECT name INTO company FROM companies WHERE id = NEW.company_id;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, new_value, label, actor_user_id, client_id, changed_at)
    VALUES (NEW.tenant_id, 'visit_plan', NEW.plan_id, 'line_added', 'line',
      jsonb_build_object('lineId', NEW.id, 'companyId', NEW.company_id, 'plannedVisits', NEW.planned_visits), company, app_current_user(), app_current_client(), ts);
    RETURN NULL;
  END IF;
  IF OLD.planned_visits IS DISTINCT FROM NEW.planned_visits OR OLD.company_id IS DISTINCT FROM NEW.company_id THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, label, actor_user_id, client_id, changed_at)
    VALUES (NEW.tenant_id, 'visit_plan', NEW.plan_id, 'line_changed', 'line',
      jsonb_build_object('lineId', OLD.id, 'companyId', OLD.company_id, 'plannedVisits', OLD.planned_visits),
      jsonb_build_object('companyId', NEW.company_id, 'plannedVisits', NEW.planned_visits), company, app_current_user(), app_current_client(), ts);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER visit_plan_lines_history AFTER INSERT OR UPDATE OR DELETE ON "visit_plan_lines" FOR EACH ROW EXECUTE FUNCTION crm_record_visit_plan_line_changes();--> statement-breakpoint

-- Live updates: type "visit_plan" for both tables. Lines report their plan's id (crm_notify_changes'
-- id column, 0029_meetings_rls.sql), so a client re-reads the plans a hint names
-- (GET /api/crm/visit-plans?ids=).
CREATE TRIGGER visit_plans_notify_ins AFTER INSERT ON "visit_plans" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('visit_plan');--> statement-breakpoint
CREATE TRIGGER visit_plans_notify_upd AFTER UPDATE ON "visit_plans" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('visit_plan');--> statement-breakpoint
CREATE TRIGGER visit_plans_notify_del AFTER DELETE ON "visit_plans" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('visit_plan');--> statement-breakpoint
CREATE TRIGGER visit_plan_lines_notify_ins AFTER INSERT ON "visit_plan_lines" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('visit_plan', 'plan_id');--> statement-breakpoint
CREATE TRIGGER visit_plan_lines_notify_upd AFTER UPDATE ON "visit_plan_lines" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('visit_plan', 'plan_id');--> statement-breakpoint
CREATE TRIGGER visit_plan_lines_notify_del AFTER DELETE ON "visit_plan_lines" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('visit_plan', 'plan_id');
