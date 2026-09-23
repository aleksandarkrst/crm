import type { MembershipRole } from '../database/schema';

export interface AuthUser {
  id: string;
  authSubject: string;
  email: string | null;
  displayName: string | null;
}

/** Who is acting, in which tenant, with which role. Passed explicitly into services. */
export interface TenantContext {
  tenantId: string;
  userId: string;
  role: MembershipRole;
}

const ROLE_RANK: Record<MembershipRole, number> = { member: 1, admin: 2, owner: 3 };

export function hasRole(actual: MembershipRole, required: MembershipRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
