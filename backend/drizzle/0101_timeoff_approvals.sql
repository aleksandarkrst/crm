ALTER TABLE "timeoff_notices" DROP CONSTRAINT "timeoff_notices_kind_ck";--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "notify_timeoff_approvals" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "timeoff_notices" ADD CONSTRAINT "timeoff_notices_kind_ck" CHECK ("timeoff_notices"."kind" in ('carry_over_expiring', 'approval_reminder', 'manager_absent'));