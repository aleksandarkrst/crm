ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_target_ck";--> statement-breakpoint
ALTER TABLE "timesheet_rows" DROP CONSTRAINT "timesheet_rows_target_ck";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_project_time" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_project_idx" ON "time_entries" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_rows_project_uq" ON "timesheet_rows" USING btree ("tenant_id","employee_id","week_start","project_id") WHERE "timesheet_rows"."project_id" is not null;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_target_ck" CHECK (num_nonnulls("time_entries"."task_id", "time_entries"."work_order_id", "time_entries"."project_id") = 1);--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_target_ck" CHECK (num_nonnulls("timesheet_rows"."task_id", "timesheet_rows"."work_order_id", "timesheet_rows"."project_id") = 1);