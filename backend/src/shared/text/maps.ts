/** Google's documented search URL: no API key, no geocoding (CD-377). */
export const MAPS_SEARCH = 'https://www.google.com/maps/search/?api=1&query=';

/** An http(s) link such as a Teams or Zoom meeting: no spaces or control characters (the .ics takes it as is). */
export const isWebUrl = (text: string): boolean => {
  const v = text.trim();
  return /^https?:\/\/\S+$/i.test(v) && ![...v].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
};

/**
 * Where a location opens (CD-377): a link as it is ("www." gets https), any other text as a Google
 * Maps search for it; null when there is nothing. The frontend's lib/maps.ts has the same rule for the screens.
 */
export function mapsUrl(text: string | null | undefined): string | null {
  const v = text?.trim() ?? '';
  if (!v) return null;
  const link = /^www\.\S+$/i.test(v) ? 'https://' + v : v;
  return isWebUrl(link) ? link : MAPS_SEARCH + encodeURIComponent(v);
}
