CREATE TABLE "work_order_counters" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 1000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_technicians" (
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_technicians_tenant_id_work_order_id_employee_id_pk" PRIMARY KEY("tenant_id","work_order_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"type" text DEFAULT 'repair' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'unscheduled' NOT NULL,
	"hold_reason" text,
	"scheduled_date" date,
	"scheduled_start" time,
	"duration_hours" numeric(5, 2) DEFAULT 2 NOT NULL,
	"location" text,
	"equipment" text,
	"job" text,
	"report" text,
	"completed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_orders_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "work_orders_title_ck" CHECK (length(btrim("work_orders"."title")) between 1 and 200),
	CONSTRAINT "work_orders_status_ck" CHECK ("work_orders"."status" in ('unscheduled', 'scheduled', 'in_progress', 'on_hold', 'completed')),
	CONSTRAINT "work_orders_type_ck" CHECK ("work_orders"."type" in ('installation', 'repair', 'maintenance', 'inspection')),
	CONSTRAINT "work_orders_priority_ck" CHECK ("work_orders"."priority" in ('normal', 'urgent')),
	CONSTRAINT "work_orders_hold_reason_ck" CHECK (("work_orders"."status" = 'on_hold') = ("work_orders"."hold_reason" is not null) and ("work_orders"."hold_reason" is null or length(btrim("work_orders"."hold_reason")) between 1 and 200)),
	CONSTRAINT "work_orders_scheduled_ck" CHECK ("work_orders"."status" <> 'scheduled' or ("work_orders"."scheduled_date" is not null and "work_orders"."scheduled_start" is not null)),
	CONSTRAINT "work_orders_duration_ck" CHECK ("work_orders"."duration_hours" between 0.25 and 99 and mod("work_orders"."duration_hours" * 4, 1) = 0),
	CONSTRAINT "work_orders_text_ck" CHECK (length("work_orders"."location") <= 300 and length("work_orders"."equipment") <= 300 and length("work_orders"."job") <= 10000 and length("work_orders"."report") <= 10000)
);
--> statement-breakpoint
ALTER TABLE "work_order_counters" ADD CONSTRAINT "work_order_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_technicians" ADD CONSTRAINT "work_order_technicians_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_technicians" ADD CONSTRAINT "work_order_technicians_wo_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_technicians" ADD CONSTRAINT "work_order_technicians_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE set null ("project_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_technicians_lead_uq" ON "work_order_technicians" USING btree ("tenant_id","work_order_id") WHERE "work_order_technicians"."is_lead";--> statement-breakpoint
CREATE INDEX "work_order_technicians_employee_idx" ON "work_order_technicians" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "work_orders_tenant_project_idx" ON "work_orders" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "work_orders_tenant_company_idx" ON "work_orders" USING btree ("tenant_id","company_id");