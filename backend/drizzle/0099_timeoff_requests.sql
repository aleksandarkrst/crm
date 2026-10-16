CREATE TABLE "public_holiday_preloads" (
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"country" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_holiday_preloads_pk" PRIMARY KEY("tenant_id","year"),
	CONSTRAINT "public_holiday_preloads_year_ck" CHECK ("public_holiday_preloads"."year" between 2000 and 2100)
);
--> statement-breakpoint
CREATE TABLE "timeoff_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"max_days" integer,
	"counts_toward_limit" boolean DEFAULT false NOT NULL,
	"paid_by_employer" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeoff_reasons_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "timeoff_reasons_kind_ck" CHECK ("timeoff_reasons"."kind" in ('paid_leave', 'other_absence')),
	CONSTRAINT "timeoff_reasons_name_ck" CHECK (length(btrim("timeoff_reasons"."name")) between 1 and 100),
	CONSTRAINT "timeoff_reasons_max_days_ck" CHECK ("timeoff_reasons"."max_days" is null or "timeoff_reasons"."max_days" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "timeoff_request_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"pool_year" integer,
	"state" text DEFAULT 'counted' NOT NULL,
	CONSTRAINT "timeoff_request_days_state_ck" CHECK ("timeoff_request_days"."state" in ('counted', 'interrupted', 'cancelled', 'returned')),
	CONSTRAINT "timeoff_request_days_pool_ck" CHECK ("timeoff_request_days"."pool_year" is null or "timeoff_request_days"."pool_year" between 2000 and 2100)
);
--> statement-breakpoint
CREATE TABLE "timeoff_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"reason_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"working_days" integer NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded" boolean DEFAULT false NOT NULL,
	"record_reason" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeoff_requests_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "timeoff_requests_type_ck" CHECK ("timeoff_requests"."type" in ('vacation', 'paid_leave', 'unpaid_leave', 'other_absence')),
	CONSTRAINT "timeoff_requests_status_ck" CHECK ("timeoff_requests"."status" in ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')),
	CONSTRAINT "timeoff_requests_dates_ck" CHECK ("timeoff_requests"."end_date" >= "timeoff_requests"."start_date" and "timeoff_requests"."end_date" <= "timeoff_requests"."start_date" + 366),
	CONSTRAINT "timeoff_requests_reason_ck" CHECK (("timeoff_requests"."type" in ('paid_leave', 'other_absence')) = ("timeoff_requests"."reason_id" is not null)),
	CONSTRAINT "timeoff_requests_days_ck" CHECK ("timeoff_requests"."working_days" between 0 and 260),
	CONSTRAINT "timeoff_requests_note_ck" CHECK ("timeoff_requests"."note" is null or length("timeoff_requests"."note") <= 500),
	CONSTRAINT "timeoff_requests_record_ck" CHECK ("timeoff_requests"."record_reason" is null or length(btrim("timeoff_requests"."record_reason")) between 1 and 300),
	CONSTRAINT "timeoff_requests_comment_ck" CHECK ("timeoff_requests"."decision_comment" is null or length("timeoff_requests"."decision_comment") <= 500)
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "holiday_preload" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timeoff_paid_leave_yearly_limit" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD COLUMN "repeats" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "public_holiday_preloads" ADD CONSTRAINT "public_holiday_preloads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_reasons" ADD CONSTRAINT "timeoff_reasons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_request_days" ADD CONSTRAINT "timeoff_request_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_request_days" ADD CONSTRAINT "timeoff_request_days_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."timeoff_requests"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_request_days" ADD CONSTRAINT "timeoff_request_days_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_requests" ADD CONSTRAINT "timeoff_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_requests" ADD CONSTRAINT "timeoff_requests_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_requests" ADD CONSTRAINT "timeoff_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_requests" ADD CONSTRAINT "timeoff_requests_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_requests" ADD CONSTRAINT "timeoff_requests_reason_fk" FOREIGN KEY ("tenant_id","reason_id") REFERENCES "public"."timeoff_reasons"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "timeoff_reasons_name_uq" ON "timeoff_reasons" USING btree ("tenant_id","kind",lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "timeoff_request_days_counted_uq" ON "timeoff_request_days" USING btree ("tenant_id","employee_id","date") WHERE "timeoff_request_days"."state" = 'counted';--> statement-breakpoint
CREATE INDEX "timeoff_request_days_request_idx" ON "timeoff_request_days" USING btree ("tenant_id","request_id");--> statement-breakpoint
CREATE INDEX "timeoff_request_days_employee_idx" ON "timeoff_request_days" USING btree ("tenant_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "timeoff_requests_employee_idx" ON "timeoff_requests" USING btree ("tenant_id","employee_id","start_date");--> statement-breakpoint
CREATE INDEX "timeoff_requests_status_idx" ON "timeoff_requests" USING btree ("tenant_id","status","start_date");--> statement-breakpoint
CREATE INDEX "timeoff_requests_reason_idx" ON "timeoff_requests" USING btree ("tenant_id","reason_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_holiday_preload_ck" CHECK ("tenants"."holiday_preload" in ('none', 'serbia'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_timeoff_paid_leave_limit_ck" CHECK ("tenants"."timeoff_paid_leave_yearly_limit" between 0 and 60);--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_source_ck" CHECK ("public_holidays"."source" in ('manual', 'preload'));