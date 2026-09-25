ALTER TABLE "deal_lines" ADD COLUMN "discount_kind" text DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_lines" ADD COLUMN "discount_value" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_lines" ADD COLUMN "billing_frequency" text DEFAULT 'one_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_lines" ADD COLUMN "billing_cycles" integer;--> statement-breakpoint
ALTER TABLE "deal_lines" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "tax_mode" text DEFAULT 'exclusive' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "discounts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "installments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "quantity" numeric(12, 2) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "billing_frequency" text DEFAULT 'one_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "billing_cycles" integer;--> statement-breakpoint
ALTER TABLE "deal_lines" ADD CONSTRAINT "deal_lines_billing_cycles_ck" CHECK ("deal_lines"."billing_cycles" is null or "deal_lines"."billing_cycles" between 1 and 1000);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_billing_cycles_ck" CHECK ("products"."billing_cycles" is null or "products"."billing_cycles" between 1 and 1000);--> statement-breakpoint

-- CD-83: products are priced per unit with a default quantity and a billing frequency, and have no
-- currency (a deal line takes the number in its deal's currency). Deal lines bill once or every
-- period for their cycles, instead of a payment schedule. Converted from the old columns:
-- a Monthly/Yearly product bills monthly/annually, an Hourly one is sold by the hour; a line on a
-- "Recurring subscription" bills monthly until canceled, every other line once. Old milestone and
-- instalment splits are not carried over. products, deal_lines and deals force RLS even for their
-- owner, so the conversion lifts that for its statements (like 0008).
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_lines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deals" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "products" SET
  "billing_frequency" = CASE "billing_kind" WHEN 'Monthly' THEN 'monthly' WHEN 'Yearly' THEN 'annually' ELSE 'one_time' END,
  "unit" = CASE "billing_kind" WHEN 'Hourly' THEN 'hour' END;--> statement-breakpoint
UPDATE "deal_lines" SET "billing_frequency" = CASE "schedule" WHEN 'Recurring subscription' THEN 'monthly' ELSE 'one_time' END;--> statement-breakpoint
-- The deal value is the contract value without tax; "until canceled" counts one year of cycles.
-- The recalculation is a conversion, not an edit: it skips the change history (record_changes forces
-- RLS too, and there is no author) and keeps each deal's version, so open edits don't get a 409.
ALTER TABLE "deals" DISABLE TRIGGER "deals_history";--> statement-breakpoint
ALTER TABLE "deals" DISABLE TRIGGER "deals_version";--> statement-breakpoint
UPDATE "deals" d SET "amount" = x.total FROM (
  SELECT "deal_id", round(sum("quantity" * "unit_price" * CASE "billing_frequency" WHEN 'one_time' THEN 1
    WHEN 'weekly' THEN coalesce("billing_cycles", 52) WHEN 'monthly' THEN coalesce("billing_cycles", 12)
    WHEN 'quarterly' THEN coalesce("billing_cycles", 4) ELSE coalesce("billing_cycles", 1) END), 2) AS total
  FROM "deal_lines" GROUP BY "deal_id") x
WHERE d."id" = x."deal_id" AND d."amount" IS DISTINCT FROM x.total;--> statement-breakpoint
ALTER TABLE "deals" ENABLE TRIGGER "deals_version";--> statement-breakpoint
ALTER TABLE "deals" ENABLE TRIGGER "deals_history";--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Change history (CD-69): deal lines record their new fields, and deals their tax mode, discounts
-- and installments.
CREATE OR REPLACE FUNCTION crm_line_json(r jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT jsonb_build_object('lineId', r -> 'id', 'productId', r -> 'product_id', 'description', r -> 'description', 'quantity', r -> 'quantity',
    'unitPrice', r -> 'unit_price', 'discountKind', r -> 'discount_kind', 'discountValue', r -> 'discount_value', 'vatRate', r -> 'vat_rate',
    'billingFrequency', r -> 'billing_frequency', 'billingCycles', r -> 'billing_cycles', 'startDate', r -> 'start_date') $$;
--> statement-breakpoint
DROP TRIGGER "deals_history" ON "deals";--> statement-breakpoint
CREATE TRIGGER deals_history AFTER INSERT OR UPDATE OR DELETE ON "deals" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'deal', 'title', 'title:title', 'funnel_id:funnelId', 'stage_id:stageId', 'company_id:companyId', 'primary_contact_id:primaryContactId',
  'owner_user_id:ownerUserId', 'source:source', 'amount:amount', 'currency:currency', 'close_date:closeDate', 'fit_score:fitScore',
  'headline:headline', 'discovery_need:need', 'discovery_constraint:constraint', 'decision_maker:decisionMaker', 'discovery_date:discoveryDate',
  'lost_reason:lostReason', 'lost_note:lostNote', 'tax_mode:taxMode', 'discounts:discounts', 'installments:installments');
--> statement-breakpoint

ALTER TABLE "deal_lines" DROP CONSTRAINT "deal_lines_months_ck";--> statement-breakpoint
ALTER TABLE "deal_lines" DROP COLUMN "schedule";--> statement-breakpoint
ALTER TABLE "deal_lines" DROP COLUMN "months";--> statement-breakpoint
ALTER TABLE "deal_lines" DROP COLUMN "milestones";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "billing_kind";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "currency";
