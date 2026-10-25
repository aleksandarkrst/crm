// Pure, so the unit tests load it without the API client.

/** What a document usually takes from queued to ready, waiting for the worker included. */
const TYPICAL_MS = 20_000;

/**
 * How far a document being generated is, in percent (CD-120). The worker reports no
 * progress, only queued → running → ready, so this is an estimate from the time since the document
 * was queued against a typical duration; it slows down and stays below 100 % until it is ready.
 */
export function estimatedProgress(doc: { status: string; createdAt: string }, now = Date.now()): number {
  if (doc.status !== 'queued' && doc.status !== 'running') return 100;
  const elapsed = Math.max(0, now - Date.parse(doc.createdAt));
  const pct = 95 * (1 - Math.exp(-(2 * elapsed) / TYPICAL_MS));
  // Queued means the worker hasn't picked it up yet: keep it in the first part of the bar.
  return Math.floor(doc.status === 'queued' ? Math.min(pct, 20) : Math.max(pct, 5));
}
