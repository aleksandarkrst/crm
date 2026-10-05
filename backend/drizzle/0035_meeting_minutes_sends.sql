CREATE TABLE "meeting_minutes_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"send_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"contact_id" uuid,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_minutes_recipients_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "meeting_minutes_recipients_kind_ck" CHECK ("meeting_minutes_recipients"."kind" in ('to', 'cc') and ("meeting_minutes_recipients"."kind" = 'cc' or "meeting_minutes_recipients"."user_id" is null) and ("meeting_minutes_recipients"."kind" = 'to' or "meeting_minutes_recipients"."contact_id" is null)),
	CONSTRAINT "meeting_minutes_recipients_status_ck" CHECK ("meeting_minutes_recipients"."status" in ('queued', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "meeting_minutes_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"sender_user_id" uuid,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"language" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_minutes_sends_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "meeting_minutes_sends_language_ck" CHECK ("meeting_minutes_sends"."language" in ('en', 'sr')),
	CONSTRAINT "meeting_minutes_sends_length_ck" CHECK (char_length("meeting_minutes_sends"."subject") <= 300 and char_length("meeting_minutes_sends"."body") <= 10000)
);
--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "external_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "external_updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting_minutes_recipients" ADD CONSTRAINT "meeting_minutes_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes_recipients" ADD CONSTRAINT "meeting_minutes_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes_recipients" ADD CONSTRAINT "meeting_minutes_recipients_send_fk" FOREIGN KEY ("tenant_id","send_id") REFERENCES "public"."meeting_minutes_sends"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes_recipients" ADD CONSTRAINT "meeting_minutes_recipients_meeting_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."meetings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes_sends" ADD CONSTRAINT "meeting_minutes_sends_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes_sends" ADD CONSTRAINT "meeting_minutes_sends_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes_sends" ADD CONSTRAINT "meeting_minutes_sends_meeting_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."meetings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_minutes_recipients_tenant_send_idx" ON "meeting_minutes_recipients" USING btree ("tenant_id","send_id");--> statement-breakpoint
CREATE INDEX "meeting_minutes_recipients_tenant_meeting_idx" ON "meeting_minutes_recipients" USING btree ("tenant_id","meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_minutes_recipients_tenant_contact_idx" ON "meeting_minutes_recipients" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "meeting_minutes_sends_tenant_meeting_idx" ON "meeting_minutes_sends" USING btree ("tenant_id","meeting_id","created_at");--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_external_updated_by_user_id_users_id_fk" FOREIGN KEY ("external_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;