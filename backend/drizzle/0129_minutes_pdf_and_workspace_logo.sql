ALTER TABLE "tenants" ADD COLUMN "logo_storage_key" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_content_type" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting_minutes_sends" ADD COLUMN "pdf_storage_key" text;--> statement-breakpoint
ALTER TABLE "meeting_minutes_sends" ADD COLUMN "pdf_file_name" text;