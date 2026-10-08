-- A task's checklist, comments and files (CD-270). See "Tasks" in docs/ARCHITECTURE.md.

-- A project file added to a task: deleting the task keeps the file in the project and clears the link.
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE SET NULL ("task_id");--> statement-breakpoint

ALTER TABLE "task_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_checklist_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "task_checklist_items" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_comments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "task_comments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

CREATE TRIGGER task_checklist_items_version BEFORE INSERT OR UPDATE ON "task_checklist_items" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER task_comments_version BEFORE INSERT OR UPDATE ON "task_comments" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- Live updates: both report their task (hint `task`), so an open task page reads them again.
CREATE TRIGGER task_checklist_items_notify_ins AFTER INSERT ON "task_checklist_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task', 'task_id');--> statement-breakpoint
CREATE TRIGGER task_checklist_items_notify_upd AFTER UPDATE ON "task_checklist_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task', 'task_id');--> statement-breakpoint
CREATE TRIGGER task_checklist_items_notify_del AFTER DELETE ON "task_checklist_items" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task', 'task_id');--> statement-breakpoint
CREATE TRIGGER task_comments_notify_ins AFTER INSERT ON "task_comments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task', 'task_id');--> statement-breakpoint
CREATE TRIGGER task_comments_notify_upd AFTER UPDATE ON "task_comments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task', 'task_id');--> statement-breakpoint
CREATE TRIGGER task_comments_notify_del AFTER DELETE ON "task_comments" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('task', 'task_id');
