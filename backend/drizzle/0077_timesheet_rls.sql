-- Timesheet (CD-152). See "Timesheet (milestone 15)" in docs/ARCHITECTURE.md.
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "time_entries" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "timesheet_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_days" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timesheet_days" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "timesheet_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timesheet_rows" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- The lock on time entries, whichever code writes them (spec 5.3 T8, 9.1; CD-148; CD-277). An
-- entry can't be added, changed or removed when its day is Submitted or Approved, its work order is
-- Completed, its task is Done or its task's project is closed. The checks run for the row before
-- (update, delete) and after (insert, update), so an entry can't be moved out of a locked day
-- either. They raise check_violation naming the rule; the API maps each one (errors.ts). Deleting
-- the employee takes their entries along (FK cascade): the employee is gone by then and nothing is
-- checked. The trigger runs as the caller, so row-level security applies to its lookups.
CREATE OR REPLACE FUNCTION time_entries_check_lock(e time_entries) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  day_status text;
BEGIN
  SELECT status INTO day_status FROM timesheet_days WHERE tenant_id = e.tenant_id AND employee_id = e.employee_id AND work_date = e.work_date;
  IF day_status = 'submitted' THEN
    RAISE EXCEPTION 'This day is submitted. Recall it to change its hours.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_day_submitted', TABLE = 'time_entries';
  ELSIF day_status = 'approved' THEN
    RAISE EXCEPTION 'Day is approved and locked'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_day_approved', TABLE = 'time_entries';
  END IF;
  IF e.work_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM work_orders w WHERE w.tenant_id = e.tenant_id AND w.id = e.work_order_id AND w.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'This work order is completed. Reopen it to change its time.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_work_order_completed', TABLE = 'time_entries';
  END IF;
  IF e.task_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM tasks t JOIN projects p ON p.tenant_id = t.tenant_id AND p.id = t.project_id
    WHERE t.tenant_id = e.tenant_id AND t.id = e.task_id AND p.status <> 'open'
  ) THEN
    RAISE EXCEPTION 'Project is closed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_project_closed', TABLE = 'time_entries';
  END IF;
  IF e.task_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM tasks t WHERE t.tenant_id = e.tenant_id AND t.id = e.task_id AND t.status = 'done'
  ) THEN
    RAISE EXCEPTION 'This task is done. Reopen it to change its time.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_task_done', TABLE = 'time_entries';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION time_entries_lock() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    -- A cascade from deleting the employee: nothing to protect any more.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM employees WHERE tenant_id = OLD.tenant_id AND id = OLD.employee_id) THEN
      RETURN OLD;
    END IF;
    PERFORM time_entries_check_lock(OLD);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM time_entries_check_lock(NEW);
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER time_entries_lock BEFORE INSERT OR UPDATE OR DELETE ON "time_entries" FOR EACH ROW EXECUTE FUNCTION time_entries_lock();--> statement-breakpoint

-- Live updates: hint `timesheet` with the employee's id; the Timesheet, the task's People and hours
-- card and the work order page read again through the permission-checked API.
CREATE TRIGGER time_entries_notify_ins AFTER INSERT ON "time_entries" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');--> statement-breakpoint
CREATE TRIGGER time_entries_notify_upd AFTER UPDATE ON "time_entries" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');--> statement-breakpoint
CREATE TRIGGER time_entries_notify_del AFTER DELETE ON "time_entries" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timesheet_days_notify_ins AFTER INSERT ON "timesheet_days" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timesheet_days_notify_upd AFTER UPDATE ON "timesheet_days" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timesheet_days_notify_del AFTER DELETE ON "timesheet_days" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timesheet_rows_notify_ins AFTER INSERT ON "timesheet_rows" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timesheet_rows_notify_del AFTER DELETE ON "timesheet_rows" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');
