import { describe, expect, it } from 'vitest';
import { scrubRequest } from '../src/infrastructure/logging/serializers';

describe('request logs (CD-102)', () => {
  it('drop invitation tokens and query strings from the URL', () => {
    expect(scrubRequest({ method: 'POST', url: '/api/invitations/abc_DEF-123456789012345/accept' }).url).toBe('/api/invitations/[token]/accept');
    expect(scrubRequest({ method: 'GET', url: '/api/crm/deals?limit=200&offset=0&q=acme' }).url).toBe('/api/crm/deals');
    expect(scrubRequest({ method: 'GET', url: '/api/crm/deals/5' }).url).toBe('/api/crm/deals/5');
  });

  it('drop the parsed query and route params, which repeat them', () => {
    const req = scrubRequest({ url: '/api/invitations/tok123/preview?x=1', query: { x: '1' }, params: { splat: ['invitations', 'tok123'] } });
    expect(req).toEqual({ url: '/api/invitations/[token]/preview' });
  });
});
