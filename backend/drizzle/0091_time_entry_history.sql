-- Entry history (CD-159, spec 9.5). See "Timesheet" in docs/ARCHITECTURE.md.
-- Every change to someone's hours is a record_changes row of entity type time_entry, written here so
-- the API, the task and work order pages, imports and jobs are all covered. Rows carry whole-row
-- snapshots (employee, date, task or work order, minutes, note), so a week's history can be read by
-- employee and date after the entry is gone.
CREATE OR REPLACE FUNCTION timesheet_entry_json(e time_entries) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT jsonb_build_object('employeeId', e.employee_id, 'date', e.work_date, 'taskId', e.task_id, 'workOrderId', e.work_order_id, 'minutes', e.minutes, 'note', e.note) $$;--> statement-breakpoint
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
  FOREACH f IN ARRAY ARRAY['minutes', 'note', 'date', 'taskId', 'workOrderId'] LOOP
    IF (o -> f) IS DISTINCT FROM (n -> f) THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, actor_user_id, client_id, changed_at)
      VALUES (NEW.tenant_id, 'time_entry', NEW.id, 'updated', f, o, n, app_current_user(), app_current_client(), ts);
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER time_entries_history AFTER INSERT OR UPDATE OR DELETE ON "time_entries" FOR EACH ROW EXECUTE FUNCTION timesheet_entry_history();--> statement-breakpoint
CREATE INDEX "record_changes_time_entry_idx" ON "record_changes" ("tenant_id", ((coalesce(new_value, old_value) ->> 'employeeId')), "changed_at") WHERE entity_type = 'time_entry';
