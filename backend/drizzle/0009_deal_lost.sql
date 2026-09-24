ALTER TABLE "deals" ADD COLUMN "lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "lost_note" text;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_lost_ck" CHECK (("deals"."lost_at" is null) = ("deals"."lost_reason" is null) and ("deals"."lost_note" is null or "deals"."lost_at" is not null));