/**
 * Accent-free, lower-case text for search (spec 4.2: "petrovic" finds "Petrović"). The database
 * keeps employees.search_text with the same mapping (people_fold, drizzle/0039_people_rls.sql) and
 * the API folds the query there too; this copy is for code that searches in memory (the frontend,
 * imports). Keep the two tables in sync.
 */
const FROM = 'ČĆŠĐŽčćšđžÁÀÄÂÃÅáàäâãåÉÈËÊĚéèëêěÍÌÏÎíìïîÓÒÖÔÕØŐóòöôõøőÚÙÜÛŮŰúùüûůűÝýÿÑŃŇñńňÇçĽĹŁľĺłŔŘŕřŚśŤťŹŻźżĎďĘęĄą';
const TO = 'CCSDZccsdzAAAAAAaaaaaaEEEEEeeeeeIIIIiiiiOOOOOOOoooooooUUUUUUuuuuuuYyyNNNnnnCcLLLlllRRrrSsTtZZzzDdEeAa';
const MAP = new Map([...FROM].map((c, i) => [c, TO[i]!]));

export function normalizeForSearch(value: string | null | undefined): string {
  let out = '';
  for (const c of value ?? '') out += MAP.get(c) ?? c;
  return out.toLowerCase();
}

/** A user's search text as a LIKE pattern on a folded column: wildcards in it match literally. */
export const searchPattern = (query: string): string => `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * A name as people type it, cleaned up: trimmed, inner runs of spaces collapsed ("  Ana   Marija "
 * → "Ana Marija"). Letters are kept as typed (Serbian Latin and Cyrillic are allowed).
 */
export const cleanName = (value: string): string => value.trim().replace(/\s+/g, ' ');
