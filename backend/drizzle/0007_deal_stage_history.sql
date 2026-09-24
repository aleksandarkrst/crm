CREATE TABLE "deal_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_user_id" uuid,
	CONSTRAINT "deal_stage_history_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_from_stage_fk" FOREIGN KEY ("tenant_id","from_stage_id") REFERENCES "public"."funnel_stages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_to_stage_fk" FOREIGN KEY ("tenant_id","to_stage_id") REFERENCES "public"."funnel_stages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_stage_history_tenant_deal_idx" ON "deal_stage_history" USING btree ("tenant_id","deal_id","changed_at");