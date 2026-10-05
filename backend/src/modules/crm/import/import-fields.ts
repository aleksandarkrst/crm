import { type ColumnMapping, guessMappingOf, type ImportField, templateCsvOf } from '../../../shared/import/import-file';

/** What each import type can read from a CSV, how headers are guessed, and the template files. */

export const IMPORT_TYPES = ['companies', 'contacts', 'deals', 'products'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export type { ColumnMapping, ImportField };

const owner: ImportField = {
  key: 'ownerEmail',
  label: 'Owner email',
  required: false,
  aliases: ['owner', 'owner email', 'account owner', 'deal owner', 'salesperson', 'assigned to'],
  hint: 'Email of a workspace member; empty means you',
  example: '',
};

export const IMPORT_FIELDS: Record<ImportType, ImportField[]> = {
  companies: [
    { key: 'name', label: 'Name', required: true, aliases: ['company', 'company name', 'organisation', 'organization', 'account', 'account name'], example: 'Northwind Studio' },
    { key: 'industry', label: 'Industry', required: false, aliases: ['sector', 'vertical'], example: 'Architecture' },
    { key: 'hq', label: 'HQ', required: false, aliases: ['headquarters', 'city', 'location', 'country', 'address'], example: 'Belgrade' },
    { key: 'teamSize', label: 'Team size', required: false, aliases: ['size', 'company size', 'employees', 'headcount', 'staff'], example: '11–50 staff' },
    { key: 'source', label: 'Source', required: false, aliases: ['lead source', 'channel'], example: 'Referral' },
    { key: 'domain', label: 'Domain', required: false, aliases: ['website', 'web', 'url', 'site'], example: 'northwind.example' },
    owner,
    { key: 'notes', label: 'Notes', required: false, aliases: ['note', 'description', 'comments'], example: '' },
  ],
  contacts: [
    { key: 'fullName', label: 'Full name', required: true, aliases: ['name', 'contact', 'contact name', 'person'], example: 'Ana Petrović' },
    { key: 'email', label: 'Email', required: false, aliases: ['e-mail', 'email address', 'mail', 'work email'], hint: 'Contacts are matched by email', example: 'ana@northwind.example' },
    { key: 'jobTitle', label: 'Job title', required: false, aliases: ['title', 'position', 'role'], example: 'Managing Director' },
    { key: 'phone', label: 'Phone', required: false, aliases: ['telephone', 'mobile', 'phone number', 'tel'], example: '+381 60 000 0000' },
    { key: 'linkedin', label: 'LinkedIn', required: false, aliases: ['linkedin url', 'linkedin profile'], example: '' },
    { key: 'buyerRole', label: 'Buyer role', required: false, aliases: [], hint: 'Decision maker, Economic buyer, Champion, Influencer, Gatekeeper or End user', example: 'Decision maker' },
    { key: 'company', label: 'Company', required: false, aliases: ['company name', 'organisation', 'organization', 'account', 'account name'], hint: 'Matched by name, created if new', example: 'Northwind Studio' },
    owner,
  ],
  deals: [
    { key: 'title', label: 'Deal', required: true, aliases: ['deal name', 'deal title', 'title', 'name', 'opportunity', 'opportunity name'], example: 'Website redesign' },
    { key: 'company', label: 'Company', required: true, aliases: ['company name', 'organisation', 'organization', 'account', 'account name', 'customer'], hint: 'Matched by name, created if new', example: 'Northwind Studio' },
    { key: 'funnel', label: 'Funnel', required: false, aliases: ['pipeline', 'audience'], hint: 'Matched by name; empty means the funnel picked above', example: '' },
    { key: 'stage', label: 'Stage', required: false, aliases: ['deal stage', 'pipeline stage', 'status'], hint: "Matched by name; empty means the funnel's first stage", example: '' },
    { key: 'amount', label: 'Value', required: false, aliases: ['amount', 'deal value', 'value', 'price', 'total'], example: '14000' },
    { key: 'closeDate', label: 'Closing date', required: false, aliases: ['close date', 'expected close date', 'closing', 'expected close'], hint: 'YYYY-MM-DD or DD.MM.YYYY', example: '2026-12-31' },
    { key: 'source', label: 'Source', required: false, aliases: ['lead source', 'channel'], example: 'Referral' },
    owner,
    { key: 'contactName', label: 'Contact', required: false, aliases: ['contact name', 'primary contact', 'person'], hint: 'Created if no contact has the email', example: 'Ana Petrović' },
    { key: 'contactEmail', label: 'Contact email', required: false, aliases: ['email', 'contact e-mail', 'e-mail'], hint: 'Matched to an existing contact', example: 'ana@northwind.example' },
  ],
  // CD-81: products have no currency; a deal reads their prices in its own.
  products: [
    { key: 'name', label: 'Name', required: true, aliases: ['product', 'product name', 'service', 'item', 'title'], hint: 'Products are matched by name', example: 'Brand identity sprint' },
    { key: 'description', label: 'Description', required: false, aliases: ['details', 'notes'], example: 'Two-week sprint' },
    { key: 'unitPrice', label: 'Unit price', required: false, aliases: ['price', 'unit cost', 'rate', 'amount'], example: '6500' },
    { key: 'unit', label: 'Unit', required: false, aliases: ['uom', 'unit of measure'], example: 'project' },
    { key: 'quantity', label: 'Quantity', required: false, aliases: ['qty', 'default quantity'], example: '1' },
    { key: 'vatRate', label: 'Tax %', required: false, aliases: ['tax', 'vat', 'vat %', 'vat rate', 'tax rate'], example: '20' },
    { key: 'billingFrequency', label: 'Billing frequency', required: false, aliases: ['billing', 'frequency', 'billing period'], hint: 'One time, Weekly, Monthly, Quarterly or Annually', example: 'One time' },
    { key: 'billingCycles', label: 'Billing cycles', required: false, aliases: ['cycles', 'number of cycles'], hint: 'Recurring only; empty means until canceled', example: '' },
  ],
};

/** The mapping guessed from the header names (shared/import: label, key or alias; case, accents and punctuation ignored). */
export const guessMapping = (type: ImportType, headers: string[]): ColumnMapping => guessMappingOf(IMPORT_FIELDS[type], headers);

/** Header row with the field labels plus one example row, UTF-8 with a BOM so Excel reads it right. */
export const templateCsv = (type: ImportType): string => templateCsvOf(IMPORT_FIELDS[type]);
