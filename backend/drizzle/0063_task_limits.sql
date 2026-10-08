CREATE TABLE "task_time_fixtures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_assignments" ADD COLUMN "hour_limit" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "task_time_fixtures" ADD CONSTRAINT "task_time_fixtures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_time_fixtures" ADD CONSTRAINT "task_time_fixtures_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_time_fixtures_task_idx" ON "task_time_fixtures" USING btree ("tenant_id","task_id");--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_limit_ck" CHECK ("task_assignments"."hour_limit" is null or ("task_assignments"."hour_limit" between 0.25 and 9999 and mod("task_assignments"."hour_limit" * 4, 1) = 0));