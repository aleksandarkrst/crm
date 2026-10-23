// Contact phone and email checks (CD-464): `npm test` in frontend. Same phone numbers as the backend's phone.spec.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkEmail, checkPhone } from '../src/lib/validate.ts';

describe('checkPhone (CD-464)', () => {
  it('accepts numbers as people write them, and empty', () => {
    for (const phone of ['+381 60 123 4567', '060/123-4567', '(011) 222-333', '+44 20 7946 0958', '021 456 789 ext. 12', '0601234567 x9', '+1.415.555.0100', '']) {
      assert.equal(checkPhone(phone).ok, true, phone);
    }
    assert.deepEqual(checkPhone('  +381 60 123 4567 '), { ok: true, value: '+381 60 123 4567' });
  });

  it('refuses letters, symbols and too few digits', () => {
    for (const phone of ['abc123!!', 'call me', '123', '+381 60 abc', '060#123#4567', 'ext. 12', '++381 60 123 4567']) {
      assert.equal(checkPhone(phone).ok, false, phone);
    }
  });
});

describe('checkEmail (CD-464)', () => {
  it('accepts an address and empty, refuses the rest', () => {
    assert.deepEqual(checkEmail(' ana@acme.com '), { ok: true, value: 'ana@acme.com' });
    assert.equal(checkEmail('').ok, true);
    for (const email of ['ana', 'ana@acme', 'ana @acme.com', '@acme.com']) assert.equal(checkEmail(email).ok, false, email);
  });
});
