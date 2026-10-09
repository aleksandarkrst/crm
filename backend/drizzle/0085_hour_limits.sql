CREATE TABLE "task_limit_alerts" (
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_limit_alerts_pk" PRIMARY KEY("tenant_id","task_id","employee_id"),
	CONSTRAINT "task_limit_alerts_level_ck" CHECK ("task_limit_alerts"."level" in (0, 80, 100))
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "notify_hour_limits" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "hour_limit_mode" text DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_limit_alerts" ADD CONSTRAINT "task_limit_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_limit_alerts" ADD CONSTRAINT "task_limit_alerts_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_limit_alerts" ADD CONSTRAINT "task_limit_alerts_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_task_employee_idx" ON "time_entries" USING btree ("tenant_id","task_id","employee_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_hour_limit_mode_ck" CHECK ("tenants"."hour_limit_mode" in ('warn', 'block'));