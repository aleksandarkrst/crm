/**
 * Compressed request bodies (CD-468, GHSA-27r3-jxmh-p828): body-parser 2.3.0 crashed the process on
 * a gzip body with trailing bytes, before routing or auth. The API refuses compressed bodies (415)
 * on every parser (Nest's JSON and urlencoded, and the import's 3 MB JSON) and stays up.
 * Skipped against an external API_URL: on an unfixed server this request would take it down.
 */
import { gzipSync } from 'node:zlib';
import { describe, expect, inject, it } from 'vitest';

const post = (path: string, contentType: string, body: Buffer) =>
  fetch(`${inject('apiUrl')}/api${path}`, { method: 'POST', headers: { 'content-type': contentType, 'content-encoding': 'gzip' }, body });

/** One valid gzip frame, then bytes after it: what made the finished decoder throw. */
const withTrailingBytes = (text: string) => Buffer.concat([gzipSync(text), Buffer.from('trailing bytes')]);

describe.skipIf(!!process.env.API_URL)('compressed request bodies (CD-468)', () => {
  it('refuses a gzip body with 415 on every parser, without authentication, and the API stays up', async () => {
    const cases: [string, string, Buffer][] = [
      ['/health', 'application/json', withTrailingBytes('{}')],
      ['/auth/login', 'application/json', withTrailingBytes('{"email":"a@b.c"}')],
      ['/crm/import/companies', 'application/json', withTrailingBytes('{}')],
      ['/health', 'application/x-www-form-urlencoded', withTrailingBytes('a=1')],
      ['/health', 'application/json', gzipSync('{}')],
    ];
    for (const [path, type, body] of cases) {
      const res = await post(path, type, body);
      expect(res.status, `${type} to ${path}`).toBe(415);
      await res.text();
    }
    // The crash came after the response, from the decoder: give it a moment, then ask again.
    await new Promise((r) => setTimeout(r, 500));
    const health = await fetch(`${inject('apiUrl')}/api/health`);
    expect(health.status).toBe(200);
  });

  it('still parses plain JSON', async () => {
    const res = await fetch(`${inject('apiUrl')}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(res.status).toBe(400);
  });
});
