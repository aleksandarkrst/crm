CREATE TABLE "timeoff_notices" (
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"period" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeoff_notices_pk" PRIMARY KEY("tenant_id","kind","employee_id","period"),
	CONSTRAINT "timeoff_notices_kind_ck" CHECK ("timeoff_notices"."kind" in ('carry_over_expiring'))
);
--> statement-breakpoint
CREATE TABLE "vacation_balance_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"pool_year" integer NOT NULL,
	"days" integer NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vacation_balance_adjustments_days_ck" CHECK ("vacation_balance_adjustments"."days" between -60 and 60 and "vacation_balance_adjustments"."days" <> 0),
	CONSTRAINT "vacation_balance_adjustments_kind_ck" CHECK ("vacation_balance_adjustments"."kind" in ('correction', 'opening_balance', 'extra_days')),
	CONSTRAINT "vacation_balance_adjustments_reason_ck" CHECK (length(btrim("vacation_balance_adjustments"."reason")) between 1 and 300),
	CONSTRAINT "vacation_balance_adjustments_year_ck" CHECK ("vacation_balance_adjustments"."pool_year" between 2000 and 2100)
);
--> statement-breakpoint
CREATE TABLE "vacation_balance_expiries" (
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"pool_year" integer NOT NULL,
	"days" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vacation_balance_expiries_pk" PRIMARY KEY("tenant_id","employee_id","pool_year"),
	CONSTRAINT "vacation_balance_expiries_days_ck" CHECK ("vacation_balance_expiries"."days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "notify_timeoff_balance" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "timeoff_notices" ADD CONSTRAINT "timeoff_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_notices" ADD CONSTRAINT "timeoff_notices_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_balance_adjustments" ADD CONSTRAINT "vacation_balance_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_balance_adjustments" ADD CONSTRAINT "vacation_balance_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_balance_adjustments" ADD CONSTRAINT "vacation_balance_adjustments_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_balance_expiries" ADD CONSTRAINT "vacation_balance_expiries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_balance_expiries" ADD CONSTRAINT "vacation_balance_expiries_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vacation_balance_adjustments_employee_idx" ON "vacation_balance_adjustments" USING btree ("tenant_id","employee_id","pool_year");