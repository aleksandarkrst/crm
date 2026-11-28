/**
 * The lists of the last workspace load, so a live update (CD-20) re-reads only the ones that changed
 * and takes the others from here. This tab's own saves are kept on top (`remember`, CD-519): the
 * API echoes nothing back to the tab that saved, so without them a refresh would put back a list
 * as it was at the last load (a new CEO switched back to the old one).
 *
 * A load takes time, and a save that lands while one is fetching wins over it (`load`): the lists
 * the load did not re-read come from here as they are after the fetch, not before it, and a list
 * saved during the fetch is kept over the one the load read, which may predate the save. The
 * caller may still throw the load's result away (an edit started meanwhile); what is stored here
 * then already has the save, so the retry builds on it.
 *
 * `update` is the same for a few rows of a list (CD-534): a saved company's row as the API returned
 * it, with its new status, so a refresh that re-reads only other lists (a colleague's contact) does
 * not put back the company as it was at the last load. A load fetching meanwhile gets the change
 * again on top of what it read; one that started after it takes what it read.
 */
export function lastLoadStore<R extends object>() {
  let raw: R | null = null;
  let seq = 0;
  const savedAt = new Map<keyof R, number>();
  /** Row changes made while a load was fetching, to apply again on top of what that load read. */
  const edits: { at: number; key: keyof R; change: (value: never) => unknown }[] = [];
  /** Where each load still fetching started (`seq` then). */
  const running: number[] = [];
  return {
    /** The last load's lists with this tab's saves on top; null before the first load. */
    current: (): R | null => raw,
    /** A save of one list: keep it for later partial loads (no-op before the first load). */
    remember<K extends keyof R>(key: K, value: R[K]) {
      if (raw) raw = { ...raw, [key]: value };
      savedAt.set(key, ++seq);
    },
    /** A save of some rows of one list: `change` makes the list with them (no-op before the first load). */
    update<K extends keyof R>(key: K, change: (value: R[K]) => R[K]) {
      if (raw) raw = { ...raw, [key]: change(raw[key]) };
      const at = ++seq;
      if (running.length) edits.push({ at, key, change: change as (value: never) => unknown });
    },
    /**
     * One load. `fetch` gets the last load's lists (null for a full load, or before the first one)
     * and reads what it needs; `build` makes the new lists from what was fetched and `prev`, the
     * last load's lists as they are once the fetch is done. Stores and returns the result.
     */
    async load<F>(partial: boolean, fetch: (before: R | null) => Promise<F>, build: (fetched: F, prev: R | null) => R): Promise<R> {
      const since = seq;
      running.push(since);
      try {
        const before = partial ? raw : null;
        const fetched = await fetch(before);
        const next = { ...build(fetched, before ? (raw ?? before) : null) };
        const kept = new Set<keyof R>();
        if (raw)
          for (const [key, at] of savedAt)
            if (at > since) {
              next[key] = raw[key];
              kept.add(key);
            }
        // A list kept whole above already has these; any other gets them again over what was read.
        for (const e of edits) if (e.at > since && !kept.has(e.key)) next[e.key] = e.change(next[e.key] as never) as R[keyof R];
        raw = next;
        return next;
      } finally {
        running.splice(running.indexOf(since), 1);
        const oldest = running.length ? Math.min(...running) : Infinity;
        for (let i = edits.length - 1; i >= 0; i--) if (edits[i]!.at <= oldest) edits.splice(i, 1);
      }
    },
  };
}
