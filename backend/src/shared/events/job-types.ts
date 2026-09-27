/**
 * Every background job, with its payload type. Modules communicate asynchronously by sending
 * these jobs; the owning module registers the handler in the worker.
 *
 * Payloads carry tenantId so the handler can open a tenant-scoped transaction.
 */
export interface JobPayloads {
  /** Sent by CRM when a deal is won. Future owner: projects module (sales → delivery handover). */
  'crm.deal-won': { tenantId: string; dealId: string; actorUserId: string };
  /** Sent by CRM when someone generates a document on a deal (CD-13); the worker fills the template. */
  'crm.generate-document': { tenantId: string; documentId: string; actorUserId: string };
  /**
   * Sent by CRM when someone makes another member the owner of a deal (created for them or
   * reassigned). The notifications module emails the new owner if they want that (CD-16).
   */
  'crm.deal-assigned': { tenantId: string; dealId: string; assigneeUserId: string; actorUserId: string };
  /** Sent by identity when an invitation is created or resent; identity's worker handler emails it (CD-7). */
  'identity.invitation-email': { tenantId: string; invitationId: string };
  /** Cron (every 15 minutes): queues the daily digests of workspaces where it is morning now. */
  'notifications.digest-tick': Record<string, never>;
  /** One member's daily digest for one workspace and local date. `force` skips the "once a day" and "turned on" checks (dev trigger). */
  'notifications.daily-digest': { tenantId: string; userId: string; date: string; force?: boolean };
  /** Scheduled nightly by the worker: fails document generations that were interrupted (CD-100). Placeholder for reporting snapshots. */
  'reporting.nightly': Record<string, never>;
}

export type JobName = keyof JobPayloads;

export const JOB_NAMES = [
  'crm.deal-won',
  'crm.deal-assigned',
  'crm.generate-document',
  'identity.invitation-email',
  'notifications.digest-tick',
  'notifications.daily-digest',
  'reporting.nightly',
] as const satisfies readonly JobName[];

/** Jobs that send email: retried MAIL_RETRY_LIMIT times with backoff from MAIL_RETRY_DELAY_SECONDS. */
export const MAIL_JOBS: ReadonlySet<JobName> = new Set<JobName>(['crm.deal-assigned', 'identity.invitation-email', 'notifications.daily-digest']);
