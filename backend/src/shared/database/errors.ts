import { BadRequestException, ConflictException } from '@nestjs/common';

interface PgError {
  code?: string;
  constraint?: string;
}

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
      throw new ConflictException(`Referenced record missing or still in use (${pg.constraint ?? 'foreign key'})`);
    case '22P02':
      throw new BadRequestException('Invalid identifier');
    default:
      throw err;
  }
}
