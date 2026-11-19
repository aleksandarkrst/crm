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
 */
export function lastLoadStore<R extends object>() {
  let raw: R | null = null;
  let seq = 0;
  const savedAt = new Map<keyof R, number>();
  return {
    /** The last load's lists with this tab's saves on top; null before the first load. */
    current: (): R | null => raw,
    /** A save of one list: keep it for later partial loads (no-op before the first load). */
    remember<K extends keyof R>(key: K, value: R[K]) {
      if (raw) raw = { ...raw, [key]: value };
      savedAt.set(key, ++seq);
    },
    /**
     * One load. `fetch` gets the last load's lists (null for a full load, or before the first one)
     * and reads what it needs; `build` makes the new lists from what was fetched and `prev`, the
     * last load's lists as they are once the fetch is done. Stores and returns the result.
     */
    async load<F>(partial: boolean, fetch: (before: R | null) => Promise<F>, build: (fetched: F, prev: R | null) => R): Promise<R> {
      const since = seq;
      const before = partial ? raw : null;
      const fetched = await fetch(before);
      const next = { ...build(fetched, before ? (raw ?? before) : null) };
      if (raw) for (const [key, at] of savedAt) if (at > since) next[key] = raw[key];
      raw = next;
      return next;
    },
  };
}
