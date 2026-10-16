-- Vacation policies, the employee's time off profile and the yearly entitlement (CD-163).
-- See "Time off (milestone 16)" in docs/ARCHITECTURE.md.
ALTER TABLE "timeoff_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timeoff_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timeoff_policies" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "timeoff_policy_experience_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timeoff_policy_experience_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timeoff_policy_experience_rules" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "employee_timeoff_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_timeoff_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_timeoff_profiles" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "vacation_entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vacation_entitlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "vacation_entitlements" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Versions (updated_at, set by the database), as on deals (0020_record_changes_rls.sql).
CREATE TRIGGER timeoff_policies_version BEFORE INSERT OR UPDATE ON "timeoff_policies" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER employee_timeoff_profiles_version BEFORE INSERT OR UPDATE ON "employee_timeoff_profiles" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER vacation_entitlements_version BEFORE INSERT OR UPDATE ON "vacation_entitlements" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- Change history (spec 5.6 AC4): who changed a policy, a profile or an entitlement, and when. A
-- policy's experience rows are written by the service as one "experienceRules" change.
CREATE TRIGGER timeoff_policies_history AFTER INSERT OR UPDATE OR DELETE ON "timeoff_policies" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'timeoff_policy', 'name', 'name:name', 'base_days:baseDays', 'max_days:maxDays', 'carry_over:carryOver', 'carry_over_cap:carryOverCap',
  'is_default:isDefault', 'note:note');--> statement-breakpoint
CREATE TRIGGER employee_timeoff_profiles_history AFTER INSERT OR UPDATE OR DELETE ON "employee_timeoff_profiles" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'timeoff_profile', 'employee_id', 'policy_id:policyId', 'prior_experience_months:priorExperienceMonths');--> statement-breakpoint
CREATE TRIGGER vacation_entitlements_history AFTER INSERT OR UPDATE OR DELETE ON "vacation_entitlements" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'vacation_entitlement', 'year', 'policy_id:policyId', 'base_days:baseDays', 'experience_years:experienceYears', 'experience_days:experienceDays',
  'individual_days:individualDays', 'individual_reason:individualReason', 'months_worked:monthsWorked', 'annual_days:annualDays', 'total_days:totalDays',
  'frozen:frozen');--> statement-breakpoint

-- Live updates: a policy change (hint `timeoff_policy`) re-reads Settings → Time off and open cards;
-- a profile or entitlement change (`timeoff`, ids are employee ids) the employee's card.
CREATE TRIGGER timeoff_policies_notify_ins AFTER INSERT ON "timeoff_policies" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_policy');--> statement-breakpoint
CREATE TRIGGER timeoff_policies_notify_upd AFTER UPDATE ON "timeoff_policies" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_policy');--> statement-breakpoint
CREATE TRIGGER timeoff_policies_notify_del AFTER DELETE ON "timeoff_policies" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_policy');--> statement-breakpoint
CREATE TRIGGER timeoff_policy_rules_notify_ins AFTER INSERT ON "timeoff_policy_experience_rules" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_policy', 'policy_id');--> statement-breakpoint
CREATE TRIGGER timeoff_policy_rules_notify_del AFTER DELETE ON "timeoff_policy_experience_rules" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff_policy', 'policy_id');--> statement-breakpoint
CREATE TRIGGER employee_timeoff_profiles_notify_ins AFTER INSERT ON "employee_timeoff_profiles" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER employee_timeoff_profiles_notify_upd AFTER UPDATE ON "employee_timeoff_profiles" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER vacation_entitlements_notify_ins AFTER INSERT ON "vacation_entitlements" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER vacation_entitlements_notify_upd AFTER UPDATE ON "vacation_entitlements" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint
CREATE TRIGGER vacation_entitlements_notify_del AFTER DELETE ON "vacation_entitlements" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('timeoff', 'employee_id');--> statement-breakpoint

-- Every existing workspace gets the default policy new ones are provisioned with (spec 5.2):
-- "Standard", 20 base days, no experience rows, carry-over on, no cap. Runs as the migration role,
-- so RLS doesn't apply; the history trigger records it as made by the system.
INSERT INTO "timeoff_policies" ("tenant_id", "name", "base_days", "carry_over", "is_default")
SELECT t."id", 'Standard', 20, true, true FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "timeoff_policies" p WHERE p."tenant_id" = t."id");
