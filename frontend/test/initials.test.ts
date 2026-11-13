// Unit tests of avatar initials (CD-363, TC9): `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initialsOf } from '../src/store/initials.ts';

describe('initialsOf', () => {
  it('takes the first letters of the first two words of a name', () => {
    assert.equal(initialsOf('Aleksandar Krstić'), 'AK');
    assert.equal(initialsOf('Ana Maria Petrović'), 'AM');
    assert.equal(initialsOf('Cher'), 'C');
  });
  it('uses the name, not the email, of a "name · email" label', () => {
    assert.equal(initialsOf('Ana Petrović · ana@x.com'), 'AP');
  });
  it('gives two letters for an email-only member', () => {
    assert.equal(initialsOf('alex@simplicity-labs.com'), 'AL');
    assert.equal(initialsOf('ana.petrovic@x.com'), 'AP');
    assert.equal(initialsOf('j_doe@x.com'), 'JD');
    assert.equal(initialsOf('a@x.com'), 'A');
  });
  it('is empty without a name', () => {
    assert.equal(initialsOf(undefined), '');
    assert.equal(initialsOf(''), '');
  });
});
