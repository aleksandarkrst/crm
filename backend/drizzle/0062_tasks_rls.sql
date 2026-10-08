-- Project tasks (CD-146): what Drizzle can't express. See "Tasks" in docs/ARCHITECTURE.md.

-- ---------------------------------------------------------------- foreign keys
-- A task's stage is one of its project type's stages (TasksService checks the type). Deleting the
-- stage clears only stage_id (PostgreSQL 15+); the task stays in its project.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_stage_fk" FOREIGN KEY ("tenant_id","stage_id") REFERENCES "public"."project_stages"("tenant_id","id") ON DELETE SET NULL ("stage_id");--> statement-breakpoint

-- ---------------------------------------------------------------- row-level security
ALTER TABLE "task_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "task_counters" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tasks" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "task_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "task_assignments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- ---------------------------------------------------------------- versions (If-Match)
CREATE TRIGGER tasks_version BEFORE INSERT OR UPDATE ON "tasks" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER task_assignments_version BEFORE INSERT OR UPDATE ON "task_assignments" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- ---------------------------------------------------------------- change history
CREATE TRIGGER tasks_history AFTER INSERT OR UPDATE OR DELETE ON "tasks" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'task', 'name', 'name:name', 'project_id:projectId', 'stage_id:stageId', 'status:status', 'on_hold_reason:onHoldReason', 'description:description',
  'start_date:startDate', 'due_date:dueDate', 'estimate_hours:estimateHours');--> statement-breakpoint

-- Assignees are history of their task, like a meeting's participants (0029): added (a new row, or
-- `active` back on) and removed (`active` off), with the person's name. The ones a task is created
-- with belong to its "created" row (the task's created_at is now(), the start of this
-- transaction). Rows deleted with their task or employee aren't recorded.
CREATE OR REPLACE FUNCTION projects_record_assignment_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ts timestamptz := date_trunc('milliseconds', clock_timestamp());
  task_created timestamptz;
  person text;
  act text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT created_at INTO task_created FROM tasks WHERE id = NEW.task_id;
    IF task_created = now() THEN
      RETURN NULL;
    END IF;
    act := 'participant_added';
  ELSIF OLD.active IS DISTINCT FROM NEW.active THEN
    act := CASE WHEN NEW.active THEN 'participant_added' ELSE 'participant_removed' END;
  ELSE
    RETURN NULL;
  END IF;
  SELECT full_name INTO person FROM employees WHERE id = NEW.employee_id;
  INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, new_value, old_value, label, actor_user_id, client_id, changed_at)
  VALUES (NEW.tenant_id, 'task', NEW.task_id, act, 'assignees',
    CASE WHEN act = 'participant_added' THEN jsonb_build_object('employeeId', NEW.employee_id, 'name', person) END,
    CASE WHEN act = 'participant_removed' THEN jsonb_build_object('employeeId', NEW.employee_id, 'name', person) END,
    person, app_current_user(), app_current_client(), ts);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER task_assignments_history AFTER INSERT OR UPDATE ON "task_assignments" FOR EACH ROW EXECUTE FUNCTION projects_record_assignment_changes();--> statement-breakpoint

-- ---------------------------------------------------------------- live updates
-- Hint `task` with the task ids; assignees report their task.
CREATE TRIGGER tasks_notify_ins AFTER INSERT ON "tasks" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task');--> statement-breakpoint
CREATE TRIGGER tasks_notify_upd AFTER UPDATE ON "tasks" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task');--> statement-breakpoint
CREATE TRIGGER tasks_notify_del AFTER DELETE ON "tasks" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task');--> statement-breakpoint
CREATE TRIGGER task_assignments_notify_ins AFTER INSERT ON "task_assignments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task', 'task_id');--> statement-breakpoint
CREATE TRIGGER task_assignments_notify_upd AFTER UPDATE ON "task_assignments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task', 'task_id');--> statement-breakpoint
CREATE TRIGGER task_assignments_notify_del AFTER DELETE ON "task_assignments" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task', 'task_id');
