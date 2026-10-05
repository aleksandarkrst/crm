-- People (milestone 13, CD-140): the foreign keys that null one column, row-level security,
-- search text, versions (If-Match), change history, live updates, and an employee record for every
-- existing member (spec 4.6). See "People: employees and org structure" in docs/ARCHITECTURE.md.

-- ---------------------------------------------------------------- foreign keys
-- ON DELETE SET NULL (column) nulls only that column (PostgreSQL 15+), never tenant_id.
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_fk" FOREIGN KEY ("tenant_id","manager_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE SET NULL ("manager_id");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE SET NULL ("department_id");--> statement-breakpoint
-- A team must belong to the employee's department: the key includes the department. Moving a team
-- to another department moves its members with it (ON UPDATE CASCADE); deleting a team leaves its
-- members in the department without a team.
ALTER TABLE "employees" ADD CONSTRAINT "employees_team_fk" FOREIGN KEY ("tenant_id","department_id","team_id") REFERENCES "public"."teams"("tenant_id","department_id","id") ON DELETE SET NULL ("team_id") ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_fk" FOREIGN KEY ("tenant_id","head_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE SET NULL ("head_employee_id");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_lead_fk" FOREIGN KEY ("tenant_id","lead_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE SET NULL ("lead_employee_id");--> statement-breakpoint
-- invitations has no RLS (platform table); the composite key still keeps the employee in the
-- invitation's workspace.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE SET NULL ("employee_id");--> statement-breakpoint
CREATE INDEX "teams_tenant_lead_idx" ON "teams" USING btree ("tenant_id","lead_employee_id");--> statement-breakpoint
CREATE INDEX "departments_tenant_head_idx" ON "departments" USING btree ("tenant_id","head_employee_id");--> statement-breakpoint

-- ---------------------------------------------------------------- row-level security
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "departments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "teams" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employees" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "employee_personal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_personal" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_personal" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "employee_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_roles" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- ---------------------------------------------------------------- search text
-- Accent-free lower case, so "petrovic" finds "Petrović" (spec 4.2). Accented letters are mapped
-- before lower() so it works in any database locale. The same table is in
-- modules/people/search.ts (normalizeForSearch) for code that searches in memory.
CREATE OR REPLACE FUNCTION people_fold(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT lower(translate(coalesce(value, ''),
    'ČĆŠĐŽčćšđžÁÀÄÂÃÅáàäâãåÉÈËÊĚéèëêěÍÌÏÎíìïîÓÒÖÔÕØŐóòöôõøőÚÙÜÛŮŰúùüûůűÝýÿÑŃŇñńňÇçĽĹŁľĺłŔŘŕřŚśŤťŹŻźżĎďĘęĄą',
    'CCSDZccsdzAAAAAAaaaaaaEEEEEeeeeeIIIIiiiiOOOOOOOoooooooUUUUUUuuuuuuYyyNNNnnnCcLLLlllRRrrSsTtZZzzDdEeAa')) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION people_set_search_text() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.search_text := people_fold(concat_ws(' ', NEW.first_name, NEW.last_name, NEW.job_title, NEW.work_email));
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER employees_search BEFORE INSERT OR UPDATE ON "employees" FOR EACH ROW EXECUTE FUNCTION people_set_search_text();--> statement-breakpoint

-- ---------------------------------------------------------------- versions (If-Match)
-- As on deals (0020_record_changes_rls.sql). The card has one version: employees.updated_at.
-- Saving personal details or the bank account touches the employee row too (PeopleService).
CREATE TRIGGER employees_version BEFORE INSERT OR UPDATE ON "employees" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER employee_personal_version BEFORE INSERT OR UPDATE ON "employee_personal" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER departments_version BEFORE INSERT OR UPDATE ON "departments" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER teams_version BEFORE INSERT OR UPDATE ON "teams" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- ---------------------------------------------------------------- change history
-- Entity types employee, department and team. GET /api/people/history serves them with the card's
-- rules; the CRM history endpoint never does.
CREATE TRIGGER employees_history AFTER INSERT OR UPDATE OR DELETE ON "employees" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'employee', 'full_name', 'first_name:firstName', 'last_name:lastName', 'work_email:workEmail', 'employee_number:employeeNumber',
  'job_title:jobTitle', 'department_id:departmentId', 'team_id:teamId', 'manager_id:managerId', 'work_phone:workPhone',
  'work_location:workLocation', 'employment_start_date:employmentStartDate', 'employment_type:employmentType', 'weekly_hours:weeklyHours',
  'timesheet_required:timesheetRequired', 'attendance_tracked:attendanceTracked', 'employment_end_date:employmentEndDate',
  'deactivated_at:deactivatedAt', 'leaving_reason:leavingReason', 'user_id:userId');--> statement-breakpoint
CREATE TRIGGER departments_history AFTER INSERT OR UPDATE OR DELETE ON "departments" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'department', 'name', 'name:name', 'code:code', 'head_employee_id:headEmployeeId');--> statement-breakpoint
CREATE TRIGGER teams_history AFTER INSERT OR UPDATE OR DELETE ON "teams" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'team', 'name', 'name:name', 'department_id:departmentId', 'lead_employee_id:leadEmployeeId');--> statement-breakpoint

-- Personal details and the bank account are history of their employee (entity 'employee'). The
-- IBANs are recorded only as their short mask ("RS35 •••• 1379", iban_masked), never sealed or
-- plain. Fields set when the row is created count as changes from empty; the row's deletion (with
-- its employee) is not recorded.
CREATE OR REPLACE FUNCTION people_record_personal_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  tracked text[] := ARRAY[
    'date_of_birth:dateOfBirth', 'private_email:privateEmail', 'private_phone:privatePhone', 'address_street:addressStreet',
    'address_postal_code:addressPostalCode', 'address_city:addressCity', 'address_country:addressCountry',
    'emergency_contact_name:emergencyContactName', 'emergency_contact_phone:emergencyContactPhone', 'iban_masked:iban',
    'bank_name:bankName', 'fx_same_as_iban:fxSameAsIban', 'fx_iban_masked:fxIban', 'swift_bic:swiftBic', 'fx_bank_name:fxBankName',
    'fx_bank_address:fxBankAddress'];
  pair text;
  col text;
  o jsonb;
  n jsonb := to_jsonb(NEW);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    o := to_jsonb(OLD);
  ELSE
    o := '{}'::jsonb;
  END IF;
  FOREACH pair IN ARRAY tracked LOOP
    col := split_part(pair, ':', 1);
    IF TG_OP = 'INSERT' AND (col = 'fx_same_as_iban' OR jsonb_typeof(n -> col) = 'null') THEN
      CONTINUE;
    END IF;
    IF coalesce(o -> col, 'null'::jsonb) IS DISTINCT FROM coalesce(n -> col, 'null'::jsonb) THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, actor_user_id, client_id, changed_at)
      VALUES (NEW.tenant_id, 'employee', NEW.employee_id, 'updated', split_part(pair, ':', 2), o -> col, n -> col, app_current_user(), app_current_client(), NEW.updated_at);
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER employee_personal_history AFTER INSERT OR UPDATE ON "employee_personal" FOR EACH ROW EXECUTE FUNCTION people_record_personal_changes();--> statement-breakpoint

-- ---------------------------------------------------------------- live updates
-- Hints carry ids only (crm_notify_changes, 0029_meetings_rls.sql); the browser re-reads through
-- the API, which applies the access rules. employee_personal sends none: saving it touches the
-- employee row, which does. Roles report their employee's id.
CREATE TRIGGER employees_notify_ins AFTER INSERT ON "employees" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('employee');--> statement-breakpoint
CREATE TRIGGER employees_notify_upd AFTER UPDATE ON "employees" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('employee');--> statement-breakpoint
CREATE TRIGGER employees_notify_del AFTER DELETE ON "employees" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('employee');--> statement-breakpoint
CREATE TRIGGER departments_notify_ins AFTER INSERT ON "departments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('department');--> statement-breakpoint
CREATE TRIGGER departments_notify_upd AFTER UPDATE ON "departments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('department');--> statement-breakpoint
CREATE TRIGGER departments_notify_del AFTER DELETE ON "departments" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('department');--> statement-breakpoint
CREATE TRIGGER teams_notify_ins AFTER INSERT ON "teams" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('team');--> statement-breakpoint
CREATE TRIGGER teams_notify_upd AFTER UPDATE ON "teams" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('team');--> statement-breakpoint
CREATE TRIGGER teams_notify_del AFTER DELETE ON "teams" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('team');--> statement-breakpoint
CREATE TRIGGER employee_roles_notify_ins AFTER INSERT ON "employee_roles" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('employee_role', 'employee_id');--> statement-breakpoint
CREATE TRIGGER employee_roles_notify_upd AFTER UPDATE ON "employee_roles" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('employee_role', 'employee_id');--> statement-breakpoint
CREATE TRIGGER employee_roles_notify_del AFTER DELETE ON "employee_roles" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('employee_role', 'employee_id');--> statement-breakpoint

-- ---------------------------------------------------------------- an employee for every member
-- Spec 4.6, rule 3 and the migration: a new employee record from the member's profile, linked to
-- them. Names come from the display name split at the last space; a one-word name is the last
-- name and the first name is the email's local part (no name at all: both are the local part).
-- Work email = sign-in email, unless another employee of the workspace already has it. Job title
-- and phone are copied from the profile; employment type Permanent, weekly hours from the
-- workspace setting, no department, manager or start date. Returns the existing record's id when
-- the member already has one. Runs as the caller, with app.tenant_id set to p_tenant (RLS).
-- Used by the people module (linking.ts) when someone joins or creates a workspace.
CREATE OR REPLACE FUNCTION people_create_member_employee(p_tenant uuid, p_user uuid) RETURNS uuid
  LANGUAGE plpgsql
  AS $$
DECLARE
  existing uuid;
  u record;
  dn text;
  local_part text;
  first_n text;
  last_n text;
  mail text;
  hours smallint;
  new_id uuid;
BEGIN
  SELECT id INTO existing FROM employees WHERE tenant_id = p_tenant AND user_id = p_user;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;
  SELECT email, display_name, job_title, phone INTO u FROM users WHERE id = p_user;
  dn := nullif(btrim(regexp_replace(coalesce(u.display_name, ''), '\s+', ' ', 'g')), '');
  local_part := coalesce(nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Member');
  IF dn IS NULL THEN
    first_n := local_part;
    last_n := local_part;
  ELSIF position(' ' IN dn) = 0 THEN
    first_n := local_part;
    last_n := dn;
  ELSE
    first_n := regexp_replace(dn, ' [^ ]+$', '');
    last_n := regexp_replace(dn, '^.* ', '');
  END IF;
  mail := lower(nullif(btrim(coalesce(u.email, '')), ''));
  IF mail IS NOT NULL AND EXISTS (SELECT 1 FROM employees WHERE tenant_id = p_tenant AND lower(work_email) = mail) THEN
    mail := NULL;
  END IF;
  SELECT employee_default_weekly_hours INTO hours FROM tenants WHERE id = p_tenant;
  INSERT INTO employees (tenant_id, user_id, first_name, last_name, work_email, job_title, work_phone, weekly_hours, first_linked_at)
  VALUES (p_tenant, p_user, left(first_n, 100), left(last_n, 100), left(mail, 254), left(nullif(btrim(u.job_title), ''), 100),
    left(nullif(btrim(u.phone), ''), 40), coalesce(hours, 40), now())
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;
--> statement-breakpoint
-- Every existing member gets a linked record. app.tenant_id is set per workspace so RLS (forced for
-- the owner too) admits the rows and their history; it is cleared afterwards.
DO $$
DECLARE
  m record;
BEGIN
  FOR m IN SELECT tenant_id, user_id FROM memberships ORDER BY tenant_id, created_at LOOP
    PERFORM set_config('app.tenant_id', m.tenant_id::text, true);
    PERFORM people_create_member_employee(m.tenant_id, m.user_id);
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
