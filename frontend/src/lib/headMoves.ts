import { askConfirm } from '../components/ConfirmDialog';
import { ApiError } from './api';

/**
 * Leads belong to the unit they lead (CD-225, CD-226). Moving a unit's lead somewhere else ends
 * that role, so the API refuses it with 409 `heads_unit` and a message ("Ana Petrović is lead of
 * Sales. Moving them to Service removes them as lead of Sales.") until the request is sent again
 * with `clearLeadRoles: true`.
 */

/** The API's message when a change would move a lead elsewhere, else null. */
export function headMoveMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  return (err.body as { code?: string } | null)?.code === 'heads_unit' ? err.message : null;
}

/**
 * Sends a change that may move a lead (the card, "Add people", drag and drop, a new lead): when the
 * API refuses, asks in the app's confirm dialog (CD-228: not the browser's) and sends it again with
 * `clearLeadRoles`. Resolves to the answer, or null when the person said no. Other errors throw.
 */
export async function withHeadConfirm<T>(send: (clearLeadRoles: boolean) => Promise<T>): Promise<T | null> {
  try {
    return await send(false);
  } catch (err) {
    const message = headMoveMessage(err);
    if (!message) throw err;
    if (!(await askConfirm({ title: 'Change the lead?', message, confirmLabel: 'Continue' }))) return null;
    return send(true);
  }
}
