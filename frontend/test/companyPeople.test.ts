// The people a company shows, counted the same on the Companies list and the company page (CD-518), and
// where an opportunity's primary contact belongs (CD-533): `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { primaryPerson, uniquePeople } from '../src/store/companyPeople.ts';
import type { Lead } from '../src/store/types.ts';

describe("an opportunity's primary contact (CD-533)", () => {
  // Ana is the primary contact of Tidewater's opportunity; the New company dialog moved her to Delta Trade.
  const deal = {
    id: 'd1',
    companyId: 'tidewater',
    company: 'Tidewater Foods',
    contactId: 'ana',
    contact: 'Ana Kovač',
    role: 'Head of purchasing',
    initials: 'AK',
    email: 'ana@example.test',
    phone: '',
    buyerRole: 'Decision maker',
    contactOwnerId: 'u1',
    contactCompanyId: 'delta',
    contactCompany: 'Delta Trade',
  } as unknown as Lead;

  it('belongs to the company on their contact row, not to the opportunity (QA 4e: Ana stayed at Tidewater)', () => {
    const ana = primaryPerson(deal);
    assert.equal(ana.companyId, 'delta');
    assert.equal(ana.company, 'Delta Trade');
    assert.equal(ana.leadId, 'd1', 'still shown on the opportunity until replaced');
    assert.equal(ana.primary, true);
  });

  it('keeps the contact details the readiness checks read', () => {
    const ana = primaryPerson(deal);
    assert.deepEqual([ana.name, ana.role, ana.buyerRole, ana.ownerId, ana.contactId, ana.id], ['Ana Kovač', 'Head of purchasing', 'Decision maker', 'u1', 'ana', 'd1:p']);
  });

  it('has no company when the contact row has none, even on a company’s opportunity', () => {
    const p = primaryPerson({ ...deal, contactCompanyId: null, contactCompany: undefined });
    assert.equal(p.companyId, null);
    assert.equal(p.company, undefined);
  });
});

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
