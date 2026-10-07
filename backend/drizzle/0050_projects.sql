CREATE TABLE "project_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_stages_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "project_stages_tenant_type_id_uq" UNIQUE("tenant_id","project_type_id","id"),
	CONSTRAINT "project_stages_name_ck" CHECK (length(btrim("project_stages"."name")) between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "project_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_types_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "project_types_name_ck" CHECK (length(btrim("project_types"."name")) between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"project_type_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"company_id" uuid NOT NULL,
	"deal_id" uuid,
	"lead_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "projects_name_ck" CHECK (length(btrim("projects"."name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_type_fk" FOREIGN KEY ("tenant_id","project_type_id") REFERENCES "public"."project_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_types" ADD CONSTRAINT "project_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_user_id_users_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_type_fk" FOREIGN KEY ("tenant_id","project_type_id") REFERENCES "public"."project_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_stage_fk" FOREIGN KEY ("tenant_id","project_type_id","stage_id") REFERENCES "public"."project_stages"("tenant_id","project_type_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_stages_name_uq" ON "project_stages" USING btree ("tenant_id","project_type_id",lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "project_types_name_uq" ON "project_types" USING btree ("tenant_id",lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "projects_name_uq" ON "projects" USING btree ("tenant_id","company_id",lower(btrim("name"))) WHERE "projects"."status" = 'open';--> statement-breakpoint
CREATE INDEX "projects_tenant_deal_idx" ON "projects" USING btree ("tenant_id","deal_id");--> statement-breakpoint
CREATE INDEX "projects_tenant_company_idx" ON "projects" USING btree ("tenant_id","company_id");