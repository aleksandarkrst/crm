-- CD-336 (staging bug 10): 0109 ran without app.tenant_id, so RLS (forced for the owner too) hid
-- every timesheet day and it inserted nothing. This is the same backfill per workspace: days
-- submitted, returned or approved before the day history table existed (0087, CD-157) get the
-- missing steps from their own timestamps and actors. A day submitted by nobody was auto-submitted
-- by the deadline job. Idempotent: a step that already has an event is skipped.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id, timesheet_approval_mode FROM tenants ORDER BY id LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);

    INSERT INTO timesheet_day_events (tenant_id, employee_id, work_date, kind, actor_user_id, actor_name, comment, approval_mode, created_at)
    SELECT d.tenant_id, d.employee_id, d.work_date,
      CASE WHEN d.submitted_by_user_id IS NULL THEN 'auto_submitted' ELSE 'submitted' END,
      d.submitted_by_user_id, u.display_name, NULL, t.timesheet_approval_mode, d.first_submitted_at
    FROM timesheet_days d
    LEFT JOIN users u ON u.id = d.submitted_by_user_id
    WHERE d.tenant_id = t.id AND d.first_submitted_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM timesheet_day_events e
        WHERE e.tenant_id = d.tenant_id AND e.employee_id = d.employee_id AND e.work_date = d.work_date AND e.kind IN ('submitted', 'auto_submitted')
      );

    INSERT INTO timesheet_day_events (tenant_id, employee_id, work_date, kind, actor_user_id, actor_name, comment, approval_mode, created_at)
    SELECT d.tenant_id, d.employee_id, d.work_date, 'returned', d.returned_by_user_id, u.display_name, d.comment, t.timesheet_approval_mode, d.returned_at
    FROM timesheet_days d
    LEFT JOIN users u ON u.id = d.returned_by_user_id
    WHERE d.tenant_id = t.id AND d.returned_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM timesheet_day_events e
        WHERE e.tenant_id = d.tenant_id AND e.employee_id = d.employee_id AND e.work_date = d.work_date AND e.kind = 'returned'
      );

    INSERT INTO timesheet_day_events (tenant_id, employee_id, work_date, kind, actor_user_id, actor_name, comment, approval_mode, created_at)
    SELECT d.tenant_id, d.employee_id, d.work_date, 'approved', d.approved_by_user_id, u.display_name, NULL, t.timesheet_approval_mode, d.approved_at
    FROM timesheet_days d
    LEFT JOIN users u ON u.id = d.approved_by_user_id
    WHERE d.tenant_id = t.id AND d.approved_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM timesheet_day_events e
        WHERE e.tenant_id = d.tenant_id AND e.employee_id = d.employee_id AND e.work_date = d.work_date AND e.kind = 'approved'
      );
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
