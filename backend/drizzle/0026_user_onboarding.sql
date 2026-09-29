ALTER TABLE "users" ADD COLUMN "onboarding_steps" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
-- CD-115: people who already use a workspace are returning users and go straight to the app.
UPDATE "users" SET "onboarded_at" = "created_at", "onboarding_steps" = '{profile,team}'
  WHERE EXISTS (SELECT 1 FROM "memberships" m WHERE m."user_id" = "users"."id");
