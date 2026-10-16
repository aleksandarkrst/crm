CREATE TABLE "hr_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"number" text NOT NULL,
	"year" integer NOT NULL,
	"sequence" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"state" text DEFAULT 'valid' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"storage_key" text,
	"size_bytes" integer,
	"sha256" text,
	"email_on_ready" boolean DEFAULT true NOT NULL,
	"emailed_to" text[],
	"emailed_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_documents_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "hr_documents_type_ck" CHECK ("hr_documents"."type" in ('vacation_decision')),
	CONSTRAINT "hr_documents_status_ck" CHECK ("hr_documents"."status" in ('queued', 'running', 'ready', 'failed')),
	CONSTRAINT "hr_documents_state_ck" CHECK ("hr_documents"."state" in ('valid', 'outdated', 'cancelled', 'superseded')),
	CONSTRAINT "hr_documents_version_ck" CHECK ("hr_documents"."version" >= 1 and "hr_documents"."sequence" >= 1 and "hr_documents"."year" between 2000 and 2100)
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_legal_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_address" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_pib" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_mb" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_place" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_signatory_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_signatory_title" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "decision_legal_basis" text DEFAULT 'člana 75. Zakona o radu („Službeni glasnik RS“, br. 24/2005, 61/2005, 54/2009, 32/2013, 75/2014, 13/2017 – odluka US, 113/2017 i 95/2018 – autentično tumačenje)' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "decision_copy_admins" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "decision_copy_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_documents_number_uq" ON "hr_documents" USING btree ("tenant_id","type","number","version");--> statement-breakpoint
CREATE INDEX "hr_documents_source_idx" ON "hr_documents" USING btree ("tenant_id","type","source_id");--> statement-breakpoint
CREATE INDEX "hr_documents_employee_idx" ON "hr_documents" USING btree ("tenant_id","employee_id");