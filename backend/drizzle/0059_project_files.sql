CREATE TABLE "project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"folder" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"added_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_files_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "project_files_name_ck" CHECK (length(btrim("project_files"."name")) between 1 and 255),
	CONSTRAINT "project_files_folder_ck" CHECK ("project_files"."folder" in ('Contract', 'Brief', 'Design', 'Client material', 'Deliverable')),
	CONSTRAINT "project_files_size_ck" CHECK ("project_files"."size_bytes" between 0 and 26214400)
);
--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_files_tenant_project_idx" ON "project_files" USING btree ("tenant_id","project_id");