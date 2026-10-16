-- Vacation balance adjustments, recorded expiries and the time off notices (CD-164).
-- See "Time off (milestone 16)" in docs/ARCHITECTURE.md.

-- Adjustments are append-only for the app (spec 6.4): read and add, never change or delete (no
-- UPDATE or DELETE policy), as record_changes (0020_record_changes_rls.sql).
ALTER TABLE "vacation_balance_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vacation_balance_adjustments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_read ON "vacation_balance_adjustments" FOR SELECT USING (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY tenant_append ON "vacation_balance_adjustments" FOR INSERT WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "vacation_balance_expiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vacation_balance_expiries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "vacation_balance_expiries" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "timeoff_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timeoff_notices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timeoff_notices" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Live updates: an adjustment or a recorded expiry changes the employee's balance (hint `timeoff`, ids are employee ids).
CREATE TRIGGER vacation_balance_adjustments_notify_ins AFTER INSERT ON "vacation_balance_adjustments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER vacation_balance_expiries_notify_ins AFTER INSERT ON "vacation_balance_expiries" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');
