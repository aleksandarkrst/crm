CREATE TABLE "visit_plan_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"planned_visits" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_plan_lines_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "visit_plan_lines_company_uq" UNIQUE("plan_id","company_id"),
	CONSTRAINT "visit_plan_lines_planned_ck" CHECK ("visit_plan_lines"."planned_visits" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "visit_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"salesperson_user_id" uuid NOT NULL,
	"period_type" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_plans_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "visit_plans_period_uq" UNIQUE("tenant_id","salesperson_user_id","period_type","period_start"),
	CONSTRAINT "visit_plans_period_type_ck" CHECK ("visit_plans"."period_type" in ('month', 'quarter')),
	CONSTRAINT "visit_plans_period_ck" CHECK ("visit_plans"."period_end" > "visit_plans"."period_start")
);
--> statement-breakpoint
ALTER TABLE "visit_plan_lines" ADD CONSTRAINT "visit_plan_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_plan_lines" ADD CONSTRAINT "visit_plan_lines_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."visit_plans"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_plan_lines" ADD CONSTRAINT "visit_plan_lines_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_plans" ADD CONSTRAINT "visit_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_plans" ADD CONSTRAINT "visit_plans_salesperson_user_id_users_id_fk" FOREIGN KEY ("salesperson_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_plans" ADD CONSTRAINT "visit_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_plan_lines_tenant_company_idx" ON "visit_plan_lines" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "visit_plans_tenant_period_idx" ON "visit_plans" USING btree ("tenant_id","period_start");