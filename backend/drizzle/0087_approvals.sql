CREATE TABLE "timesheet_day_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text,
	"comment" text,
	"approval_mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_day_events_kind_ck" CHECK ("timesheet_day_events"."kind" in ('submitted', 'auto_submitted', 'recalled', 'approved', 'returned', 'resubmitted', 'unlocked')),
	CONSTRAINT "timesheet_day_events_mode_ck" CHECK ("timesheet_day_events"."approval_mode" in ('week', 'day')),
	CONSTRAINT "timesheet_day_events_comment_ck" CHECK ("timesheet_day_events"."comment" is null or length("timesheet_day_events"."comment") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD COLUMN "returned_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "timesheet_day_events" ADD CONSTRAINT "timesheet_day_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_day_events" ADD CONSTRAINT "timesheet_day_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_day_events" ADD CONSTRAINT "timesheet_day_events_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timesheet_day_events_day_idx" ON "timesheet_day_events" USING btree ("tenant_id","employee_id","work_date");--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD CONSTRAINT "timesheet_days_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD CONSTRAINT "timesheet_days_returned_by_user_id_users_id_fk" FOREIGN KEY ("returned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_days" ADD CONSTRAINT "timesheet_days_comment_ck" CHECK ("timesheet_days"."comment" is null or length("timesheet_days"."comment") between 1 and 1000);