CREATE TABLE "timesheet_absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"minutes" integer NOT NULL,
	"source_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_absences_kind_ck" CHECK ("timesheet_absences"."kind" in ('vacation', 'paid_leave', 'unpaid_leave', 'other_absence', 'sick_leave')),
	CONSTRAINT "timesheet_absences_minutes_ck" CHECK ("timesheet_absences"."minutes" between 1 and 1440),
	CONSTRAINT "timesheet_absences_label_ck" CHECK (length("timesheet_absences"."label") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "timesheet_day_events" DROP CONSTRAINT "timesheet_day_events_kind_ck";--> statement-breakpoint
ALTER TABLE "timesheet_absences" ADD CONSTRAINT "timesheet_absences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_absences" ADD CONSTRAINT "timesheet_absences_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_absences_day_uq" ON "timesheet_absences" USING btree ("tenant_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX "timesheet_absences_source_idx" ON "timesheet_absences" USING btree ("tenant_id","source_id");--> statement-breakpoint
ALTER TABLE "timesheet_day_events" ADD CONSTRAINT "timesheet_day_events_kind_ck" CHECK ("timesheet_day_events"."kind" in ('submitted', 'auto_submitted', 'recalled', 'approved', 'returned', 'resubmitted', 'unlocked', 'absence_changed'));