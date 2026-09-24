/** What each import type can read from a CSV, how headers are guessed, and the template files. */

export const IMPORT_TYPES = ['companies', 'contacts', 'deals'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  /** Other header names that map to this field (compared without case, spaces or punctuation). */
  aliases: string[];
  /** Shown in the dialog next to the field. */
  hint?: string;
  /** Value in the template's example row. */
  example: string;
}

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
};

/** A field → column index map (null or absent means "not imported"). */
export type ColumnMapping = Record<string, number | null>;

const norm = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Guesses the mapping from the header names: a header matches a field when it equals the field's
 * key, label or one of its aliases, ignoring case, spaces and punctuation. Each column is used once;
 * exact labels win over aliases, so "Company" and "Company name" in one file both find a home.
 */
export function guessMapping(type: ImportType, headers: string[]): ColumnMapping {
  const fields = IMPORT_FIELDS[type];
  const normalized = headers.map(norm);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  const pass = (names: (f: ImportField) => string[]) => {
    for (const f of fields) {
      if (mapping[f.key] !== undefined) continue;
      const wanted = new Set(names(f).map(norm));
      const idx = normalized.findIndex((h, i) => !used.has(i) && wanted.has(h));
      if (idx >= 0) {
        mapping[f.key] = idx;
        used.add(idx);
      }
    }
  };
  pass((f) => [f.key, f.label]);
  pass((f) => f.aliases);
  for (const f of fields) mapping[f.key] ??= null;
  return mapping;
}

/** Quotes a template cell when needed (the templates are plain, but keep them valid CSV). */
const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Header row with the field labels plus one example row, UTF-8 with a BOM so Excel reads it right. */
export function templateCsv(type: ImportType): string {
  const fields = IMPORT_FIELDS[type];
  return '﻿' + [fields.map((f) => cell(f.label)).join(','), fields.map((f) => cell(f.example)).join(',')].join('\r\n') + '\r\n';
}
