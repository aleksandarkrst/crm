/**
 * Visit plans are switched off in the app for now (CD-522): no "Your visit plan" email is queued or
 * sent (a queued one is dropped), and the daily digest has no visit plan lines. The API, tables and
 * each person's "Visit plans" email setting stay; set this to true (and VISIT_PLANS_ENABLED in
 * frontend/src/lib/features.ts) to bring them back.
 */
export const VISIT_PLANS_ENABLED: boolean = false;
