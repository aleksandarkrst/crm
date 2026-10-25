ALTER TABLE "memberships" ADD COLUMN "notify_proposal_approvals" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_documents" ADD COLUMN "source" text DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_documents" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "approval_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "approval_requested_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "proposal_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "proposal_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "approver_user_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_approval_requested_by_user_id_users_id_fk" FOREIGN KEY ("approval_requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;