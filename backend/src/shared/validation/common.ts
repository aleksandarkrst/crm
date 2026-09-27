import { z } from 'zod';

export const UuidParam = z.uuid();

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).max(200).optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

/**
 * `?ids=a,b,c`: only these rows (at most 200). A live update re-reads just the rows its change
 * hint names instead of the whole list (CD-98). Rows that are gone are simply not returned.
 */
export const IdList = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(z.uuid()).min(1).max(200));
/** A list endpoint that can also return just some rows by id. */
export const ListQuery = PaginationQuery.extend({ ids: IdList.optional() });
export type ListQuery = z.infer<typeof ListQuery>;
/** Deal lines and to-dos: just the rows of some deals (`?dealIds=`). */
export const DealRowsQuery = PaginationQuery.extend({ dealIds: IdList.optional() });
export type DealRowsQuery = z.infer<typeof DealRowsQuery>;

/** Empty strings from HTML forms become null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

export const EMPTY_PATCH_MESSAGE = 'Nothing to update: send at least one field to change';

/**
 * Wraps the body schema of every PATCH endpoint: at least one field must be present after
 * parsing (unknown keys are stripped, so `{}` and `{ typo: 1 }` both fail). An empty update is a
 * client bug, so it gets a 400 with a clear message instead of reaching the database, where an
 * empty `UPDATE … SET` fails with a 500.
 */
export const nonEmptyPatch = <T extends z.ZodType<object>>(schema: T) =>
  schema.refine((value) => Object.values(value).some((v) => v !== undefined), { message: EMPTY_PATCH_MESSAGE });
