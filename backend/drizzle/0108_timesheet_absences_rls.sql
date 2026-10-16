-- Absences in the timesheet (CD-170). See "Time off in the timesheet (CD-170)" in docs/ARCHITECTURE.md.
ALTER TABLE "timesheet_absences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_absences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timesheet_absences" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Live updates: an absence line changes the person's timesheet (hint `timesheet`, ids are employee ids).
CREATE TRIGGER timesheet_absences_notify_ins AFTER INSERT ON "timesheet_absences" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timesheet_absences_notify_upd AFTER UPDATE ON "timesheet_absences" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timesheet_absences_notify_del AFTER DELETE ON "timesheet_absences" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timesheet', 'employee_id');
