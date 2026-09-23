import { z } from 'zod';

export const UuidParam = z.uuid();

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).max(200).optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

/** Empty strings from HTML forms become null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
