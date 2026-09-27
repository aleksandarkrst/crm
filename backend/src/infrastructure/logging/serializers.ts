import { scrubUrl } from '../monitoring/error-tracking';

/**
 * What a request log keeps of the URL (CD-102): no query string and no invitation tokens, the same
 * as error reports. The logs can be shipped off the server (Better Stack), and an invite link in
 * them would let anyone who reads the logs join the workspace.
 */
export function scrubRequest<R extends { url?: string; query?: unknown; params?: unknown }>(req: R): R {
  if (req.url) req.url = scrubUrl(req.url);
  // The parsed query and route params repeat what was cut from the URL (the token is a param).
  delete req.query;
  delete req.params;
  return req;
}
