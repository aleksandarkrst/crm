import { BadRequestException, ConflictException } from '@nestjs/common';

interface PgError {
  code?: string;
  constraint?: string;
  message?: string;
}

/**
 * Data rules enforced by triggers (they raise check_violation naming one of these). Their message
 * is written for people, so the API passes it on.
 */
const RULES_WITH_MESSAGES = new Set(['deals_lost_not_won', 'deals_stage_not_deleted']);

function pgError(err: unknown): PgError | undefined {
  // drizzle wraps driver errors; the pg error is on `cause`.
  const e = err as { code?: string; cause?: PgError };
  if (typeof e?.code === 'string') return e;
  if (typeof e?.cause?.code === 'string') return e.cause;
  return undefined;
}

/** Translates common PostgreSQL constraint errors into HTTP errors; rethrows everything else. */
export function mapDbError(err: unknown): never {
  const pg = pgError(err);
  switch (pg?.code) {
    case '23505':
      throw new ConflictException(`Already exists (${pg.constraint ?? 'unique constraint'})`);
    case '23503':
      // A deal with meetings (CD-213): the service says so first; this covers a race with a new meeting.
      if (pg.constraint === 'meetings_deal_fk' && pg.message?.startsWith('update or delete')) {
        throw new ConflictException('This deal has meetings. Delete them or move them to another deal first.');
      }
      throw new ConflictException(`Referenced record missing or still in use (${pg.constraint ?? 'foreign key'})`);
    case '23514':
      if (pg.constraint && RULES_WITH_MESSAGES.has(pg.constraint)) throw new ConflictException(pg.message);
      if (pg.constraint === 'meetings_deal_required') throw new BadRequestException('Pick a deal');
      throw err;
    case '22P02':
      throw new BadRequestException('Invalid identifier');
    default:
      throw err;
  }
}
