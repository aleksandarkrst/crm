-- Hour limits per person on a task (CD-147) and the stand-in hours (task_time_fixtures, until
-- milestone 15's time entries). See "Tasks" in docs/ARCHITECTURE.md.

ALTER TABLE "task_time_fixtures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_time_fixtures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "task_time_fixtures" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Assignees' history (0062), now with their limits: added and removed as before (the limit in the
-- value), and a limit change as an "updated" row of field "hourLimit" labelled with the person.
CREATE OR REPLACE FUNCTION projects_record_assignment_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ts timestamptz := date_trunc('milliseconds', clock_timestamp());
  task_created timestamptz;
  person text;
  act text;
BEGIN
  SELECT full_name INTO person FROM employees WHERE id = NEW.employee_id;
  IF TG_OP = 'UPDATE' AND OLD.active AND NEW.active AND OLD.hour_limit IS DISTINCT FROM NEW.hour_limit THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, label, actor_user_id, client_id, changed_at)
    VALUES (NEW.tenant_id, 'task', NEW.task_id, 'updated', 'hourLimit', to_jsonb(OLD.hour_limit), to_jsonb(NEW.hour_limit), person,
      app_current_user(), app_current_client(), ts);
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT created_at INTO task_created FROM tasks WHERE id = NEW.task_id;
    IF task_created = now() THEN
      RETURN NULL;
    END IF;
    act := 'participant_added';
  ELSIF OLD.active IS DISTINCT FROM NEW.active THEN
    act := CASE WHEN NEW.active THEN 'participant_added' ELSE 'participant_removed' END;
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, new_value, old_value, label, actor_user_id, client_id, changed_at)
  VALUES (NEW.tenant_id, 'task', NEW.task_id, act, 'assignees',
    CASE WHEN act = 'participant_added' THEN jsonb_build_object('employeeId', NEW.employee_id, 'name', person, 'hourLimit', NEW.hour_limit) END,
    CASE WHEN act = 'participant_removed' THEN jsonb_build_object('employeeId', NEW.employee_id, 'name', person, 'hourLimit', NEW.hour_limit) END,
    person, app_current_user(), app_current_client(), ts);
  RETURN NULL;
END
$$;
