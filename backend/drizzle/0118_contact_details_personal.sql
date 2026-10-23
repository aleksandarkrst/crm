ALTER TABLE "contacts" ALTER COLUMN "buyer_role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "buyer_role" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "org_unit" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "influence" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "birthday" date;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "spouse_name" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "children" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "pets" text;--> statement-breakpoint
ALTER TABLE "employee_personal" ADD COLUMN "spouse" text;--> statement-breakpoint
ALTER TABLE "employee_personal" ADD COLUMN "children" text;--> statement-breakpoint
ALTER TABLE "employee_personal" ADD COLUMN "pets" text;