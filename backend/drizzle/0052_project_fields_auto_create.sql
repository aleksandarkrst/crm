CREATE TABLE "project_auto_deals" (
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_auto_deals_pk" PRIMARY KEY("tenant_id","deal_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "auto_create_projects" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "health" text DEFAULT 'on_track' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_auto_deals" ADD CONSTRAINT "project_auto_deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_auto_deals" ADD CONSTRAINT "project_auto_deals_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_code_uq" ON "projects" USING btree ("tenant_id",lower("code")) WHERE "projects"."code" is not null and "projects"."status" = 'open';--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_code_ck" CHECK ("projects"."code" is null or length(btrim("projects"."code")) between 1 and 20);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_description_ck" CHECK ("projects"."description" is null or length("projects"."description") <= 5000);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_dates_ck" CHECK ("projects"."start_date" is null or "projects"."end_date" is null or "projects"."end_date" >= "projects"."start_date");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_health_ck" CHECK ("projects"."health" in ('on_track', 'at_risk', 'off_track'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_ck" CHECK ("projects"."status" in ('open', 'completed', 'cancelled'));