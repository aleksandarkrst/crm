-- CD-15, CD-17, CD-77: row-level security for the new tables (same policy as 0001_rls.sql), and
-- existing products get their workspace's currency (the column default is only a fallback;
-- ProductsService gives new products the workspace currency).

ALTER TABLE "custom_field_defs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_defs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "custom_field_defs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "sales_bonus_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_bonus_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales_bonus_rules" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "sales_bonus_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_bonus_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales_bonus_settings" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- products forces RLS even for its owner, so the backfill lifts that for this statement.
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "products" p SET "currency" = t."currency" FROM "tenants" t WHERE t."id" = p."tenant_id" AND p."currency" <> t."currency";--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
