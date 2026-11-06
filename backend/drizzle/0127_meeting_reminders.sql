CREATE TABLE "meeting_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"minutes_before" integer NOT NULL,
	"unit" text NOT NULL,
	"sent_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_reminders_unit_ck" CHECK ("meeting_reminders"."unit" in ('minutes', 'hours', 'days')),
	CONSTRAINT "meeting_reminders_minutes_ck" CHECK ("meeting_reminders"."minutes_before" between 0 and 40320 and "meeting_reminders"."minutes_before" % (case "meeting_reminders"."unit" when 'days' then 1440 when 'hours' then 60 else 1 end) = 0)
);
--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD CONSTRAINT "meeting_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD CONSTRAINT "meeting_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD CONSTRAINT "meeting_reminders_meeting_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."meetings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_reminders_tenant_meeting_idx" ON "meeting_reminders" USING btree ("tenant_id","meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_reminders_tenant_user_idx" ON "meeting_reminders" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_reminders_uq" ON "meeting_reminders" USING btree ("meeting_id","user_id","minutes_before");