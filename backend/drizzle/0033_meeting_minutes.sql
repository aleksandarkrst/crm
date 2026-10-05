CREATE TABLE "meeting_minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"summary" text,
	"agreements" text,
	"next_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_subject" text,
	"external_body" text,
	"external_prefilled_at" timestamp with time zone,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_minutes_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "meeting_minutes_meeting_uq" UNIQUE("tenant_id","meeting_id"),
	CONSTRAINT "meeting_minutes_length_ck" CHECK (coalesce(char_length("meeting_minutes"."summary"), 0) <= 10000 and coalesce(char_length("meeting_minutes"."agreements"), 0) <= 5000 and coalesce(char_length("meeting_minutes"."external_body"), 0) <= 10000)
);
--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_meeting_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."meetings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;