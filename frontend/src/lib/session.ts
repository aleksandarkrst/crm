/**
 * "Your session ended" (CD-88). When the API answers 401 and the token can't be renewed, requests
 * don't fail: they wait here until the user signs in again (SessionEndedDialog), then go out
 * again. Edits in progress are neither lost nor reset, and the store's saves simply take longer.
 *
 * Waiting needs someone to sign in: it applies only while the dialog is mounted (the app is open).
 * Before that (start-up, sign-in screens) a 401 goes back to the caller as before.
 */
type Listener = (ended: boolean) => void;

let ended = false;
let dialogs = 0;
let waiters: (() => void)[] = [];
const listeners = new Set<Listener>();

/** True while a dialog can take the user through signing in again. */
export const canSignInAgain = () => dialogs > 0;

export function sessionEnded(): void {
  if (ended) return;
  ended = true;
  for (const l of listeners) l(true);
}

export function sessionRestored(): void {
  if (!ended) return;
  ended = false;
  const resume = waiters;
  waiters = [];
  for (const r of resume) r();
  for (const l of listeners) l(false);
}

/** Resolves at once unless the session ended and the user can sign in again; then after they do. */
export function whenSignedInAgain(): Promise<void> {
  if (!ended || !canSignInAgain()) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

/** For the dialog: follows the session and makes requests wait while it is mounted. */
export function watchSession(listener: Listener): () => void {
  dialogs++;
  listeners.add(listener);
  listener(ended);
  return () => {
    dialogs--;
    listeners.delete(listener);
    if (!canSignInAgain()) {
      // Nobody can sign in any more (signed out, workspace switched): let waiting requests fail.
      ended = false;
      const resume = waiters;
      waiters = [];
      for (const r of resume) r();
    }
  };
}
