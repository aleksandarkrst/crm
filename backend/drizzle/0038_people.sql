CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"head_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "departments_name_ck" CHECK (length(btrim("departments"."name")) between 1 and 100),
	CONSTRAINT "departments_code_ck" CHECK ("departments"."code" is null or length("departments"."code") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "employee_personal" (
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date_of_birth" date,
	"private_email" text,
	"private_phone" text,
	"address_street" text,
	"address_postal_code" text,
	"address_city" text,
	"address_country" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"iban_sealed" text,
	"iban_last4" text,
	"iban_country" text,
	"iban_masked" text,
	"bank_name" text,
	"fx_same_as_iban" boolean DEFAULT true NOT NULL,
	"fx_iban_sealed" text,
	"fx_iban_last4" text,
	"fx_iban_country" text,
	"fx_iban_masked" text,
	"swift_bic" text,
	"fx_bank_name" text,
	"fx_bank_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_personal_pk" PRIMARY KEY("tenant_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "employee_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by_user_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_roles_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "employee_roles_uq" UNIQUE("tenant_id","employee_id","role"),
	CONSTRAINT "employee_roles_role_ck" CHECK ("employee_roles"."role" in ('administration', 'payroll'))
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"full_name" text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"work_email" text,
	"employee_number" text,
	"job_title" text,
	"department_id" uuid,
	"team_id" uuid,
	"manager_id" uuid,
	"work_phone" text,
	"work_location" text,
	"employment_start_date" date,
	"employment_type" text DEFAULT 'permanent' NOT NULL,
	"weekly_hours" numeric(4, 1) DEFAULT 40 NOT NULL,
	"timesheet_required" boolean DEFAULT true NOT NULL,
	"attendance_tracked" boolean DEFAULT false NOT NULL,
	"employment_end_date" date,
	"deactivated_at" timestamp with time zone,
	"leaving_reason" text,
	"first_linked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "employees_user_uq" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "employees_names_ck" CHECK (length("employees"."first_name") <= 100 and length(btrim("employees"."last_name")) between 1 and 100),
	CONSTRAINT "employees_type_ck" CHECK ("employees"."employment_type" in ('permanent', 'fixed_term', 'contractor', 'student')),
	CONSTRAINT "employees_weekly_hours_ck" CHECK ("employees"."weekly_hours" between 1 and 60),
	CONSTRAINT "employees_leaving_reason_ck" CHECK ("employees"."leaving_reason" is null or "employees"."leaving_reason" in ('resigned', 'contract_ended', 'dismissed', 'retired', 'other')),
	CONSTRAINT "employees_not_own_manager_ck" CHECK ("employees"."manager_id" is null or "employees"."manager_id" <> "employees"."id"),
	CONSTRAINT "employees_team_needs_department_ck" CHECK ("employees"."team_id" is null or "employees"."department_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lead_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "teams_tenant_department_id_uq" UNIQUE("tenant_id","department_id","id"),
	CONSTRAINT "teams_name_ck" CHECK (length(btrim("teams"."name")) between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "notify_org_changes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "employee_default_weekly_hours" smallint DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "employee_number_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "employee_self_edit_bank" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_personal" ADD CONSTRAINT "employee_personal_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_personal" ADD CONSTRAINT "employee_personal_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_uq" ON "departments" USING btree ("tenant_id",lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "departments_code_uq" ON "departments" USING btree ("tenant_id",lower("code")) WHERE "departments"."code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_work_email_uq" ON "employees" USING btree ("tenant_id",lower("work_email")) WHERE "employees"."work_email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_number_uq" ON "employees" USING btree ("tenant_id","employee_number") WHERE "employees"."employee_number" is not null;--> statement-breakpoint
CREATE INDEX "employees_tenant_manager_idx" ON "employees" USING btree ("tenant_id","manager_id");--> statement-breakpoint
CREATE INDEX "employees_tenant_department_idx" ON "employees" USING btree ("tenant_id","department_id","team_id");--> statement-breakpoint
CREATE INDEX "employees_tenant_last_name_idx" ON "employees" USING btree ("tenant_id","last_name","first_name");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_uq" ON "teams" USING btree ("tenant_id","department_id",lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "invitations_employee_idx" ON "invitations" USING btree ("employee_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_employee_weekly_hours_ck" CHECK ("tenants"."employee_default_weekly_hours" between 1 and 60);