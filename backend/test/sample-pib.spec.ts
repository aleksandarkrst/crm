import { describe, expect, it } from 'vitest';
import { freePib } from '../src/modules/crm/onboarding/sample-data';
import { pibValid } from '../src/shared/validation/serbian-ids';

describe('freePib (CD-360)', () => {
  it('keeps a free PIB, and takes the next valid free one otherwise', () => {
    const taken = new Set<string | null>([null]);
    expect(freePib('990000019', taken)).toBe('990000019');
    // Now taken (it was added): the next valid one.
    const next = freePib('990000019', taken);
    expect(next).not.toBe('990000019');
    expect(pibValid(next)).toBe(true);
    expect(next.slice(0, 8)).toBe('99000002');
    expect(taken.has(next)).toBe(true);
  });
});
