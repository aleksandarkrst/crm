import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { hasRole } from '../src/shared/authorization/tenant-context';
import { mapDbError } from '../src/shared/database/errors';

describe('hasRole', () => {
  it('ranks owner > admin > member', () => {
    expect(hasRole('owner', 'admin')).toBe(true);
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('member', 'admin')).toBe(false);
    expect(hasRole('member', 'member')).toBe(true);
  });
});

describe('mapDbError', () => {
  it('maps unique violations (also when wrapped by drizzle) to 409', () => {
    expect(() => mapDbError({ code: '23505', constraint: 'x' })).toThrow(ConflictException);
    expect(() => mapDbError({ message: 'Failed query', cause: { code: '23505' } })).toThrow(ConflictException);
  });

  it('maps foreign key violations to 409 and bad uuids to 400', () => {
    expect(() => mapDbError({ code: '23503' })).toThrow(ConflictException);
    expect(() => mapDbError({ code: '22P02' })).toThrow(BadRequestException);
  });

  it('rethrows anything else unchanged', () => {
    const err = new Error('boom');
    expect(() => mapDbError(err)).toThrow(err);
  });
});
