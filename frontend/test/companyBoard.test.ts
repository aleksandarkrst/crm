// Unit tests of the Companies Kanban (CD-359): a lead's readiness line (N of 7, the API's checks)
// and what dropping a card on a status column does. `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dropOutcome, readiness } from '../src/store/companyBoard.ts';

const complete = { pib: '104532877', mb: '20084693', address: 'Bulevar 10', city: 'Novi Sad', postalCode: '21000', activityCode: '4941' };
const ceo = { name: 'Nikola Ilić', role: 'CEO', buyerRole: 'Decision maker', ownerId: 'u1' };

describe('the readiness line', () => {
  it('is 7 of 7 with nothing missing for a complete company and a qualified contact', () => {
    assert.deepEqual(readiness(complete, [ceo]), { ready: 7, total: 7, blockers: [], missing: [] });
  });

  it('counts the address as three checks, shown as one item', () => {
    const r = readiness({ ...complete, address: '', city: ' ', postalCode: '' }, [ceo]);
    assert.equal(r.ready, 4);
    assert.deepEqual(r.blockers, ['Address (street, city and postal code)']);
    assert.deepEqual(r.missing, ['address']);
  });

  it('names what the closest contact lacks, or asks for a contact', () => {
    const r = readiness({ ...complete, mb: '', activityCode: '' }, [{ name: 'Ana', role: 'CFO', buyerRole: '', ownerId: null }]);
    assert.equal(r.ready, 4);
    assert.deepEqual(r.missing, ['MB', 'activity code', 'contact role in the decision and owner']);
    assert.equal(r.blockers[2], 'A contact with a job title, a role in the decision and an owner: Ana has no role in the decision or owner yet.');
    assert.deepEqual(readiness(undefined, []), {
      ready: 0,
      total: 7,
      blockers: ['Company ID (PIB)', 'Matični broj', 'Address (street, city and postal code)', 'Šifra delatnosti', 'A contact with a job title, a role in the decision and an owner'],
      missing: ['PIB', 'MB', 'address', 'activity code', 'a contact'],
    });
  });
});

describe('dropping a card', () => {
  const lead = { name: 'Vega', status: 'lead' as const, manual: false, missing: ['MB', 'address'] };

  it('does nothing on its own column', () => {
    assert.deepEqual(dropOutcome(lead, 'lead', true), { kind: 'none' });
  });

  it('sets a status further back by hand, if this person may', () => {
    const client = { ...lead, status: 'client' as const, missing: [] };
    assert.deepEqual(dropOutcome(client, 'lead', true), { kind: 'setBack', to: 'lead' });
    assert.deepEqual(dropOutcome(client, 'not_interested', true), { kind: 'setBack', to: 'not_interested' });
    assert.equal(dropOutcome(client, 'opportunity', false).kind, 'refuse');
  });

  it('opens the company with how it moves on, for a status further on', () => {
    assert.deepEqual(dropOutcome(lead, 'opportunity', true), { kind: 'open', message: 'Vega becomes an Opportunity by itself once these are filled in: MB and address.' });
    assert.match((dropOutcome({ ...lead, status: 'opportunity' }, 'client', true) as { message: string }).message, /when one of its opportunities is won/);
    // Client is further on than Past client, though its column is to the left.
    assert.match((dropOutcome({ ...lead, status: 'past_client' }, 'client', true) as { message: string }).message, /when one of its opportunities is won/);
    assert.match((dropOutcome({ ...lead, status: 'opportunity', manual: true }, 'client', true) as { message: string }).message, /Back to automatic/);
  });
});
