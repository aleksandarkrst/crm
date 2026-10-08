-- A project's team (CD-271): row-level security, versions and live updates (hint `project`, with the
-- project's id, so screens showing the project read it again).
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_members" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER project_members_version BEFORE INSERT OR UPDATE ON "project_members" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER project_members_notify_ins AFTER INSERT ON "project_members" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project', 'project_id');--> statement-breakpoint
CREATE TRIGGER project_members_notify_upd AFTER UPDATE ON "project_members" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project', 'project_id');--> statement-breakpoint
CREATE TRIGGER project_members_notify_del AFTER DELETE ON "project_members" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project', 'project_id');
