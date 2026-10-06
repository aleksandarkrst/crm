import { describe, expect, it } from 'vitest';
import { emailNames } from '../src/modules/people/linking';

describe('names of an invited person from their email (CD-226)', () => {
  it('splits the local part at dots, dashes, underscores and plus signs; the last word is the last name', () => {
    expect(emailNames('ana.petrovic@example.test')).toEqual({ firstName: 'Ana', lastName: 'Petrovic' });
    expect(emailNames('ana.marija_petrovic@example.test')).toEqual({ firstName: 'Ana Marija', lastName: 'Petrovic' });
    expect(emailNames('marko-ilic+crm@example.test')).toEqual({ firstName: 'Marko Ilic', lastName: 'Crm' });
  });

  it('one word is both names; nothing usable gives a placeholder', () => {
    expect(emailNames('marko@example.test')).toEqual({ firstName: 'Marko', lastName: 'Marko' });
    expect(emailNames('...@example.test')).toEqual({ firstName: 'Invited', lastName: 'Person' });
  });

  it('keeps names within 100 characters', () => {
    const { firstName, lastName } = emailNames(`${'a'.repeat(150)}.${'b'.repeat(150)}@example.test`);
    expect(firstName).toHaveLength(100);
    expect(lastName).toHaveLength(100);
  });
});
