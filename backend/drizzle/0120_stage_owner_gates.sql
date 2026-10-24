CREATE TABLE "deal_stage_states" (
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"docs_complete" boolean DEFAULT false NOT NULL,
	"docs_complete_at" timestamp with time zone,
	"docs_complete_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_stage_states_pk" PRIMARY KEY("tenant_id","deal_id","stage_id")
);
--> statement-breakpoint
ALTER TABLE "funnel_stages" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "funnel_stages" ADD COLUMN "target_days" integer;--> statement-breakpoint
ALTER TABLE "funnel_stages" ADD COLUMN "gate_docs_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "funnel_stages" ADD COLUMN "gate_todos" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "target_days" integer;--> statement-breakpoint
ALTER TABLE "deal_stage_states" ADD CONSTRAINT "deal_stage_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_states" ADD CONSTRAINT "deal_stage_states_docs_complete_by_user_id_users_id_fk" FOREIGN KEY ("docs_complete_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_states" ADD CONSTRAINT "deal_stage_states_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_states" ADD CONSTRAINT "deal_stage_states_stage_fk" FOREIGN KEY ("tenant_id","stage_id") REFERENCES "public"."funnel_stages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_stage_states_stage_idx" ON "deal_stage_states" USING btree ("tenant_id","stage_id");--> statement-breakpoint
ALTER TABLE "funnel_stages" ADD CONSTRAINT "funnel_stages_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_stages" ADD CONSTRAINT "funnel_stages_target_days_ck" CHECK ("funnel_stages"."target_days" is null or "funnel_stages"."target_days" between 1 and 365);--> statement-breakpoint
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_target_days_ck" CHECK ("funnels"."target_days" is null or "funnels"."target_days" between 1 and 365);