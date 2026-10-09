CREATE TABLE "public_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	"minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_holidays_name_ck" CHECK (length(btrim("public_holidays"."name")) between 1 and 100),
	CONSTRAINT "public_holidays_minutes_ck" CHECK ("public_holidays"."minutes" is null or ("public_holidays"."minutes" between 15 and 1440 and "public_holidays"."minutes" % 15 = 0))
);
--> statement-breakpoint
CREATE TABLE "timesheet_deadline_runs" (
	"tenant_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_weeks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "timesheet_deadline_runs_pk" PRIMARY KEY("tenant_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "timesheet_weeks" (
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"late_at" timestamp with time zone,
	"auto_submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_weeks_pk" PRIMARY KEY("tenant_id","employee_id","week_start"),
	CONSTRAINT "timesheet_weeks_monday_ck" CHECK (extract(isodow from "timesheet_weeks"."week_start") = 1)
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_day_minutes" smallint DEFAULT 480 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_day_start" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_day_end" text DEFAULT '16:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_working_days" smallint[] DEFAULT '{1,2,3,4,5}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_time_format" text DEFAULT 'decimal' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_max_day_hours" smallint DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_deadline_weekday" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_deadline_time" text DEFAULT '17:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_deadline_week" text DEFAULT 'same' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_auto_submit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timesheet_auto_submit_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_deadline_runs" ADD CONSTRAINT "timesheet_deadline_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_holidays_date_uq" ON "public_holidays" USING btree ("tenant_id","holiday_date");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_timesheet_ck" CHECK ("tenants"."timesheet_day_minutes" between 15 and 1440 and "tenants"."timesheet_day_minutes" % 15 = 0
        and "tenants"."timesheet_day_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "tenants"."timesheet_day_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "tenants"."timesheet_day_end" > "tenants"."timesheet_day_start"
        and "tenants"."timesheet_working_days" <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality("tenants"."timesheet_working_days") between 1 and 7
        and "tenants"."timesheet_time_format" in ('decimal', 'clock') and "tenants"."timesheet_max_day_hours" between 1 and 24
        and "tenants"."timesheet_deadline_weekday" between 1 and 7 and "tenants"."timesheet_deadline_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "tenants"."timesheet_deadline_week" in ('same', 'next'));