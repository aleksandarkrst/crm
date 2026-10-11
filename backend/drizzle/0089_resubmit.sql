ALTER TABLE "timesheet_days" ADD COLUMN "resubmitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD COLUMN "reply" text;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD CONSTRAINT "timesheet_days_reply_ck" CHECK ("timesheet_days"."reply" is null or length("timesheet_days"."reply") between 1 and 1000);