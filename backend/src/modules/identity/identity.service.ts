import { ConflictException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { memberships, type MembershipRole, tenants, users } from '../../shared/database/schema';
import { TenantProvisioning } from '../../shared/events/tenant-provisioning';
import { linkNewMember, syncWorkEmail } from '../people';
import { signInMethod } from './signup-email';
import type { VerifiedIdentity } from './token.service';

const USER_CACHE_TTL_MS = 60_000;

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly userCache = new Map<string, { user: AuthUser; expires: number }>();

  constructor(
    private readonly database: DatabaseService,
    private readonly provisioning: TenantProvisioning,
  ) {}

  /** Finds or creates the local user row for a verified token (just-in-time provisioning). */
  async resolveUser(identity: VerifiedIdentity): Promise<AuthUser> {
    const cached = this.userCache.get(identity.subject);
    if (cached && cached.expires > Date.now()) return cached.user;
    await this.refuseSecondAccount(identity);

    return this.upsert(identity);
  }

  /**
   * Saves who signed in, from the provider's ID token, when signing in or renewing the session
   * (CD-222): a Google user's address only arrives there. Fills or updates users.email, but never
   * with an address another account already has (one account per email, CD-114): that sign-in is
   * refused on its first API call instead. Never throws, so signing in can't fail on it.
   */
  async rememberProfile(identity: VerifiedIdentity): Promise<void> {
    try {
      await this.refuseSecondAccount(identity);
      await this.upsert(identity);
    } catch (err) {
      if (!(err instanceof ConflictException)) this.logger.warn(`Couldn't save the profile of ${identity.subject}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * When the sign-in email changes, the member's employee records follow in the same transaction
   * (CD-226: work email = sign-in email, people's `syncWorkEmail`).
   */
  private async upsert(identity: VerifiedIdentity): Promise<AuthUser> {
    const row = await this.database.db.transaction(async (tx) => {
      const [before] = await tx.select({ email: users.email }).from(users).where(eq(users.authSubject, identity.subject));
      const [saved] = await tx
        .insert(users)
        .values({ authSubject: identity.subject, email: identity.email, displayName: identity.name })
        .onConflictDoUpdate({
          target: users.authSubject,
          set: {
            // A new address replaces the old one, unless another account has it (CD-222).
            email: sql`case when excluded.email is not null and not exists (
              select 1 from ${users} u where lower(u.email) = lower(excluded.email) and u.auth_subject <> excluded.auth_subject
            ) then excluded.email else ${users.email} end`,
            // A name the user set in their profile wins over the one in the token.
            displayName: sql`case when ${users.displayNameCustom} then ${users.displayName} else coalesce(excluded.display_name, ${users.displayName}) end`,
          },
        })
        .returning();
      if (before && saved?.email && saved.email.toLowerCase() !== before.email?.toLowerCase()) await syncWorkEmail(tx, saved.id, before.email, saved.email);
      return saved;
    });

    const user: AuthUser = { id: row!.id, authSubject: row!.authSubject, email: row!.email, displayName: row!.displayName };
    this.userCache.set(identity.subject, { user, expires: Date.now() + USER_CACHE_TTL_MS });
    return user;
  }

  /**
   * A new sign-in whose email already belongs to an account that signs in another way (created
   * with a password, now "Continue with Google", or the reverse): the provider sees two users.
   * Refused instead of quietly starting a second, empty account (CD-114). Linking them stays a
   * deliberate step for later; until then the person signs in the way they did before.
   */
  private async refuseSecondAccount(identity: VerifiedIdentity): Promise<void> {
    if (!identity.email) return;
    const [other] = await this.database.db
      .select({ authSubject: users.authSubject })
      .from(users)
      .where(
        and(
          eq(sql`lower(${users.email})`, identity.email.toLowerCase()),
          ne(users.authSubject, identity.subject),
          sql`not exists (select 1 from ${users} u where u.auth_subject = ${identity.subject})`,
        ),
      )
      .limit(1);
    if (!other) return;
    const method = signInMethod(other.authSubject);
    const how = method === 'google' ? 'with Google' : method === 'password' ? 'with your email and password' : 'the way you did before';
    throw new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      code: 'account_exists',
      method,
      message: `${identity.email} already has a Pultly account that signs in another way. Sign out, then sign in ${how}.`,
    });
  }

  /** Drops a cached user after their profile changed (the next request re-reads it). */
  forgetUser(authSubject: string) {
    this.userCache.delete(authSubject);
  }

  async getRole(userId: string, tenantId: string): Promise<MembershipRole | null> {
    const [row] = await this.database.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)));
    return row?.role ?? null;
  }

  /** The user's workspaces with their member counts (the sidebar switcher shows them, CD-214). */
  async listTenants(userId: string) {
    return this.database.db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        role: memberships.role,
        memberCount: sql<number>`(select count(*)::int from memberships m where m.tenant_id = ${tenants.id})`,
        modules: tenants.modules,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(tenants.name));
  }

  /**
   * Creates a tenant (a customer organisation) with the caller as its owner, then lets other
   * modules seed their defaults (e.g. CRM funnels) in the same transaction. The creator gets their
   * employee record (people, spec 4.6).
   */
  async createTenant(userId: string, name: string, currency?: string, timezone?: string) {
    return this.database.db.transaction(async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ name, slug: slugify(name), ...(currency ? { currency } : {}), ...(timezone ? { timezone } : {}) }).returning();
      await tx.insert(memberships).values({ tenantId: tenant!.id, userId, role: 'owner' });
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant!.id}, true)`);
      await this.provisioning.run(tx, tenant!.id);
      await linkNewMember(tx, { tenantId: tenant!.id, userId });
      return { id: tenant!.id, name: tenant!.name, slug: tenant!.slug, role: 'owner' as const, memberCount: 1, modules: tenant!.modules };
    });
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'org'}-${randomBytes(3).toString('hex')}`;
}
