-- The work order page (CD-266): its checklist, and history for work orders and their technicians.
-- See "Work orders" in docs/ARCHITECTURE.md.

ALTER TABLE "work_order_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_order_checklist_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "work_order_checklist_items" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER work_order_checklist_items_version BEFORE INSERT OR UPDATE ON "work_order_checklist_items" FOR EACH ROW EXECUTE FUNCTION crm_touch_version();--> statement-breakpoint
CREATE TRIGGER work_order_checklist_items_notify_ins AFTER INSERT ON "work_order_checklist_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('work_order', 'work_order_id');--> statement-breakpoint
CREATE TRIGGER work_order_checklist_items_notify_upd AFTER UPDATE ON "work_order_checklist_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('work_order', 'work_order_id');--> statement-breakpoint
CREATE TRIGGER work_order_checklist_items_notify_del AFTER DELETE ON "work_order_checklist_items" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('work_order', 'work_order_id');--> statement-breakpoint

-- ---------------------------------------------------------------- history
CREATE TRIGGER work_orders_history AFTER INSERT OR UPDATE OR DELETE ON "work_orders" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'work_order', 'title', 'title:title', 'project_id:projectId', 'type:type', 'priority:priority', 'status:status', 'hold_reason:holdReason',
  'scheduled_date:scheduledDate', 'scheduled_start:scheduledStart', 'duration_hours:durationHours', 'location:location', 'work_place:workPlace',
  'equipment:equipment', 'job:job', 'report:report', 'materials:materials', 'customer_name:customerName', 'signed_off_at:signedOffAt');--> statement-breakpoint

-- Technicians are history of their work order, like a task's assignees (0062): added and removed with
-- the person's name, and who leads. The ones an order is created with belong to its "created" row, and
-- the ones deleted with their order aren't recorded.
CREATE OR REPLACE FUNCTION projects_record_technician_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ts timestamptz := date_trunc('milliseconds', clock_timestamp());
  order_created timestamptz;
  person text;
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    IF NOT EXISTS (SELECT 1 FROM work_orders WHERE id = OLD.work_order_id) THEN
      RETURN NULL;
    END IF;
  ELSE
    r := NEW;
  END IF;
  SELECT full_name INTO person FROM employees WHERE id = r.employee_id;
  IF TG_OP = 'INSERT' THEN
    SELECT created_at INTO order_created FROM work_orders WHERE id = NEW.work_order_id;
    IF order_created = now() THEN
      RETURN NULL;
    END IF;
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, new_value, label, actor_user_id, client_id, changed_at)
    VALUES (NEW.tenant_id, 'work_order', NEW.work_order_id, 'participant_added', 'technicians', jsonb_build_object('employeeId', NEW.employee_id, 'name', person),
      person, app_current_user(), app_current_client(), ts);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, label, actor_user_id, client_id, changed_at)
    VALUES (OLD.tenant_id, 'work_order', OLD.work_order_id, 'participant_removed', 'technicians', jsonb_build_object('employeeId', OLD.employee_id, 'name', person),
      person, app_current_user(), app_current_client(), ts);
  ELSIF NEW.is_lead AND NOT OLD.is_lead THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, new_value, label, actor_user_id, client_id, changed_at)
    VALUES (NEW.tenant_id, 'work_order', NEW.work_order_id, 'updated', 'leadTechnician', to_jsonb(person), person, app_current_user(), app_current_client(), ts);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER work_order_technicians_history AFTER INSERT OR UPDATE OR DELETE ON "work_order_technicians" FOR EACH ROW EXECUTE FUNCTION projects_record_technician_changes();
