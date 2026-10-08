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
CREATE TRIGGER work_orders_version BEFORE INSERT OR UPDATE ON "work_orders" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- Live updates: the Work orders page reads again (hint `work_order`).
CREATE TRIGGER work_orders_notify_ins AFTER INSERT ON "work_orders" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('work_order');--> statement-breakpoint
CREATE TRIGGER work_orders_notify_upd AFTER UPDATE ON "work_orders" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('work_order');--> statement-breakpoint
CREATE TRIGGER work_orders_notify_del AFTER DELETE ON "work_orders" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('work_order');--> statement-breakpoint
CREATE TRIGGER work_order_technicians_notify_ins AFTER INSERT ON "work_order_technicians" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('work_order', 'work_order_id');--> statement-breakpoint
CREATE TRIGGER work_order_technicians_notify_upd AFTER UPDATE ON "work_order_technicians" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('work_order', 'work_order_id');--> statement-breakpoint
CREATE TRIGGER work_order_technicians_notify_del AFTER DELETE ON "work_order_technicians" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('work_order', 'work_order_id');
