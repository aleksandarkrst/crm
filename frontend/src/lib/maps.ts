/**
 * A Google Maps search for a place (CD-357): no API key, the search URL Google documents. The parts
 * are joined with commas ("Vega Logistika, Bulevar 10, Novi Sad"); '' when there is nothing to search.
 */
export function mapsSearchUrl(...parts: (string | null | undefined)[]): string {
  const query = parts.map((p) => (p ?? '').trim()).filter((p) => p && p !== '—').join(', ');
  return query ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query) : '';
}
