-- Time off requests, their days, the paid leave and other absence reasons, and the holiday
-- preload record (CD-165). See "Time off (milestone 16)" in docs/ARCHITECTURE.md.
ALTER TABLE "public_holiday_preloads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public_holiday_preloads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "public_holiday_preloads" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "timeoff_reasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timeoff_reasons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timeoff_reasons" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "timeoff_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timeoff_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timeoff_requests" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "timeoff_request_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timeoff_request_days" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timeoff_request_days" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Versions and change history (spec 15.4), as for the policies (0096).
CREATE TRIGGER timeoff_reasons_version BEFORE INSERT OR UPDATE ON "timeoff_reasons" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER timeoff_requests_version BEFORE INSERT OR UPDATE ON "timeoff_requests" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER timeoff_reasons_history AFTER INSERT OR UPDATE OR DELETE ON "timeoff_reasons" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'timeoff_reason', 'name', 'name:name', 'max_days:maxDays', 'counts_toward_limit:countsTowardLimit', 'paid_by_employer:paidByEmployer', 'active:active');--> statement-breakpoint
CREATE TRIGGER timeoff_requests_history AFTER INSERT OR UPDATE OR DELETE ON "timeoff_requests" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'timeoff_request', 'type', 'status:status', 'start_date:startDate', 'end_date:endDate', 'working_days:workingDays', 'reason_id:reasonId', 'note:note',
  'decided_by_user_id:decidedByUserId', 'decision_comment:decisionComment', 'recorded:recorded', 'record_reason:recordReason');--> statement-breakpoint

-- Live updates: a request or its days change the employee's time off (hint `timeoff`, ids are
-- employee ids); a reason change re-reads Settings → Time off (`timeoff_reason`).
CREATE TRIGGER timeoff_requests_notify_ins AFTER INSERT ON "timeoff_requests" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timeoff_requests_notify_upd AFTER UPDATE ON "timeoff_requests" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timeoff_requests_notify_del AFTER DELETE ON "timeoff_requests" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timeoff_request_days_notify_ins AFTER INSERT ON "timeoff_request_days" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timeoff_request_days_notify_upd AFTER UPDATE ON "timeoff_request_days" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timeoff_request_days_notify_del AFTER DELETE ON "timeoff_request_days" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER timeoff_reasons_notify_ins AFTER INSERT ON "timeoff_reasons" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_reason');--> statement-breakpoint
CREATE TRIGGER timeoff_reasons_notify_upd AFTER UPDATE ON "timeoff_reasons" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_reason');--> statement-breakpoint
CREATE TRIGGER timeoff_reasons_notify_del AFTER DELETE ON "timeoff_reasons" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_reason');--> statement-breakpoint

-- Every existing workspace gets the default reasons new ones are provisioned with (spec 7.2, 7.3).
-- Runs as the migration role, so RLS doesn't apply; the history trigger records it as the system's.
INSERT INTO "timeoff_reasons" ("tenant_id", "kind", "name", "max_days", "counts_toward_limit", "paid_by_employer", "position")
SELECT t."id", d.kind, d.name, d.max_days, d.counts, d.paid, d.position
FROM "tenants" t
CROSS JOIN (VALUES
  ('paid_leave', 'Marriage', 5, true, true, 1),
  ('paid_leave', 'Birth of a child', 5, true, true, 2),
  ('paid_leave', 'Serious illness of a close family member', 5, true, true, 3),
  ('paid_leave', 'Death of a close family member', 5, false, true, 4),
  ('paid_leave', 'Blood donation', 2, false, true, 5),
  ('paid_leave', 'Religious holiday', 1, false, true, 6),
  ('paid_leave', 'Other, by company rules', 5, false, true, 7),
  ('other_absence', 'Maternity leave', NULL, false, false, 1),
  ('other_absence', 'Child care leave', NULL, false, false, 2),
  ('other_absence', 'Special child care leave', NULL, false, false, 3),
  ('other_absence', 'Military service', NULL, false, false, 4),
  ('other_absence', 'Other', NULL, false, false, 5)
) AS d(kind, name, max_days, counts, paid, position)
WHERE NOT EXISTS (SELECT 1 FROM "timeoff_reasons" r WHERE r."tenant_id" = t."id");
