-- CD-78: every caller identifies checklist to-dos by item id now (CD-32), so the labels-only
-- column, the triggers that kept it in sync and the label unique index go.
DROP TRIGGER IF EXISTS "deal_tasks_link_checklist_item" ON "deal_tasks";--> statement-breakpoint
DROP FUNCTION IF EXISTS deal_tasks_link_checklist_item();--> statement-breakpoint
DROP TRIGGER IF EXISTS "funnel_stages_sync_checklist" ON "funnel_stages";--> statement-breakpoint
DROP FUNCTION IF EXISTS funnel_stages_sync_checklist();--> statement-breakpoint
DROP INDEX "deal_tasks_playbook_uq";--> statement-breakpoint
ALTER TABLE "funnel_stages" DROP COLUMN "checklist";--> statement-breakpoint

-- CD-76: notes from the New contact dialog.
ALTER TABLE "contacts" ADD COLUMN "notes" text;--> statement-breakpoint

-- CD-76: a membership's default funnel is a plain uuid (memberships has no RLS and no composite
-- key to point at), so deleting the funnel clears it here, whatever code deletes it.
CREATE OR REPLACE FUNCTION clear_deleted_default_funnel() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE memberships SET default_funnel_id = NULL WHERE tenant_id = OLD.tenant_id AND default_funnel_id = OLD.id;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER "funnels_clear_default_funnel"
  AFTER DELETE ON "funnels"
  FOR EACH ROW EXECUTE FUNCTION clear_deleted_default_funnel();
--> statement-breakpoint

-- CD-68: getting-started checklist dismissed (per user, per workspace), and the sample records.
ALTER TABLE "memberships" ADD COLUMN "onboarding_dismissed_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "sample_records" (
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"record_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sample_records_tenant_id_kind_record_id_pk" PRIMARY KEY("tenant_id","kind","record_id")
);
--> statement-breakpoint
ALTER TABLE "sample_records" ADD CONSTRAINT "sample_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sample_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sample_records" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
