-- Hour limit alerts (CD-149). See "Effective time and hour limits" in docs/ARCHITECTURE.md.
ALTER TABLE "task_limit_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_limit_alerts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "task_limit_alerts" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
