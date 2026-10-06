ALTER TABLE "activities" ALTER COLUMN "channel" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "external_prefill" jsonb;