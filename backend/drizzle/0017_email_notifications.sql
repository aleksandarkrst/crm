CREATE TABLE "daily_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"digest_date" date NOT NULL,
	"status" text NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_digests_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "daily_digests_member_date_uq" UNIQUE("tenant_id","user_id","digest_date")
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "token_sealed" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "email_status" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "email_error" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "notify_deal_assigned" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_digests" ADD CONSTRAINT "daily_digests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_digests" ADD CONSTRAINT "daily_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_digests_tenant_date_idx" ON "daily_digests" USING btree ("tenant_id","digest_date");