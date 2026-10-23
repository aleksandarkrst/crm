import { describe, expect, it } from 'vitest';
import { phoneValid } from '../src/shared/validation/phone';

describe('phoneValid (CD-464)', () => {
  it('accepts numbers as people write them', () => {
    for (const phone of ['+381 60 123 4567', '060/123-4567', '(011) 222-333', '+44 20 7946 0958', '021 456 789 ext. 12', '0601234567 x9', '+1.415.555.0100']) {
      expect(phoneValid(phone), phone).toBe(true);
    }
  });

  it('refuses letters, symbols and too few digits', () => {
    for (const phone of ['abc123!!', 'call me', '123', '+381 60 abc', '060#123#4567', 'ext. 12', '++381 60 123 4567']) {
      expect(phoneValid(phone), phone).toBe(false);
    }
  });
});
