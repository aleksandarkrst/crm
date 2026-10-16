-- Sick leave records and their types (CD-169). See "Sick leave (CD-169)" in docs/ARCHITECTURE.md.
ALTER TABLE "sick_leave_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sick_leave_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sick_leave_types" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "sick_leaves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sick_leaves" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sick_leaves" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Versions and change history (spec 15.4), as for the requests (0100). The note and the sick note
-- reference stay out of the history: only Admins may read them.
CREATE TRIGGER sick_leave_types_version BEFORE INSERT OR UPDATE ON "sick_leave_types" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER sick_leaves_version BEFORE INSERT OR UPDATE ON "sick_leaves" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER sick_leave_types_history AFTER INSERT OR UPDATE OR DELETE ON "sick_leave_types" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'sick_leave_type', 'name', 'name:name', 'payer_note:payerNote', 'active:active');--> statement-breakpoint
CREATE TRIGGER sick_leaves_history AFTER INSERT OR UPDATE OR DELETE ON "sick_leaves" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'sick_leave', 'status', 'status:status', 'start_date:startDate', 'end_date:endDate', 'type_id:typeId', 'continuation_of_id:continuationOfId', 'cancel_reason:cancelReason');--> statement-breakpoint

-- Live updates: a record's change refreshes the employee's time off screens (hint `timeoff`).
CREATE TRIGGER sick_leaves_notify_ins AFTER INSERT ON "sick_leaves" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER sick_leaves_notify_upd AFTER UPDATE ON "sick_leaves" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER sick_leave_types_notify_ins AFTER INSERT ON "sick_leave_types" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_reason');--> statement-breakpoint
CREATE TRIGGER sick_leave_types_notify_upd AFTER UPDATE ON "sick_leave_types" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_reason');--> statement-breakpoint
CREATE TRIGGER sick_leave_types_notify_del AFTER DELETE ON "sick_leave_types" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_reason');--> statement-breakpoint

-- Every existing workspace gets the default types new ones are provisioned with (spec 13.3, A16).
INSERT INTO "sick_leave_types" ("tenant_id", "name", "payer_note", "position")
SELECT t."id", d.name, d.payer_note, d.position
FROM "tenants" t
CROSS JOIN (VALUES
  ('Illness or injury outside work', '65%. Employer for the first 30 days, then RFZO.', 1),
  ('Injury at work or occupational disease', '100%. Payer to confirm.', 2),
  ('Pregnancy related', '100%. RFZO from the first day.', 3),
  ('Care of a family member', '65%. RFZO from the first day in some cases, otherwise the employer for the first 30 days.', 4),
  ('Other legal ground', 'As per the sick note (e.g. organ donation, isolation).', 5)
) AS d(name, payer_note, position)
ON CONFLICT DO NOTHING;
