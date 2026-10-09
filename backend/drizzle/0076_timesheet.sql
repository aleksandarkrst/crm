CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"task_id" uuid,
	"work_order_id" uuid,
	"minutes" integer NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_target_ck" CHECK (("time_entries"."task_id" is null) <> ("time_entries"."work_order_id" is null)),
	CONSTRAINT "time_entries_minutes_ck" CHECK ("time_entries"."minutes" between 15 and 1440 and "time_entries"."minutes" % 15 = 0),
	CONSTRAINT "time_entries_note_ck" CHECK ("time_entries"."note" is null or length("time_entries"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "timesheet_days" (
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_days_pk" PRIMARY KEY("tenant_id","employee_id","work_date"),
	CONSTRAINT "timesheet_days_status_ck" CHECK ("timesheet_days"."status" in ('draft', 'submitted', 'rejected', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "timesheet_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"task_id" uuid,
	"work_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_rows_target_ck" CHECK (("timesheet_rows"."task_id" is null) <> ("timesheet_rows"."work_order_id" is null)),
	CONSTRAINT "timesheet_rows_monday_ck" CHECK (extract(isodow from "timesheet_rows"."week_start") = 1)
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD CONSTRAINT "timesheet_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD CONSTRAINT "timesheet_days_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD CONSTRAINT "timesheet_days_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_employee_date_idx" ON "time_entries" USING btree ("tenant_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX "time_entries_task_idx" ON "time_entries" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "time_entries_work_order_idx" ON "time_entries" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_rows_task_uq" ON "timesheet_rows" USING btree ("tenant_id","employee_id","week_start","task_id") WHERE "timesheet_rows"."task_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_rows_work_order_uq" ON "timesheet_rows" USING btree ("tenant_id","employee_id","week_start","work_order_id") WHERE "timesheet_rows"."work_order_id" is not null;