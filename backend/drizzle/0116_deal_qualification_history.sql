-- Deal history (CD-362): the qualification fields are recorded like the others (who named the sponsor,
-- changed the pain, turned Qualified on). Qualified is recorded as its date; the history row's actor is
-- who switched it. The trigger is recreated with the longer column list; the function is unchanged.
DROP TRIGGER "deals_history" ON "deals";--> statement-breakpoint
CREATE TRIGGER deals_history AFTER INSERT OR UPDATE OR DELETE ON "deals" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'deal', 'title', 'title:title', 'funnel_id:funnelId', 'stage_id:stageId', 'company_id:companyId', 'primary_contact_id:primaryContactId',
  'owner_user_id:ownerUserId', 'source:source', 'amount:amount', 'currency:currency', 'close_date:closeDate', 'fit_score:fitScore',
  'headline:headline', 'discovery_need:need', 'discovery_constraint:constraint', 'decision_maker:decisionMaker', 'discovery_date:discoveryDate',
  'lost_reason:lostReason', 'lost_note:lostNote', 'tax_mode:taxMode', 'discounts:discounts', 'installments:installments',
  'sponsor_contact_id:sponsorContactId', 'power_sponsor_contact_id:powerSponsorContactId', 'pain:pain', 'pain_solution:painSolution',
  'qualification_steps:qualificationSteps', 'qualification_other:qualificationOther', 'qualified_at:qualifiedAt');
