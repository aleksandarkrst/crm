-- Row-level security for the deal lines and stage to-dos (same policy as 0001_rls.sql).

ALTER TABLE "deal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "deal_lines" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "deal_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "deal_tasks" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
