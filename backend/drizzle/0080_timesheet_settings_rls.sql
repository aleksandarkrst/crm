-- Timesheet settings, public holidays and the deadline's flags (CD-153). See "Timesheet" in docs/ARCHITECTURE.md.
ALTER TABLE "public_holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public_holidays" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "public_holidays" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timesheet_weeks" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "timesheet_deadline_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_deadline_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timesheet_deadline_runs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Live updates: a holiday changes everyone's Timesheet (hint `holiday`); a week's flags its person's (`timesheet`).
CREATE TRIGGER public_holidays_notify_ins AFTER INSERT ON "public_holidays" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('holiday');--> statement-breakpoint
CREATE TRIGGER public_holidays_notify_upd AFTER UPDATE ON "public_holidays" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('holiday');--> statement-breakpoint
CREATE TRIGGER public_holidays_notify_del AFTER DELETE ON "public_holidays" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('holiday');--> statement-breakpoint
CREATE TRIGGER timesheet_weeks_notify_ins AFTER INSERT ON "timesheet_weeks" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timesheet_weeks_notify_upd AFTER UPDATE ON "timesheet_weeks" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');
