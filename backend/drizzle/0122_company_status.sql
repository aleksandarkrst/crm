ALTER TABLE "companies" ADD COLUMN "status" text DEFAULT 'lead' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "status_set_manually" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "companies_tenant_status_idx" ON "companies" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_status_ck" CHECK ("companies"."status" in ('lead', 'opportunity', 'client', 'past_client', 'not_interested'));