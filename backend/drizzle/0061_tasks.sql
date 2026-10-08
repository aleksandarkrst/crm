CREATE TABLE "task_assignments" (
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"assigned_by_user_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_assignments_pk" PRIMARY KEY("tenant_id","task_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "task_counters" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid,
	"name" text NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"on_hold_reason" text,
	"description" text,
	"start_date" date,
	"due_date" date,
	"estimate_hours" numeric(6, 2),
	"done_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "tasks_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "tasks_name_ck" CHECK (length(btrim("tasks"."name")) between 1 and 200),
	CONSTRAINT "tasks_status_ck" CHECK ("tasks"."status" in ('todo', 'in_progress', 'on_hold', 'done')),
	CONSTRAINT "tasks_hold_reason_ck" CHECK (("tasks"."status" = 'on_hold') = ("tasks"."on_hold_reason" is not null) and ("tasks"."on_hold_reason" is null or length(btrim("tasks"."on_hold_reason")) between 1 and 200)),
	CONSTRAINT "tasks_description_ck" CHECK ("tasks"."description" is null or length("tasks"."description") <= 10000),
	CONSTRAINT "tasks_dates_ck" CHECK ("tasks"."due_date" is null or "tasks"."start_date" is null or "tasks"."due_date" >= "tasks"."start_date"),
	CONSTRAINT "tasks_estimate_ck" CHECK ("tasks"."estimate_hours" is null or ("tasks"."estimate_hours" between 0.25 and 9999 and mod("tasks"."estimate_hours" * 4, 1) = 0))
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "notify_task_assigned" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_counters" ADD CONSTRAINT "task_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_assignments_tenant_employee_idx" ON "task_assignments" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_project_idx" ON "tasks" USING btree ("tenant_id","project_id");