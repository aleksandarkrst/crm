import { describe, expect, it } from 'vitest';
import { isWebUrl, mapsUrl } from '../src/shared/text/maps';

describe('map links (CD-377)', () => {
  it('keeps a link as it is', () => {
    expect(mapsUrl('https://teams.microsoft.com/l/meetup-join/19%3a')).toBe('https://teams.microsoft.com/l/meetup-join/19%3a');
    expect(mapsUrl('  http://zoom.us/j/123  ')).toBe('http://zoom.us/j/123');
    expect(mapsUrl('www.zoom.us/j/1')).toBe('https://www.zoom.us/j/1');
    expect(isWebUrl('www.zoom.us/j/1')).toBe(false);
    expect(isWebUrl('https://zoom.us/j/1\x07')).toBe(false);
    expect(mapsUrl('https://zoom.us/j/1\x07')).toMatch(/^https:\/\/www\.google\.com\/maps\/search\//);
  });

  it('searches Google Maps for an address, diacritics and commas encoded', () => {
    expect(mapsUrl('Bulevar Mihajla Pupina 10, Beograd')).toBe('https://www.google.com/maps/search/?api=1&query=Bulevar%20Mihajla%20Pupina%2010%2C%20Beograd');
    expect(mapsUrl('Čačak, Ložionička 3')).toBe('https://www.google.com/maps/search/?api=1&query=%C4%8Ca%C4%8Dak%2C%20Lo%C5%BEioni%C4%8Dka%203');
  });

  it('has nothing for an empty location', () => {
    expect(mapsUrl('')).toBeNull();
    expect(mapsUrl('   ')).toBeNull();
    expect(mapsUrl(null)).toBeNull();
  });
});
