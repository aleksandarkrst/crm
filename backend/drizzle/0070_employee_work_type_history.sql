-- An employee's work type (CD-268) is in their history too. Otherwise the same trigger as in
-- 0049_org_units_rls.sql.
DROP TRIGGER employees_history ON "employees";--> statement-breakpoint
CREATE TRIGGER employees_history AFTER INSERT OR UPDATE OR DELETE ON "employees" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'employee', 'full_name', 'first_name:firstName', 'last_name:lastName', 'work_email:workEmail', 'employee_number:employeeNumber',
  'job_title:jobTitle', 'unit_id:unitId', 'department_id:departmentId', 'team_id:teamId', 'manager_id:managerId', 'work_phone:workPhone',
  'work_location:workLocation', 'employment_start_date:employmentStartDate', 'employment_type:employmentType', 'weekly_hours:weeklyHours',
  'timesheet_required:timesheetRequired', 'attendance_tracked:attendanceTracked', 'employment_end_date:employmentEndDate',
  'deactivated_at:deactivatedAt', 'leaving_reason:leavingReason', 'user_id:userId', 'work_type:workType');
