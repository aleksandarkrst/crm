import { eq } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { tenants } from '../../shared/database/schema';
import { zonedParts } from '../../shared/time/zoned-time';

/** Today's date on the workspace's clock (spec 15.4: "today" is the workspace time zone's date). */
export async function workspaceToday(tx: Tx, tenantId: string, now = new Date()): Promise<string> {
  const [t] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  return zonedParts(now, t?.timezone ?? 'UTC').date;
}
