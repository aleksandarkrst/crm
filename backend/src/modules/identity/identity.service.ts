import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { memberships, type MembershipRole, tenants, users } from '../../shared/database/schema';
import { TenantProvisioning } from '../../shared/events/tenant-provisioning';
import type { VerifiedIdentity } from './token.service';

const USER_CACHE_TTL_MS = 60_000;

@Injectable()
export class IdentityService {
  private readonly userCache = new Map<string, { user: AuthUser; expires: number }>();

  constructor(
    private readonly database: DatabaseService,
    private readonly provisioning: TenantProvisioning,
  ) {}

  /** Finds or creates the local user row for a verified token (just-in-time provisioning). */
  async resolveUser(identity: VerifiedIdentity): Promise<AuthUser> {
    const cached = this.userCache.get(identity.subject);
    if (cached && cached.expires > Date.now()) return cached.user;

    const [row] = await this.database.db
      .insert(users)
      .values({ authSubject: identity.subject, email: identity.email, displayName: identity.name })
      .onConflictDoUpdate({
        target: users.authSubject,
        set: {
          email: sql`coalesce(excluded.email, ${users.email})`,
          // A name the user set in their profile wins over the one in the token.
          displayName: sql`case when ${users.displayNameCustom} then ${users.displayName} else coalesce(excluded.display_name, ${users.displayName}) end`,
        },
      })
      .returning();

    const user: AuthUser = { id: row!.id, authSubject: row!.authSubject, email: row!.email, displayName: row!.displayName };
    this.userCache.set(identity.subject, { user, expires: Date.now() + USER_CACHE_TTL_MS });
    return user;
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

  async listTenants(userId: string) {
    return this.database.db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(tenants.name));
  }

  /**
   * Creates a tenant (a customer organisation) with the caller as its owner, then lets other
   * modules seed their defaults (e.g. CRM funnels) in the same transaction.
   */
  async createTenant(userId: string, name: string, currency?: string) {
    return this.database.db.transaction(async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ name, slug: slugify(name), ...(currency ? { currency } : {}) }).returning();
      await tx.insert(memberships).values({ tenantId: tenant!.id, userId, role: 'owner' });
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant!.id}, true)`);
      await this.provisioning.run(tx, tenant!.id);
      return { id: tenant!.id, name: tenant!.name, slug: tenant!.slug, role: 'owner' as const };
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
