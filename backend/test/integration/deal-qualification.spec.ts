/**
 * Qualification (CD-362): sponsor and power sponsor as contacts, pain and solution, the steps to be
 * qualified with "Other", and the Qualified switch with who and when, its timeline entries and history.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, type Funnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let seller: Session;
let outsider: Session;
let tenant: string;
let otherTenant: string;
let funnel: Funnel;
const asOwner = () => ({ token: owner.token, tenant });
const asSeller = () => ({ token: seller.token, tenant });

const newDeal = (title: string) => ok('POST', '/crm/deals', { ...asOwner(), body: { title, funnelId: funnel.id } });
const newContact = (fullName: string, opts = asOwner()) => ok('POST', '/crm/contacts', { ...opts, body: { fullName } });
const patch = (id: string, body: Record<string, unknown>, opts = asOwner()) => ok('PATCH', `/crm/deals/${id}`, { ...opts, body }, 200);
const activities = (id: string) => ok<{ title: string; actor: { userId: string | null; name: string } | null }[]>('GET', `/crm/deals/${id}/activities`, asOwner());

beforeAll(async () => {
  [owner, seller, outsider] = await Promise.all([signIn('qual-owner'), signIn('qual-seller'), signIn('qual-outsider')]);
  [tenant, otherTenant] = await Promise.all([createTenant(owner, 'Qualification'), createTenant(outsider, 'Qualification other')]);
  await addMember(owner, tenant, seller, 'member');
  funnel = (await ok<Funnel[]>('GET', '/crm/funnels', asOwner()))[0]!;
});

describe('qualification fields', () => {
  it('a new deal has none of them, and saving other fields leaves them empty', async () => {
    const deal = await newDeal('Empty qualification');
    expect(deal).toMatchObject({ sponsorContactId: null, powerSponsorContactId: null, pain: null, painSolution: null, qualificationSteps: [], qualificationOther: null, qualifiedAt: null, qualifiedByUserId: null });
    expect(await patch(deal.id, { title: 'Still empty' })).toMatchObject({ title: 'Still empty', qualificationSteps: [], qualifiedAt: null });
  });

  it('saves sponsors as contacts, pain, solution, steps and other, and they read back', async () => {
    const deal = await newDeal('Qualified fields');
    const [sponsor, power] = await Promise.all([newContact('Sara Sponsor'), newContact('Petar Power')]);
    await patch(deal.id, {
      sponsorContactId: sponsor.id,
      powerSponsorContactId: power.id,
      pain: 'Outages and overtime',
      painSolution: 'Remote monitoring',
      qualificationSteps: ['Confirm budget', 'Confirm pain'],
      qualificationOther: 'Tender published',
    });
    expect(await ok('GET', `/crm/deals/${deal.id}`, asOwner())).toMatchObject({
      sponsorContactId: sponsor.id,
      powerSponsorContactId: power.id,
      pain: 'Outages and overtime',
      painSolution: 'Remote monitoring',
      qualificationSteps: ['Confirm budget', 'Confirm pain'],
      qualificationOther: 'Tender published',
    });
  });

  it('steps can be removed one by one and cleared; empty text and null clear the others', async () => {
    const deal = await newDeal('Clearing');
    const sponsor = await newContact('Clear Sponsor');
    await patch(deal.id, { sponsorContactId: sponsor.id, pain: 'Pain', qualificationSteps: ['Confirm pain', 'Agree on timeline', 'Confirm pain'], qualificationOther: 'Other' });
    expect((await ok('GET', `/crm/deals/${deal.id}`, asOwner())).qualificationSteps).toEqual(['Confirm pain', 'Agree on timeline']);

    expect((await patch(deal.id, { qualificationSteps: ['Agree on timeline'] })).qualificationSteps).toEqual(['Agree on timeline']);
    expect(await patch(deal.id, { sponsorContactId: null, pain: '', qualificationSteps: [], qualificationOther: '' })).toMatchObject({
      sponsorContactId: null,
      pain: null,
      qualificationSteps: [],
      qualificationOther: null,
    });
  });

  it('refuses a step that is not on the list, and a contact of another workspace', async () => {
    const deal = await newDeal('Refusals');
    expect((await call('PATCH', `/crm/deals/${deal.id}`, { ...asOwner(), body: { qualificationSteps: ['Sign the NDA'] } })).status).toBe(400);
    const theirs = await newContact('Not yours', { token: outsider.token, tenant: otherTenant });
    expect((await call('PATCH', `/crm/deals/${deal.id}`, { ...asOwner(), body: { powerSponsorContactId: theirs.id } })).status).toBe(400);
    expect((await ok('GET', `/crm/deals/${deal.id}`, asOwner())).powerSponsorContactId).toBeNull();
  });

  it('deleting a contact takes it off the deals it sponsors; the deal stays', async () => {
    const deal = await newDeal('Sponsor deleted');
    const sponsor = await newContact('Leaving Sponsor');
    await patch(deal.id, { sponsorContactId: sponsor.id, powerSponsorContactId: sponsor.id });
    await ok('DELETE', `/crm/contacts/${sponsor.id}`, asOwner(), 204);
    expect(await ok('GET', `/crm/deals/${deal.id}`, asOwner())).toMatchObject({ sponsorContactId: null, powerSponsorContactId: null });
  });

  it('CHAMP scores are no longer accepted', async () => {
    const deal = await newDeal('No CHAMP');
    // Unknown keys are dropped; with nothing else in the patch there is nothing to save.
    expect((await call('PATCH', `/crm/deals/${deal.id}`, { ...asOwner(), body: { champ: { C: 25, H: 25, M: 25, P: 25 } } })).status).toBe(400);
    expect((await ok('GET', `/crm/deals/${deal.id}`, asOwner())).fitScore).toBe(0);
  });
});

describe('the Qualified switch', () => {
  it('any member who can edit the deal turns it on: who and when are recorded and logged', async () => {
    const deal = await newDeal('Seller qualifies');
    const before = Date.now();
    const on = await patch(deal.id, { qualified: true }, asSeller());
    expect(on.qualifiedByUserId).toBe(seller.userId);
    expect(Date.parse(on.qualifiedAt)).toBeGreaterThanOrEqual(before - 1000);
    const log = await activities(deal.id);
    expect(log[0]).toMatchObject({ title: 'Marked Qualified', actor: { userId: seller.userId } });
  });

  it('turning it on again keeps the first author and date, and logs nothing new', async () => {
    const deal = await newDeal('Twice');
    const first = await patch(deal.id, { qualified: true }, asSeller());
    const again = await patch(deal.id, { qualified: true });
    expect(again).toMatchObject({ qualifiedAt: first.qualifiedAt, qualifiedByUserId: seller.userId });
    expect((await activities(deal.id)).filter((a) => a.title === 'Marked Qualified')).toHaveLength(1);
  });

  it('turning it off clears who and when and logs "No longer Qualified"', async () => {
    const deal = await newDeal('Off again');
    await patch(deal.id, { qualified: true }, asSeller());
    expect(await patch(deal.id, { qualified: false })).toMatchObject({ qualifiedAt: null, qualifiedByUserId: null });
    const log = await activities(deal.id);
    expect(log[0]).toMatchObject({ title: 'No longer Qualified', actor: { userId: owner.userId } });
    // Off while off: nothing to log.
    await patch(deal.id, { qualified: false });
    expect((await activities(deal.id)).filter((a) => a.title === 'No longer Qualified')).toHaveLength(1);
  });

  it('the change history names the sponsor and records Qualified', async () => {
    const deal = await newDeal('History');
    const sponsor = await newContact('Hana History');
    await patch(deal.id, { sponsorContactId: sponsor.id, qualificationSteps: ['Confirm budget'] });
    await patch(deal.id, { qualified: true });
    const { entries } = await ok<{ entries: { field: string | null; newValue: unknown; newLabel: string | null }[] }>('GET', `/crm/history?entityType=deal&entityId=${deal.id}`, asOwner());
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'sponsorContactId', newLabel: 'Hana History' }),
        expect.objectContaining({ field: 'qualificationSteps', newValue: ['Confirm budget'] }),
        expect.objectContaining({ field: 'qualifiedAt' }),
      ]),
    );
  });
});
