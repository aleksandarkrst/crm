ALTER TABLE "memberships" ADD COLUMN "notify_meeting_invites" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "notify_visit_plans" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "customer_email_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_customer_email_language_ck" CHECK ("tenants"."customer_email_language" in ('en', 'sr'));