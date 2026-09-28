CREATE TABLE "signup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"purpose" text DEFAULT 'signup' NOT NULL,
	"token_hash" text NOT NULL,
	"token_sealed" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "signup_requests_email_idx" ON "signup_requests" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));