import { BadRequestException } from '@nestjs/common';

/**
 * The version a client edited, from `If-Match` (the record's `updatedAt`, quoted or not, as an
 * ETag). No header, or `*`, means "no version": the update is last-write-wins, as before CD-20.
 */
export function parseVersion(header: string | undefined): Date | undefined {
  const raw = header?.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  if (!raw || raw === '*') return undefined;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw new BadRequestException("If-Match must be the record's updatedAt, e.g. \"2026-09-24T10:15:00.123Z\"");
  return at;
}
