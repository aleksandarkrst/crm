-- Organization levels and units (CD-226): what Drizzle can't express, and the data of departments
-- and teams moved into units. Expand/contract: departments, teams, employees.department_id and
-- team_id stay as they are (the previous release still reads and writes them if a deploy is rolled
-- back); nothing reads them any more and a later migration drops them. See "Levels and units" in
-- docs/ARCHITECTURE.md.

-- ---------------------------------------------------------------- foreign keys
-- ON DELETE SET NULL (column) nulls only that column (PostgreSQL 15+): deleting a unit leaves its
-- members without a unit; deleting an employee leaves their unit without a lead.
ALTER TABLE "employees" ADD CONSTRAINT "employees_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE SET NULL ("unit_id");--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_lead_fk" FOREIGN KEY ("tenant_id","lead_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE SET NULL ("lead_employee_id");--> statement-breakpoint

-- ---------------------------------------------------------------- row-level security
ALTER TABLE "org_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_levels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "org_levels" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "org_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "org_units" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- ---------------------------------------------------------------- the parent's level is higher
-- A unit's parent must be of a higher level (a smaller position). That also rules out loops: going
-- up, the position only gets smaller. OrgService checks reorders of the levels against it.
CREATE OR REPLACE FUNCTION people_org_unit_check_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  own integer;
  above integer;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT position INTO own FROM org_levels WHERE tenant_id = NEW.tenant_id AND id = NEW.level_id;
  SELECT l.position INTO above FROM org_units u JOIN org_levels l ON l.tenant_id = u.tenant_id AND l.id = u.level_id
    WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.parent_id;
  IF above IS NULL OR own IS NULL OR above >= own THEN
    RAISE EXCEPTION 'A unit can only be inside a unit of a higher level'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'org_units_parent_level_ck';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER org_units_check_parent BEFORE INSERT OR UPDATE OF parent_id, level_id ON "org_units" FOR EACH ROW EXECUTE FUNCTION people_org_unit_check_parent();--> statement-breakpoint

-- ---------------------------------------------------------------- versions (If-Match)
CREATE TRIGGER org_levels_version BEFORE INSERT OR UPDATE ON "org_levels" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER org_units_version BEFORE INSERT OR UPDATE ON "org_units" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint

-- ---------------------------------------------------------------- departments and teams → units
-- For one workspace (app.tenant_id must be set to it): the default levels Department and Team when
-- it has none; every department becomes a unit of the first level (its head the lead), every team a
-- unit of the second level inside its department (its lead the lead, unless that person leads a
-- department or another team already: a person leads one unit). The units keep the ids, so history
-- rows and links stay readable. Employees get the unit they lead, else their team, else their
-- department (a lead is a member of their unit). Scheduled deactivations get `unitLeads` from their
-- team leads and department heads (the old keys stay, for a rolled-back release). Units and
-- employees that have one already are left alone, so running it twice changes nothing. The
-- integration tests call it to check the conversion.
CREATE OR REPLACE FUNCTION people_units_from_departments(p_tenant uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  top_level uuid;
  second_level uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM org_levels WHERE tenant_id = p_tenant) THEN
    INSERT INTO org_levels (tenant_id, position, name) VALUES (p_tenant, 1, 'Department'), (p_tenant, 2, 'Team');
  END IF;
  SELECT id INTO top_level FROM org_levels WHERE tenant_id = p_tenant ORDER BY position LIMIT 1;
  SELECT id INTO second_level FROM org_levels WHERE tenant_id = p_tenant ORDER BY position OFFSET 1 LIMIT 1;

  INSERT INTO org_units (id, tenant_id, level_id, parent_id, name, code, lead_employee_id, created_at)
  SELECT d.id, d.tenant_id, top_level, NULL, d.name, d.code,
    CASE
      WHEN d.head_employee_id IS NULL THEN NULL
      WHEN EXISTS (SELECT 1 FROM org_units u WHERE u.tenant_id = p_tenant AND u.lead_employee_id = d.head_employee_id) THEN NULL
      WHEN row_number() OVER (PARTITION BY d.head_employee_id ORDER BY lower(d.name), d.id) > 1 THEN NULL
      ELSE d.head_employee_id
    END,
    d.created_at
  FROM departments d
  WHERE d.tenant_id = p_tenant AND NOT EXISTS (SELECT 1 FROM org_units u WHERE u.tenant_id = p_tenant AND u.id = d.id);

  IF second_level IS NOT NULL THEN
    INSERT INTO org_units (id, tenant_id, level_id, parent_id, name, code, lead_employee_id, created_at)
    SELECT t.id, t.tenant_id, second_level, t.department_id, t.name, NULL,
      CASE
        WHEN t.lead_employee_id IS NULL THEN NULL
        WHEN EXISTS (SELECT 1 FROM org_units u WHERE u.tenant_id = p_tenant AND u.lead_employee_id = t.lead_employee_id) THEN NULL
        WHEN row_number() OVER (PARTITION BY t.lead_employee_id ORDER BY lower(t.name), t.id) > 1 THEN NULL
        ELSE t.lead_employee_id
      END,
      t.created_at
    FROM teams t
    WHERE t.tenant_id = p_tenant AND NOT EXISTS (SELECT 1 FROM org_units u WHERE u.tenant_id = p_tenant AND u.id = t.id);
  END IF;

  UPDATE employees e SET unit_id = x.unit_id
  FROM (
    SELECT e2.id, coalesce((SELECT u.id FROM org_units u WHERE u.tenant_id = p_tenant AND u.lead_employee_id = e2.id),
                           (SELECT u.id FROM org_units u WHERE u.tenant_id = p_tenant AND u.id = e2.team_id),
                           (SELECT u.id FROM org_units u WHERE u.tenant_id = p_tenant AND u.id = e2.department_id)) AS unit_id
    FROM employees e2
    WHERE e2.tenant_id = p_tenant AND e2.unit_id IS NULL
  ) x
  WHERE e.tenant_id = p_tenant AND e.id = x.id AND x.unit_id IS NOT NULL;

  UPDATE employees SET deactivation_plan = deactivation_plan || jsonb_build_object('unitLeads',
    coalesce((SELECT jsonb_agg(jsonb_build_object('unitId', x ->> 'teamId', 'employeeId', x -> 'employeeId'))
              FROM jsonb_array_elements(coalesce(deactivation_plan -> 'teamLeads', '[]'::jsonb)) x), '[]'::jsonb)
    || coalesce((SELECT jsonb_agg(jsonb_build_object('unitId', x ->> 'departmentId', 'employeeId', x -> 'employeeId'))
                 FROM jsonb_array_elements(coalesce(deactivation_plan -> 'departmentHeads', '[]'::jsonb)) x), '[]'::jsonb))
  WHERE tenant_id = p_tenant AND deactivation_plan IS NOT NULL AND NOT deactivation_plan ? 'unitLeads';
END
$$;
--> statement-breakpoint
-- Every workspace, with app.tenant_id set per workspace so RLS (forced for the owner too) admits the
-- rows. The history and live-update triggers come after, so the move writes no history rows.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM tenants ORDER BY id LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM people_units_from_departments(t.id);
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- change history
-- Entity type org_unit; employees' history gains unitId (department_id and team_id stay listed for
-- a rolled-back release).
CREATE TRIGGER org_units_history AFTER INSERT OR UPDATE OR DELETE ON "org_units" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'org_unit', 'name', 'name:name', 'code:code', 'parent_id:parentId', 'level_id:levelId', 'lead_employee_id:leadEmployeeId');--> statement-breakpoint
DROP TRIGGER employees_history ON "employees";--> statement-breakpoint
CREATE TRIGGER employees_history AFTER INSERT OR UPDATE OR DELETE ON "employees" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'employee', 'full_name', 'first_name:firstName', 'last_name:lastName', 'work_email:workEmail', 'employee_number:employeeNumber',
  'job_title:jobTitle', 'unit_id:unitId', 'department_id:departmentId', 'team_id:teamId', 'manager_id:managerId', 'work_phone:workPhone',
  'work_location:workLocation', 'employment_start_date:employmentStartDate', 'employment_type:employmentType', 'weekly_hours:weeklyHours',
  'timesheet_required:timesheetRequired', 'attendance_tracked:attendanceTracked', 'employment_end_date:employmentEndDate',
  'deactivated_at:deactivatedAt', 'leaving_reason:leavingReason', 'user_id:userId');--> statement-breakpoint

-- ---------------------------------------------------------------- live updates
CREATE TRIGGER org_levels_notify_ins AFTER INSERT ON "org_levels" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('org_level');--> statement-breakpoint
CREATE TRIGGER org_levels_notify_upd AFTER UPDATE ON "org_levels" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('org_level');--> statement-breakpoint
CREATE TRIGGER org_levels_notify_del AFTER DELETE ON "org_levels" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('org_level');--> statement-breakpoint
CREATE TRIGGER org_units_notify_ins AFTER INSERT ON "org_units" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('org_unit');--> statement-breakpoint
CREATE TRIGGER org_units_notify_upd AFTER UPDATE ON "org_units" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('org_unit');--> statement-breakpoint
CREATE TRIGGER org_units_notify_del AFTER DELETE ON "org_units" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('org_unit');
