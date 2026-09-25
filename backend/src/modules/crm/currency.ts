import { z } from 'zod';

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

/** An ISO 4217 currency code (deals and products, CD-77). */
export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => /^[A-Z]{3}$/.test(c) && CURRENCIES.has(c), 'Must be an ISO 4217 currency code, e.g. EUR');
