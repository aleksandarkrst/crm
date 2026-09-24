import { BadRequestException } from '@nestjs/common';
import { and, type AnyColumn, eq, sql } from 'drizzle-orm';
import type { TenantContext } from '../../shared/authorization';
import type { Tx } from '../../shared/database/database.service';
import { memberships, users } from '../../shared/database/schema';

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

/**
 * The name of the user in `column` (an owner or assignee), for lists. It stays available after
 * they leave the workspace, so the UI can still say whose deal it was. The check above means only
 * people who were members when they were assigned can appear here.
 */
export const userNameOf = (column: AnyColumn) =>
  sql<string | null>`(select coalesce(u.display_name, u.email) from ${users} u where u.id = ${column})`;
