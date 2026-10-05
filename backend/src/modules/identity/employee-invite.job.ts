import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import type { SecretBox } from '../../infrastructure/crypto/secret-box';
import { AuditService } from '../../shared/audit/audit.service';
import { DatabaseService } from '../../shared/database/database.service';
import { invitations, memberships, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { JobsService } from '../../shared/events/jobs.service';
import { employeesToInvite } from '../people';
import { inviteLinkBox } from './invitation-email';

const INVITE_TTL_DAYS = 7;

/**
 * Worker side of "Invite imported employees to Pultly" (CD-141, spec 8.6): the people module's
 * import queues one `people.import-invite` job with the new employees; this invites each one with a
 * work email as a Member, exactly like Settings → Team does (7 days, single use, bound to the email,
 * the link sealed for Resend and Copy link), with the invitation linked to the employee
 * (`employee_id`), so accepting it links the account to that record (spec 4.6). Employees who are
 * already members, already invited, linked or inactive are skipped. Nothing is sent unless the
 * person who imported is still an owner or admin. One transaction, so a retry starts clean.
 */
@Injectable()
export class EmployeeInviteJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmployeeInviteJob.name);
  private readonly box: SecretBox | null;

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.box = inviteLinkBox(env);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('people.import-invite', async (data) => {
      await this.run(data);
    });
  }

  async run({ tenantId, actorUserId, employeeIds }: JobPayloads['people.import-invite']): Promise<number> {
    if (!this.box) {
      this.logger.warn(`Import invitations for tenant ${tenantId} not created: no APP_SECRET to seal the links`);
      return 0;
    }
    const box = this.box;
    return this.database.withTenant(tenantId, async (tx) => {
      // memberships and invitations have no RLS: filter by tenant explicitly.
      const [actor] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, actorUserId)));
      if (actor?.role !== 'owner' && actor?.role !== 'admin') {
        this.logger.warn(`Import invitations for tenant ${tenantId} not created: the importer is no longer an owner or admin`);
        return 0;
      }
      const people = await employeesToInvite(tx, employeeIds);
      const emails = people.map((p) => p.workEmail?.toLowerCase()).filter((e): e is string => !!e);
      if (!emails.length) return 0;
      const members = new Set(
        (
          await tx
            .select({ email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), inArray(sql`lower(${users.email})`, emails)))
        ).map((m) => m.email?.toLowerCase()),
      );
      const invited = new Set(
        (
          await tx
            .select({ email: invitations.email })
            .from(invitations)
            .where(and(eq(invitations.tenantId, tenantId), inArray(invitations.email, emails), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, sql`now()`)))
        ).map((i) => i.email),
      );

      let created = 0;
      for (const person of people) {
        const email = person.workEmail?.toLowerCase();
        if (!email || person.userId || person.deactivatedAt || members.has(email) || invited.has(email)) continue;
        invited.add(email);
        const token = randomBytes(32).toString('base64url');
        const [row] = await tx
          .insert(invitations)
          .values({
            tenantId,
            email,
            role: 'member',
            tokenHash: createHash('sha256').update(token).digest('hex'),
            invitedByUserId: actorUserId,
            expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
            tokenSealed: box.seal(token),
            emailStatus: 'queued',
            employeeId: person.id,
          })
          .returning({ id: invitations.id });
        await this.jobs.send('identity.invitation-email', { tenantId, invitationId: row!.id }, tx);
        await this.audit.record(tx, { tenantId, userId: actorUserId, role: actor.role }, { action: 'invitation.created', entityType: 'invitation', entityId: row!.id, data: { email, role: 'member', employeeId: person.id, source: 'employee-import' } });
        created++;
      }
      this.logger.log(`Import invitations for tenant ${tenantId}: ${created} created`);
      return created;
    });
  }
}
