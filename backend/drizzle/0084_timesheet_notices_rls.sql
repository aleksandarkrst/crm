-- Timesheet emails (CD-154). See "Timesheet" in docs/ARCHITECTURE.md.
ALTER TABLE "timesheet_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_notices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timesheet_notices" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
