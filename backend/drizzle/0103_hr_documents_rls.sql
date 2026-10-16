-- Generated legal documents (CD-167): vacation decisions now, travel orders in milestone 17.
-- See "Vacation decisions and the document engine (CD-167)" in docs/ARCHITECTURE.md.
ALTER TABLE "hr_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "hr_documents" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Live updates: a decision becoming ready, emailed, acknowledged or cancelled refreshes the
-- employee's time off screens (hint `timeoff`, ids are employee ids).
CREATE TRIGGER hr_documents_notify_ins AFTER INSERT ON "hr_documents" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER hr_documents_notify_upd AFTER UPDATE ON "hr_documents" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');
