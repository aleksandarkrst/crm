CREATE TABLE "timesheet_notices" (
	"tenant_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"kind" text NOT NULL,
	"recipient" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_notices_pk" PRIMARY KEY("tenant_id","week_start","kind","recipient"),
	CONSTRAINT "timesheet_notices_kind_ck" CHECK ("timesheet_notices"."kind" in ('reminder', 'late', 'auto_submitted', 'late_summary'))
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_reminder_hours" smallint DEFAULT 2;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_after_deadline_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_notices" ADD CONSTRAINT "timesheet_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_timesheet_reminder_ck" CHECK ("tenants"."timesheet_reminder_hours" is null or "tenants"."timesheet_reminder_hours" between 1 and 72);