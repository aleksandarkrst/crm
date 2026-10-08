-- Task dependencies (CD-269): "Waits for" points at another task of the same project. Deleting that
-- task clears only waits_for_task_id (PostgreSQL 15+). See "Tasks" in docs/ARCHITECTURE.md.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_waits_for_fk" FOREIGN KEY ("tenant_id","waits_for_task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE SET NULL ("waits_for_task_id");--> statement-breakpoint

-- The history records the dependency too.
DROP TRIGGER tasks_history ON "tasks";--> statement-breakpoint
CREATE TRIGGER tasks_history AFTER INSERT OR UPDATE OR DELETE ON "tasks" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'task', 'name', 'name:name', 'project_id:projectId', 'stage_id:stageId', 'status:status', 'on_hold_reason:onHoldReason', 'description:description',
  'start_date:startDate', 'due_date:dueDate', 'estimate_hours:estimateHours', 'waits_for_task_id:waitsForTaskId');
