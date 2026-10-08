CREATE TABLE "work_order_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_checklist_items_text_ck" CHECK (length(btrim("work_order_checklist_items"."text")) between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "work_place" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "materials" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "signed_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "signed_off_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order_checklist_items" ADD CONSTRAINT "work_order_checklist_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_checklist_items" ADD CONSTRAINT "work_order_checklist_items_wo_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_order_checklist_items_wo_idx" ON "work_order_checklist_items" USING btree ("tenant_id","work_order_id","position");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_signed_off_by_user_id_users_id_fk" FOREIGN KEY ("signed_off_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_place_ck" CHECK ("work_orders"."work_place" in ('customer', 'workshop'));--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_sign_off_ck" CHECK (length("work_orders"."materials") <= 5000 and length("work_orders"."customer_name") <= 200 and ("work_orders"."signed_off_at" is null or "work_orders"."customer_name" is not null));