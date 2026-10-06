/**
 * Code split screens after a deploy (CD-220). A tab opened before a deploy still asks for the old
 * chunk names (`Company-C2pzbaaw.js`), which the new build no longer has, so the import fails with
 * "Failed to fetch dynamically imported module". Reloading fetches the new index and its chunks.
 * We reload at most once a minute per tab, so a chunk that is really missing (or the network being
 * down) shows the error screen instead of reloading forever.
 */
const RELOADED_AT = 'pultly.chunkReloadAt';

/** True for the errors browsers raise when a dynamic import's file can't be fetched. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/i.test(message);
}

function reloadedRecently(): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOADED_AT));
    return Number.isFinite(at) && Date.now() - at < 60_000;
  } catch {
    return true; // no storage: don't risk a reload loop
  }
}

/**
 * Wraps a dynamic import: when its file is gone because a new version was deployed, reloads the
 * page once (the promise then never settles, so nothing renders an error meanwhile). Other errors,
 * and a second failure within a minute, are thrown to the error boundary.
 */
export function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  return load().catch((error: unknown) => {
    if (isChunkLoadError(error) && !reloadedRecently()) {
      try {
        sessionStorage.setItem(RELOADED_AT, String(Date.now()));
      } catch {
        // Reloading once without the marker is still better than a blank page.
      }
      window.location.reload();
      return new Promise<T>(() => {});
    }
    throw error;
  });
}
