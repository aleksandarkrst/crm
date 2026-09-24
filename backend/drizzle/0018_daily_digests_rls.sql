-- Row-level security for the daily digest log (same policy as 0001_rls.sql).

ALTER TABLE "daily_digests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_digests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "daily_digests" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
