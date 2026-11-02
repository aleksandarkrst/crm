/** Google's documented search URL: no API key, no geocoding (CD-377). */
const MAPS_SEARCH = 'https://www.google.com/maps/search/?api=1&query=';

/** An http(s) link such as a Teams or Zoom meeting. */
export const isWebUrl = (text: string): boolean => /^https?:\/\/\S+$/i.test(text.trim());

/**
 * Where a location opens (CD-377): a link as it is, any other text as a Google Maps search for it;
 * null when there is nothing. The frontend's lib/maps.ts has the same rule for the screens.
 */
export function mapsUrl(text: string | null | undefined): string | null {
  const v = text?.trim() ?? '';
  if (!v) return null;
  return isWebUrl(v) ? v : MAPS_SEARCH + encodeURIComponent(v);
}
