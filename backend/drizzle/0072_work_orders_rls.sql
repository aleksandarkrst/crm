-- Work orders (CD-265). See "Work orders" in docs/ARCHITECTURE.md.
ALTER TABLE "work_order_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_order_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "work_order_counters" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "work_orders" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "work_order_technicians" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_order_technicians" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "work_order_technicians" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER work_orders_version BEFORE INSERT OR UPDATE ON "work_orders" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();
