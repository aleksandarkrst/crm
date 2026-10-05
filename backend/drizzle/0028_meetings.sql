CREATE TABLE "meeting_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_participants_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "meeting_participants_kind_ck" CHECK ("meeting_participants"."kind" in ('internal', 'external') and ("meeting_participants"."kind" = 'internal' or "meeting_participants"."user_id" is null) and ("meeting_participants"."kind" = 'external' or "meeting_participants"."contact_id" is null))
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text,
	"agenda" text,
	"company_id" uuid NOT NULL,
	"deal_id" uuid,
	"organizer_user_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"cancel_reason" text,
	"held_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "meetings_time_ck" CHECK ("meetings"."ends_at" > "meetings"."starts_at"),
	CONSTRAINT "meetings_type_ck" CHECK ("meetings"."type" in ('visit', 'online', 'office', 'phone')),
	CONSTRAINT "meetings_status_ck" CHECK ("meetings"."status" in ('planned', 'held', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."meetings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_user_id_users_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_participants_tenant_meeting_idx" ON "meeting_participants" USING btree ("tenant_id","meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_participants_tenant_user_idx" ON "meeting_participants" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "meeting_participants_tenant_contact_idx" ON "meeting_participants" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_participants_user_uq" ON "meeting_participants" USING btree ("meeting_id","user_id") WHERE "meeting_participants"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_participants_contact_uq" ON "meeting_participants" USING btree ("meeting_id","contact_id") WHERE "meeting_participants"."contact_id" is not null;--> statement-breakpoint
CREATE INDEX "meetings_tenant_starts_idx" ON "meetings" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "meetings_tenant_company_idx" ON "meetings" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "meetings_tenant_deal_idx" ON "meetings" USING btree ("tenant_id","deal_id");--> statement-breakpoint
CREATE INDEX "meetings_tenant_organizer_idx" ON "meetings" USING btree ("tenant_id","organizer_user_id");