CREATE TABLE "deal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"product_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"schedule" text DEFAULT 'Full amount on one date' NOT NULL,
	"start_date" date,
	"months" integer DEFAULT 6 NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_lines_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "deal_lines_months_ck" CHECK ("deal_lines"."months" between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "deal_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"label" text NOT NULL,
	"off_playbook" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_user_id" uuid,
	"outcome" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_lines" ADD CONSTRAINT "deal_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_lines" ADD CONSTRAINT "deal_lines_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_lines" ADD CONSTRAINT "deal_lines_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_done_by_user_id_users_id_fk" FOREIGN KEY ("done_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_stage_fk" FOREIGN KEY ("tenant_id","stage_id") REFERENCES "public"."funnel_stages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_lines_tenant_deal_idx" ON "deal_lines" USING btree ("tenant_id","deal_id");--> statement-breakpoint
CREATE INDEX "deal_tasks_tenant_deal_idx" ON "deal_tasks" USING btree ("tenant_id","deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_tasks_playbook_uq" ON "deal_tasks" USING btree ("deal_id","stage_id","label") WHERE not "deal_tasks"."off_playbook";