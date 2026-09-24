ALTER TABLE "memberships" ADD COLUMN "default_funnel_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "daily_digest" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timezone" text DEFAULT 'Europe/Belgrade' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "fiscal_year_start_month" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name_custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "date_format" text DEFAULT 'DD.MM.YYYY' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "start_page" text DEFAULT 'pipeline' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "discovery_need" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "discovery_constraint" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "decision_maker" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "discovery_date" date;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_fiscal_month_ck" CHECK ("tenants"."fiscal_year_start_month" between 1 and 12);