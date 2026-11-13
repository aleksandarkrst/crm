/**
 * Visit plans (CD-134) and their Reports page (CD-135) are switched off for now (CD-522): no
 * sidebar entries, no "Go to" commands, no Overview card, no visit counts on a company, no
 * notification setting, and their URLs go to Overview. The screens, store, API and data stay;
 * set this to true (and VISIT_PLANS_ENABLED in backend/src/modules/crm/visit-plans/feature.ts)
 * to bring them back.
 */
export const VISIT_PLANS_ENABLED: boolean = false;
