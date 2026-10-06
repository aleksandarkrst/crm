import { ApiError } from './api';

/**
 * Heads and leads belong where they head (CD-225). Moving a department head or team lead
 * somewhere else ends that role, so the API refuses it with 409 `heads_department` and a message
 * ("Ana Petrović is head of Sales. Moving them to Service removes them as head of Sales.") until
 * the request is sent again with `clearHeadRoles: true`.
 */

/** The API's message when a change would move a head or lead elsewhere, else null. */
export function headMoveMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  return (err.body as { code?: string } | null)?.code === 'heads_department' ? err.message : null;
}

/**
 * Sends a change that may move a head or lead (the card, "Add people", drag and drop, a new head or
 * lead): when the API refuses, asks "<message> Continue?" and sends it again with
 * `clearHeadRoles`. Resolves to the answer, or null when the person said no. Other errors throw.
 */
export async function withHeadConfirm<T>(send: (clearHeadRoles: boolean) => Promise<T>): Promise<T | null> {
  try {
    return await send(false);
  } catch (err) {
    const message = headMoveMessage(err);
    if (!message) throw err;
    if (!window.confirm(`${message} Continue?`)) return null;
    return send(true);
  }
}
