/**
 * User-facing wording for copy the API still phrases as a deal (CD-356).
 * Labels and headings only. Merge tokens such as {{deal.title}} are rendered from the tag, not passed here.
 */

type ImportRecord = 'companies' | 'contacts' | 'deals' | 'products';

export function opportunityCopy(text: string): string {
  return text.replace(/\bDeals\b/g, 'Opportunities').replace(/\bdeals\b/g, 'opportunities').replace(/\bDeal\b/g, 'Opportunity').replace(/\bdeal\b/g, 'opportunity');
}

/** Settings → Document templates. The lines group keeps the loop hint; other groups are the API name, reworded. */
export function mergeFieldGroupHeading(group: string): string {
  if (group === 'Deal lines') return 'Opportunity lines · inside {{#lines}}';
  return opportunityCopy(group);
}

const IMPORT_NOUN: Record<ImportRecord, string> = {
  companies: 'companies',
  contacts: 'contacts',
  deals: 'opportunities',
  products: 'products',
};

/** Footer of the import dialog. Same shape for every record type. */
export function importTemplateLink(type: ImportRecord): string {
  return `Download the ${IMPORT_NOUN[type]} template`;
}

/**
 * A deals-import validation line still arrives as "Deal: …" (the API field name).
 * Only that prefix changes, so a value that happens to contain the word stays as typed.
 */
export function importIssueText(text: string): string {
  return text.replace(/^Deal:/, 'Opportunity:');
}
