-- Deal sponsors (CD-362): deleting a contact takes it off the deals it sponsors, in the database, so
-- the release before this one (which doesn't know these columns) can still delete such a contact.
-- ON DELETE SET NULL (column) nulls only that column (PostgreSQL 15+), never tenant_id, so it lives
-- here rather than in the Drizzle schema (as meetings_deal_fk in 0029).
ALTER TABLE "deals" DROP CONSTRAINT "deals_sponsor_fk";--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "deals_power_sponsor_fk";--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_sponsor_fk" FOREIGN KEY ("tenant_id","sponsor_contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE SET NULL ("sponsor_contact_id");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_power_sponsor_fk" FOREIGN KEY ("tenant_id","power_sponsor_contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE SET NULL ("power_sponsor_contact_id");
