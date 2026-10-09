ALTER TABLE "timesheet_days" ADD COLUMN "first_submitted_at" timestamp with time zone;--> statement-breakpoint
-- Days already submitted, approved or rejected were first submitted at least when they were last (CD-155).
UPDATE "timesheet_days" SET "first_submitted_at" = coalesce("submitted_at", "created_at") WHERE "first_submitted_at" IS NULL;
