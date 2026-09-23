import { BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TenantContext } from '../../shared/authorization';
import type { Tx } from '../../shared/database/database.service';
import { memberships } from '../../shared/database/schema';

/**
 * An owner must be a member of the tenant. `users` is global, so without this check any user id
 * would be accepted, and the owner's name would then show up in this workspace.
 */
export async function assertOwnerIsMember(tx: Tx, ctx: TenantContext, ownerUserId: string | null | undefined): Promise<void> {
  if (!ownerUserId) return;
  const [row] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ownerUserId)));
  if (!row) throw new BadRequestException('The owner must be a member of this workspace');
}
