CREATE TABLE "org_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_levels_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "org_levels_name_ck" CHECK (length(btrim("org_levels"."name")) between 1 and 50),
	CONSTRAINT "org_levels_position_ck" CHECK ("org_levels"."position" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"level_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"code" text,
	"lead_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_units_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "org_units_name_ck" CHECK (length(btrim("org_units"."name")) between 1 and 100),
	CONSTRAINT "org_units_code_ck" CHECK ("org_units"."code" is null or length("org_units"."code") between 1 and 20),
	CONSTRAINT "org_units_not_own_parent_ck" CHECK ("org_units"."parent_id" is null or "org_units"."parent_id" <> "org_units"."id")
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "org_levels" ADD CONSTRAINT "org_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_level_fk" FOREIGN KEY ("tenant_id","level_id") REFERENCES "public"."org_levels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_levels_name_uq" ON "org_levels" USING btree ("tenant_id",lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_name_uq" ON "org_units" USING btree ("tenant_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_code_uq" ON "org_units" USING btree ("tenant_id",lower("code")) WHERE "org_units"."code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_lead_uq" ON "org_units" USING btree ("tenant_id","lead_employee_id") WHERE "org_units"."lead_employee_id" is not null;--> statement-breakpoint
CREATE INDEX "org_units_tenant_parent_idx" ON "org_units" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "employees_tenant_unit_idx" ON "employees" USING btree ("tenant_id","unit_id");