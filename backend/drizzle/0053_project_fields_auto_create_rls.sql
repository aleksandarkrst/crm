-- Project fields and "Create a project when a deal is won" (CD-233): what Drizzle can't express.
-- See "Projects" in docs/ARCHITECTURE.md.

-- ---------------------------------------------------------------- foreign keys
-- Deleting the project keeps the deal's row (the deal still never gets a second automatic project).
ALTER TABLE "project_auto_deals" ADD CONSTRAINT "project_auto_deals_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE SET NULL ("project_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cancel_reason_ck" CHECK ("cancel_reason" IS NULL OR "status" = 'cancelled');--> statement-breakpoint

-- ---------------------------------------------------------------- row-level security
ALTER TABLE "project_auto_deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_auto_deals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_auto_deals" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- ---------------------------------------------------------------- change history
-- The new fields join the project's history.
DROP TRIGGER projects_history ON "projects";--> statement-breakpoint
CREATE TRIGGER projects_history AFTER INSERT OR UPDATE OR DELETE ON "projects" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'project', 'name', 'name:name', 'project_type_id:projectTypeId', 'stage_id:stageId', 'status:status', 'cancel_reason:cancelReason', 'company_id:companyId',
  'deal_id:dealId', 'lead_user_id:leadUserId', 'code:code', 'description:description', 'start_date:startDate', 'end_date:endDate', 'health:health');
