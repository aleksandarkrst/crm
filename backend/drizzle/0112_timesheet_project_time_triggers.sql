-- Time on a project without a task (CD-350). The lock refuses changes on a closed project for
-- these entries too, and the entry history snapshots and compares the project.
CREATE OR REPLACE FUNCTION time_entries_check_lock(e time_entries) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  day_status text;
BEGIN
  SELECT status INTO day_status FROM timesheet_days WHERE tenant_id = e.tenant_id AND employee_id = e.employee_id AND work_date = e.work_date;
  IF day_status = 'submitted' THEN
    RAISE EXCEPTION 'This day is submitted. Recall it to change its hours.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_day_submitted', TABLE = 'time_entries';
  ELSIF day_status = 'approved' THEN
    RAISE EXCEPTION 'Day is approved and locked'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_day_approved', TABLE = 'time_entries';
  END IF;
  IF e.work_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM work_orders w WHERE w.tenant_id = e.tenant_id AND w.id = e.work_order_id AND w.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'This work order is completed. Reopen it to change its time.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_work_order_completed', TABLE = 'time_entries';
  END IF;
  IF e.task_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM tasks t JOIN projects p ON p.tenant_id = t.tenant_id AND p.id = t.project_id
    WHERE t.tenant_id = e.tenant_id AND t.id = e.task_id AND p.status <> 'open'
  ) THEN
    RAISE EXCEPTION 'Project is closed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_project_closed', TABLE = 'time_entries';
  END IF;
  IF e.project_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM projects p WHERE p.tenant_id = e.tenant_id AND p.id = e.project_id AND p.status <> 'open'
  ) THEN
    RAISE EXCEPTION 'Project is closed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_project_closed', TABLE = 'time_entries';
  END IF;
  IF e.task_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM tasks t WHERE t.tenant_id = e.tenant_id AND t.id = e.task_id AND t.status = 'done'
  ) THEN
    RAISE EXCEPTION 'This task is done. Reopen it to change its time.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entries_task_done', TABLE = 'time_entries';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION timesheet_entry_json(e time_entries) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT jsonb_build_object('employeeId', e.employee_id, 'date', e.work_date, 'taskId', e.task_id, 'workOrderId', e.work_order_id, 'projectId', e.project_id, 'minutes', e.minutes, 'note', e.note) $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION timesheet_entry_history() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ts timestamptz := date_trunc('milliseconds', clock_timestamp());
  o jsonb;
  n jsonb;
  f text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, new_value, actor_user_id, client_id, changed_at)
    VALUES (NEW.tenant_id, 'time_entry', NEW.id, 'created', timesheet_entry_json(NEW), app_current_user(), app_current_client(), ts);
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, old_value, actor_user_id, client_id, changed_at)
    VALUES (OLD.tenant_id, 'time_entry', OLD.id, 'deleted', timesheet_entry_json(OLD), app_current_user(), app_current_client(), ts);
    RETURN NULL;
  END IF;
  o := timesheet_entry_json(OLD);
  n := timesheet_entry_json(NEW);
  FOREACH f IN ARRAY ARRAY['minutes', 'note', 'date', 'taskId', 'workOrderId', 'projectId'] LOOP
    IF (o -> f) IS DISTINCT FROM (n -> f) THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, actor_user_id, client_id, changed_at)
      VALUES (NEW.tenant_id, 'time_entry', NEW.id, 'updated', f, o, n, app_current_user(), app_current_client(), ts);
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
