-- External minutes sent by email (CD-133): row-level security, the contact foreign key that nulls
-- one column, and live updates.

ALTER TABLE "meeting_minutes_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_minutes_sends" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "meeting_minutes_sends" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "meeting_minutes_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_minutes_recipients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "meeting_minutes_recipients" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Deleting a contact keeps the send log as it was (name and address are saved on the row).
ALTER TABLE "meeting_minutes_recipients" ADD CONSTRAINT "meeting_minutes_recipients_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE SET NULL ("contact_id");--> statement-breakpoint

-- Live updates: a send and each change of a recipient's status report their meeting (type
-- "meeting"), so everyone with the meeting open sees "Queued" turn into "Sent" or "Failed".
CREATE TRIGGER meeting_minutes_sends_notify_ins AFTER INSERT ON "meeting_minutes_sends" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('meeting', 'meeting_id');--> statement-breakpoint
CREATE TRIGGER meeting_minutes_recipients_notify_ins AFTER INSERT ON "meeting_minutes_recipients" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('meeting', 'meeting_id');--> statement-breakpoint
CREATE TRIGGER meeting_minutes_recipients_notify_upd AFTER UPDATE ON "meeting_minutes_recipients" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_notify_changes('meeting', 'meeting_id');
