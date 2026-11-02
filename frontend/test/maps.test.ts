// Map links (CD-377): `npm test` in frontend. Same cases as the backend's maps.spec.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapsSearchUrl, mapsUrl } from '../src/lib/maps.ts';

describe('map links (CD-377)', () => {
  it('keeps a link as it is', () => {
    assert.equal(mapsUrl('https://teams.microsoft.com/l/meetup-join/19%3a'), 'https://teams.microsoft.com/l/meetup-join/19%3a');
    assert.equal(mapsUrl('  http://zoom.us/j/123  '), 'http://zoom.us/j/123');
    assert.equal(mapsUrl('www.zoom.us/j/1'), 'https://www.zoom.us/j/1');
  });

  it('searches Google Maps for an address, diacritics and commas encoded', () => {
    assert.equal(mapsUrl('Bulevar Mihajla Pupina 10, Beograd'), 'https://www.google.com/maps/search/?api=1&query=Bulevar%20Mihajla%20Pupina%2010%2C%20Beograd');
    assert.equal(mapsUrl('Čačak, Ložionička 3'), 'https://www.google.com/maps/search/?api=1&query=%C4%8Ca%C4%8Dak%2C%20Lo%C5%BEioni%C4%8Dka%203');
  });

  it('has nothing for an empty location', () => {
    assert.equal(mapsUrl(''), null);
    assert.equal(mapsUrl('   '), null);
    assert.equal(mapsUrl(null), null);
    assert.equal(mapsSearchUrl('', null, '—'), '');
  });
});
