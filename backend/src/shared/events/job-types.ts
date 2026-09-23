/**
 * Every background job, with its payload type. Modules communicate asynchronously by sending
 * these jobs; the owning module registers the handler in the worker.
 *
 * Payloads carry tenantId so the handler can open a tenant-scoped transaction.
 */
export interface JobPayloads {
  /** Sent by CRM when a deal is won. Future owner: projects module (sales → delivery handover). */
  'crm.deal-won': { tenantId: string; dealId: string; actorUserId: string };
  /** Scheduled nightly by the worker. Placeholder for reporting snapshots. */
  'reporting.nightly': Record<string, never>;
}

export type JobName = keyof JobPayloads;

export const JOB_NAMES = ['crm.deal-won', 'reporting.nightly'] as const satisfies readonly JobName[];
