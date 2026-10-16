CREATE TABLE "sick_leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"payer_note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sick_leave_types_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "sick_leave_types_name_ck" CHECK (length(btrim("sick_leave_types"."name")) between 1 and 100),
	CONSTRAINT "sick_leave_types_payer_ck" CHECK ("sick_leave_types"."payer_note" is null or length("sick_leave_types"."payer_note") <= 300)
);
--> statement-breakpoint
CREATE TABLE "sick_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"type_id" uuid,
	"continuation_of_id" uuid,
	"sick_note_ref" text,
	"note" text,
	"status" text DEFAULT 'reported' NOT NULL,
	"cancel_reason" text,
	"reported_by_user_id" uuid,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sick_leaves_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "sick_leaves_status_ck" CHECK ("sick_leaves"."status" in ('reported', 'confirmed', 'cancelled')),
	CONSTRAINT "sick_leaves_dates_ck" CHECK ("sick_leaves"."end_date" is null or "sick_leaves"."end_date" >= "sick_leaves"."start_date"),
	CONSTRAINT "sick_leaves_confirmed_ck" CHECK ("sick_leaves"."status" <> 'confirmed' or "sick_leaves"."type_id" is not null),
	CONSTRAINT "sick_leaves_ref_ck" CHECK ("sick_leaves"."sick_note_ref" is null or length("sick_leaves"."sick_note_ref") <= 50),
	CONSTRAINT "sick_leaves_note_ck" CHECK ("sick_leaves"."note" is null or length("sick_leaves"."note") <= 500),
	CONSTRAINT "sick_leaves_cancel_ck" CHECK ("sick_leaves"."status" <> 'cancelled' or "sick_leaves"."cancel_reason" is not null),
	CONSTRAINT "sick_leaves_continuation_ck" CHECK ("sick_leaves"."continuation_of_id" is null or "sick_leaves"."continuation_of_id" <> "sick_leaves"."id")
);
--> statement-breakpoint
ALTER TABLE "timeoff_notices" DROP CONSTRAINT "timeoff_notices_kind_ck";--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "notify_sick_leave" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "timeoff_request_days" ADD COLUMN "sick_leave_id" uuid;--> statement-breakpoint
ALTER TABLE "sick_leave_types" ADD CONSTRAINT "sick_leave_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sick_leaves" ADD CONSTRAINT "sick_leaves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sick_leaves" ADD CONSTRAINT "sick_leaves_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sick_leaves" ADD CONSTRAINT "sick_leaves_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sick_leaves" ADD CONSTRAINT "sick_leaves_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sick_leaves" ADD CONSTRAINT "sick_leaves_type_fk" FOREIGN KEY ("tenant_id","type_id") REFERENCES "public"."sick_leave_types"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sick_leaves" ADD CONSTRAINT "sick_leaves_continuation_fk" FOREIGN KEY ("tenant_id","continuation_of_id") REFERENCES "public"."sick_leaves"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sick_leave_types_name_uq" ON "sick_leave_types" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "sick_leaves_employee_idx" ON "sick_leaves" USING btree ("tenant_id","employee_id","start_date");--> statement-breakpoint
CREATE INDEX "sick_leaves_status_idx" ON "sick_leaves" USING btree ("tenant_id","status","start_date");--> statement-breakpoint
CREATE INDEX "sick_leaves_type_idx" ON "sick_leaves" USING btree ("tenant_id","type_id");--> statement-breakpoint
ALTER TABLE "timeoff_request_days" ADD CONSTRAINT "timeoff_request_days_sick_leave_fk" FOREIGN KEY ("tenant_id","sick_leave_id") REFERENCES "public"."sick_leaves"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timeoff_request_days_sick_idx" ON "timeoff_request_days" USING btree ("tenant_id","sick_leave_id");--> statement-breakpoint
ALTER TABLE "timeoff_notices" ADD CONSTRAINT "timeoff_notices_kind_ck" CHECK ("timeoff_notices"."kind" in ('carry_over_expiring', 'approval_reminder', 'manager_absent', 'sick_leave_check'));