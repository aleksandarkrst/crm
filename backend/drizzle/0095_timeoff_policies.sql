CREATE TABLE "employee_timeoff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"prior_experience_months" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_timeoff_profiles_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "employee_timeoff_profiles_prior_ck" CHECK ("employee_timeoff_profiles"."prior_experience_months" between 0 and 600)
);
--> statement-breakpoint
CREATE TABLE "timeoff_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_days" integer DEFAULT 20 NOT NULL,
	"max_days" integer,
	"carry_over" boolean DEFAULT true NOT NULL,
	"carry_over_cap" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeoff_policies_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "timeoff_policies_name_ck" CHECK (length(btrim("timeoff_policies"."name")) between 1 and 100),
	CONSTRAINT "timeoff_policies_base_days_ck" CHECK ("timeoff_policies"."base_days" between 20 and 60),
	CONSTRAINT "timeoff_policies_max_days_ck" CHECK ("timeoff_policies"."max_days" is null or "timeoff_policies"."max_days" between 20 and 100),
	CONSTRAINT "timeoff_policies_carry_over_cap_ck" CHECK ("timeoff_policies"."carry_over_cap" is null or "timeoff_policies"."carry_over_cap" between 0 and 60),
	CONSTRAINT "timeoff_policies_note_ck" CHECK ("timeoff_policies"."note" is null or length("timeoff_policies"."note") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "timeoff_policy_experience_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"from_years" integer NOT NULL,
	"extra_days" integer NOT NULL,
	CONSTRAINT "timeoff_policy_rules_from_years_ck" CHECK ("timeoff_policy_experience_rules"."from_years" between 1 and 50),
	CONSTRAINT "timeoff_policy_rules_extra_days_ck" CHECK ("timeoff_policy_experience_rules"."extra_days" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "vacation_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"policy_id" uuid NOT NULL,
	"base_days" integer NOT NULL,
	"experience_days" integer DEFAULT 0 NOT NULL,
	"experience_years" integer DEFAULT 0 NOT NULL,
	"individual_days" integer DEFAULT 0 NOT NULL,
	"individual_reason" text,
	"months_worked" integer,
	"annual_days" integer NOT NULL,
	"total_days" integer NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vacation_entitlements_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "vacation_entitlements_year_ck" CHECK ("vacation_entitlements"."year" between 2000 and 2100),
	CONSTRAINT "vacation_entitlements_individual_ck" CHECK ("vacation_entitlements"."individual_days" between 0 and 60 and ("vacation_entitlements"."individual_days" = 0 or "vacation_entitlements"."individual_reason" is not null)),
	CONSTRAINT "vacation_entitlements_reason_ck" CHECK ("vacation_entitlements"."individual_reason" is null or length(btrim("vacation_entitlements"."individual_reason")) between 1 and 300),
	CONSTRAINT "vacation_entitlements_months_ck" CHECK ("vacation_entitlements"."months_worked" is null or "vacation_entitlements"."months_worked" between 0 and 12),
	CONSTRAINT "vacation_entitlements_days_ck" CHECK ("vacation_entitlements"."annual_days" >= 0 and "vacation_entitlements"."total_days" between 0 and "vacation_entitlements"."annual_days")
);
--> statement-breakpoint
ALTER TABLE "employee_timeoff_profiles" ADD CONSTRAINT "employee_timeoff_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_timeoff_profiles" ADD CONSTRAINT "employee_timeoff_profiles_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_timeoff_profiles" ADD CONSTRAINT "employee_timeoff_profiles_policy_fk" FOREIGN KEY ("tenant_id","policy_id") REFERENCES "public"."timeoff_policies"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_policies" ADD CONSTRAINT "timeoff_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_policy_experience_rules" ADD CONSTRAINT "timeoff_policy_experience_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_policy_experience_rules" ADD CONSTRAINT "timeoff_policy_rules_policy_fk" FOREIGN KEY ("tenant_id","policy_id") REFERENCES "public"."timeoff_policies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_entitlements" ADD CONSTRAINT "vacation_entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_entitlements" ADD CONSTRAINT "vacation_entitlements_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_entitlements" ADD CONSTRAINT "vacation_entitlements_policy_fk" FOREIGN KEY ("tenant_id","policy_id") REFERENCES "public"."timeoff_policies"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_timeoff_profiles_employee_uq" ON "employee_timeoff_profiles" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_timeoff_profiles_policy_idx" ON "employee_timeoff_profiles" USING btree ("tenant_id","policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timeoff_policies_name_uq" ON "timeoff_policies" USING btree ("tenant_id",lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "timeoff_policies_default_uq" ON "timeoff_policies" USING btree ("tenant_id") WHERE "timeoff_policies"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "timeoff_policy_rules_from_uq" ON "timeoff_policy_experience_rules" USING btree ("tenant_id","policy_id","from_years");--> statement-breakpoint
CREATE INDEX "timeoff_policy_rules_policy_idx" ON "timeoff_policy_experience_rules" USING btree ("tenant_id","policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_entitlements_year_uq" ON "vacation_entitlements" USING btree ("tenant_id","employee_id","year");--> statement-breakpoint
CREATE INDEX "vacation_entitlements_policy_idx" ON "vacation_entitlements" USING btree ("tenant_id","policy_id");