-- Every meeting has a deal (CD-213, spec 4.2). NOT VALID: the check holds for new and changed
-- meetings, while meetings saved without a deal before (staging) stay readable. Changing one of
-- those needs a deal first.
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_deal_required" CHECK ("deal_id" IS NOT NULL) NOT VALID;--> statement-breakpoint

-- Deleting a deal no longer unlinks its meetings: a deal with meetings can't be deleted
-- (DealsService answers 409 first; NO ACTION, so a tenant's deletion, which cascades to both
-- tables in one statement, still works).
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_deal_fk";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE NO ACTION;
