// The people a company shows, counted the same on the Companies list and the company page (CD-518): `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { uniquePeople } from '../src/store/companyPeople.ts';

describe("a company's people (CD-518)", () => {
  const own = { id: 'c1', contactId: 'c1', name: 'Ana' };
  const onDeal = { id: 'd1:p', contactId: 'c2', name: 'Marko' };

  it('counts its own contact and a different contact on its opportunity (QA: list said 1, page showed 2)', () => {
    assert.equal(uniquePeople([own], [[onDeal]]).length, 2);
  });

  it('counts a person once when they are both its contact and on its opportunities', () => {
    const same = { id: 'd1:p', contactId: 'c1', name: 'Ana' };
    assert.deepEqual(uniquePeople([own], [[same], [same]]), [own]);
  });

  it('counts the people of an opportunity without a company contact', () => {
    assert.deepEqual(
      uniquePeople([], [[onDeal]]).map((p) => p.name),
      ['Marko'],
    );
  });
});
