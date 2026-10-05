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
  /**
   * Sent by CRM when a member is added to a meeting by someone else, or a planned meeting's time or
   * place changes, or it is cancelled (or restored). The CRM worker emails each of `userIds` (one
   * job per member, so a retry doesn't email the others again) with an .ics, if they still take
   * part and want "Meeting invitations" (CD-131).
   */
  'crm.meeting-invite': { tenantId: string; meetingId: string; userIds: string[]; actorUserId: string; kind: 'added' | 'updated' | 'cancelled' };
  /**
   * Sent by CRM when someone sends a meeting's external minutes to the customer, or retries the
   * recipients that failed (CD-133). The CRM worker sends one email to the send's recipients still
   * queued (to: contacts, cc: members) and records each one's status.
   */
  'crm.meeting-minutes-email': { tenantId: string; sendId: string };
  /** Sent by identity when someone removes a member or a member leaves; CRM takes them off future meetings (CD-131). */
  'identity.member-removed': { tenantId: string; userId: string };
  /**
   * Sent by CRM when someone other than the salesperson creates or changes their visit plan
   * (CD-134). The notifications module emails the salesperson if they want that.
   */
  'crm.visit-plan-email': { tenantId: string; planId: string; actorUserId: string; kind: 'created' | 'changed' };
  /** Sent by identity when an invitation is created or resent; identity's worker handler emails it (CD-7). */
  'identity.invitation-email': { tenantId: string; invitationId: string };
  /** Sent by identity when someone creates an account with email; the worker emails the confirmation link (CD-114). */
  'identity.signup-email': { requestId: string };
  /**
   * Sent by people when an employee's IBAN or foreign currency IBAN is added, changed or removed,
   * by anyone (milestone 13, spec 10.2). The people worker emails the employee (sign-in email if
   * linked, else work email) the masked numbers and who changed them. Masks only, never a number.
   */
  'people.bank-account-changed-email': {
    tenantId: string;
    employeeId: string;
    actorUserId: string | null;
    changes: { account: 'iban' | 'fxIban'; kind: 'added' | 'changed' | 'removed'; masked: string }[];
  };
  /**
   * Cron (every 15 minutes, in UTC; milestone 13, spec 4.8): in each workspace where it is past
   * 00:05 local time, applies the deactivations whose last working day is over (status Leaving →
   * Inactive), with the choices stored in employees.deactivation_plan. `now` and `tenantId` are
   * for the dev trigger (POST /api/dev/people/deactivate-due) only.
   */
  'people.deactivate-due': { now?: string; tenantId?: string };
  /**
   * Sent by people when an employee's deactivation is applied (now, or by people.deactivate-due):
   * they are Inactive, their reports moved, their membership (if any, `userId`) removed. Other
   * modules react: CRM takes `userId` off future planned meetings like identity.member-removed.
   */
  'people.employee-deactivated': { tenantId: string; employeeId: string; userId: string | null };
  /**
   * Sent by people for "Invite selected" (the list) and the import's "Invite imported employees"
   * (spec 4.7, 5.4, 8.6): the people worker creates an invitation through identity for each
   * employee that still has a work email, no account and no pending invitation.
   */
  'people.bulk-invite': { tenantId: string; actorUserId: string; employeeIds: string[]; role: 'admin' | 'member' };
  /**
   * Sent by people when an Admin gives an employee Administration or Payroll, or takes it away
   * (CD-142, spec 10.2). The people worker emails the employee (sign-in email if linked, else work
   * email) "Role granted" or "Role removed". Can't be turned off; no personal details.
   */
  'people.role-changed-email': { tenantId: string; employeeId: string; role: 'administration' | 'payroll'; kind: 'granted' | 'removed'; actorUserId: string };
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
  'crm.meeting-invite',
  'crm.meeting-minutes-email',
  'crm.visit-plan-email',
  'identity.invitation-email',
  'identity.member-removed',
  'identity.signup-email',
  'notifications.digest-tick',
  'notifications.daily-digest',
  'people.bank-account-changed-email',
  'people.bulk-invite',
  'people.deactivate-due',
  'people.employee-deactivated',
  'people.role-changed-email',
  'reporting.nightly',
] as const satisfies readonly JobName[];

/** Jobs that send email: retried MAIL_RETRY_LIMIT times with backoff from MAIL_RETRY_DELAY_SECONDS. */
export const MAIL_JOBS: ReadonlySet<JobName> = new Set<JobName>(['crm.deal-assigned', 'crm.meeting-invite', 'crm.meeting-minutes-email', 'crm.visit-plan-email', 'identity.invitation-email', 'identity.signup-email', 'notifications.daily-digest', 'people.bank-account-changed-email', 'people.role-changed-email']);
