-- A project's files (CD-271): row-level security, versions and live updates (hint `project`, with
-- the project's id).
ALTER TABLE "project_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_files" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER project_files_version BEFORE INSERT OR UPDATE ON "project_files" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER project_files_notify_ins AFTER INSERT ON "project_files" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project', 'project_id');--> statement-breakpoint
CREATE TRIGGER project_files_notify_upd AFTER UPDATE ON "project_files" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project', 'project_id');--> statement-breakpoint
CREATE TRIGGER project_files_notify_del AFTER DELETE ON "project_files" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project', 'project_id');
