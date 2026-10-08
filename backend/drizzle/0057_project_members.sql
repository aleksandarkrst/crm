CREATE TABLE "project_members" (
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"role" text,
	"hours_per_week" numeric(4, 1) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_pk" PRIMARY KEY("tenant_id","project_id","employee_id"),
	CONSTRAINT "project_members_role_ck" CHECK ("project_members"."role" is null or length(btrim("project_members"."role")) between 1 and 100),
	CONSTRAINT "project_members_hours_ck" CHECK ("project_members"."hours_per_week" between 0 and 80)
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_members_tenant_employee_idx" ON "project_members" USING btree ("tenant_id","employee_id");