-- Project types, stages and projects (CD-272, CD-233): what Drizzle can't express, and the default
-- project type for every existing workspace. See "Projects" in docs/ARCHITECTURE.md.

-- ---------------------------------------------------------------- foreign keys
-- ON DELETE SET NULL (column) nulls only deal_id (PostgreSQL 15+): deleting a deal keeps its
-- projects and clears the link.
ALTER TABLE "projects" ADD CONSTRAINT "projects_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE SET NULL ("deal_id");--> statement-breakpoint

-- ---------------------------------------------------------------- row-level security
ALTER TABLE "project_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_types" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "project_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_stages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_stages" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "projects" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- ---------------------------------------------------------------- the default project type
-- Every existing workspace gets "Client project" (Planning, In progress, Review), as new ones do
-- (ProjectTypesService.provision). With app.tenant_id set per workspace so RLS admits the rows.
DO $$
DECLARE
  t record;
  type_id uuid;
BEGIN
  FOR t IN SELECT id FROM tenants ORDER BY id LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    IF NOT EXISTS (SELECT 1 FROM project_types WHERE tenant_id = t.id) THEN
      INSERT INTO project_types (tenant_id, name, position) VALUES (t.id, 'Client project', 0) RETURNING id INTO type_id;
      INSERT INTO project_stages (tenant_id, project_type_id, name, position)
      VALUES (t.id, type_id, 'Planning', 0), (t.id, type_id, 'In progress', 1), (t.id, type_id, 'Review', 2);
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- versions (If-Match)
CREATE TRIGGER project_types_version BEFORE INSERT OR UPDATE ON "project_types" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER project_stages_version BEFORE INSERT OR UPDATE ON "project_stages" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER projects_version BEFORE INSERT OR UPDATE ON "projects" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- ---------------------------------------------------------------- change history
CREATE TRIGGER projects_history AFTER INSERT OR UPDATE OR DELETE ON "projects" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'project', 'name', 'name:name', 'project_type_id:projectTypeId', 'stage_id:stageId', 'status:status', 'company_id:companyId', 'deal_id:dealId',
  'lead_user_id:leadUserId');--> statement-breakpoint

-- ---------------------------------------------------------------- live updates
CREATE TRIGGER project_types_notify_ins AFTER INSERT ON "project_types" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project_type');--> statement-breakpoint
CREATE TRIGGER project_types_notify_upd AFTER UPDATE ON "project_types" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project_type');--> statement-breakpoint
CREATE TRIGGER project_types_notify_del AFTER DELETE ON "project_types" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project_type');--> statement-breakpoint
CREATE TRIGGER project_stages_notify_ins AFTER INSERT ON "project_stages" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project_type');--> statement-breakpoint
CREATE TRIGGER project_stages_notify_upd AFTER UPDATE ON "project_stages" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project_type');--> statement-breakpoint
CREATE TRIGGER project_stages_notify_del AFTER DELETE ON "project_stages" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project_type');--> statement-breakpoint
CREATE TRIGGER projects_notify_ins AFTER INSERT ON "projects" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project');--> statement-breakpoint
CREATE TRIGGER projects_notify_upd AFTER UPDATE ON "projects" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project');--> statement-breakpoint
CREATE TRIGGER projects_notify_del AFTER DELETE ON "projects" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('project');
