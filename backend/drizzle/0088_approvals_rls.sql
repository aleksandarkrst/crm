-- Timesheet approvals (CD-157). See "Timesheet" in docs/ARCHITECTURE.md.
ALTER TABLE "timesheet_day_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_day_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "timesheet_day_events" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- History is append-only (spec 9.5): no code path may rewrite what happened.
CREATE OR REPLACE FUNCTION timesheet_day_events_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Timesheet history cannot be changed' USING ERRCODE = 'check_violation', CONSTRAINT = 'timesheet_day_events_readonly';
END;
$$;--> statement-breakpoint
CREATE TRIGGER timesheet_day_events_readonly BEFORE UPDATE ON "timesheet_day_events" FOR EACH ROW EXECUTE FUNCTION timesheet_day_events_readonly();
