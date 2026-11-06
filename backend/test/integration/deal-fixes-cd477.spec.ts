/**
 * CD-477: a new owner is on the opportunity's timeline, winning sets the closing date to the
 * workspace's today, removing a done stage to-do says so on the timeline, and a contact linked to
 * an opportunity without a primary contact becomes its primary one (QA TC12).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTenant, firstFunnel, type Funnel, ok, readyCompany, type Session, signIn } from './helpers';

let owner: Session;
let colleague: Session;
let tenant: string;
let funnel: Funnel;
let companyId: string;
const as = () => ({ token: owner.token, tenant });
const activities = async (dealId: string): Promise<{ title: string; detail: string | null }[]> => ok('GET', `/crm/deals/${dealId}/activities`, as());
const newDeal = (title: string) => ok('POST', '/crm/deals', { ...as(), body: { title, funnelId: funnel.id, companyId } });
/** The workspace's today: a new workspace is in Europe/Belgrade (never the UTC date, CD-338). */
const workspaceToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(new Date());

beforeAll(async () => {
  owner = await signIn('cd477-owner');
  colleague = await signIn('cd477-colleague');
  tenant = await createTenant(owner, 'CD-477');
  await addMember(owner, tenant, colleague, 'member');
  funnel = await firstFunnel(owner, tenant);
  companyId = (await readyCompany(owner, tenant)).id;
});

describe('changing the owner', () => {
  it('logs who had it and who has it now, once', async () => {
    const deal = await newDeal('Handover');
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { ownerUserId: colleague.userId } }, 200);
    const entries = (await activities(deal.id)).filter((a) => a.title.startsWith('Owner: '));
    expect(entries).toEqual([expect.objectContaining({ title: `Owner: ${colleague.name}`, detail: `Was ${owner.name}.` })]);

    // The same owner again changes nothing, so nothing is logged.
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { ownerUserId: colleague.userId } }, 200);
    expect((await activities(deal.id)).filter((a) => a.title.startsWith('Owner: '))).toHaveLength(1);
  });
});

describe('winning', () => {
  it("sets the closing date to the workspace's today", async () => {
    const deal = await newDeal('Closing');
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { closeDate: '2031-03-01' } }, 200);
    const won = funnel.stages.find((st) => st.isWon)!;
    const moved = await ok('POST', `/crm/deals/${deal.id}/move`, { ...as(), body: { stageId: won.id } }, 200);
    expect(moved.outcome).toBe('won');
    expect(moved.closeDate).toBe(workspaceToday());
    // Moved out of Won again: it is open, with no closing date.
    const back = await ok('POST', `/crm/deals/${deal.id}/move`, { ...as(), body: { stageId: funnel.stages.filter((st) => !st.isWon).at(-1)!.id } }, 200);
    expect(back).toMatchObject({ outcome: 'open', closeDate: null });
  });

  it('leaves the closing date alone on an ordinary move', async () => {
    const deal = await newDeal('Still open');
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { closeDate: '2031-03-01' } }, 200);
    const moved = await ok('POST', `/crm/deals/${deal.id}/move`, { ...as(), body: { stageId: funnel.stages[1]!.id } }, 200);
    expect(moved.closeDate).toBe('2031-03-01');
  });
});

describe('removing a stage to-do', () => {
  it('says "To-do removed" when it had been marked done', async () => {
    const deal = await newDeal('Done then gone');
    const todo = await ok('POST', `/crm/deals/${deal.id}/tasks`, { ...as(), body: { stageId: funnel.stages[0]!.id, label: 'Call the CFO' } });
    await ok('PATCH', `/crm/deal-tasks/${todo.id}`, { ...as(), body: { done: true } }, 200);
    await ok('DELETE', `/crm/deal-tasks/${todo.id}`, as());
    expect(await activities(deal.id)).toContainEqual(expect.objectContaining({ title: 'To-do removed: Call the CFO', detail: 'It had been marked done.' }));
  });

  it('logs a named to-do added and removed, also when named after it was added; nothing for a nameless one', async () => {
    const deal = await newDeal('Never done');
    const titles = async () => (await activities(deal.id)).map((a: { title: string }) => a.title);
    const open = await ok('POST', `/crm/deals/${deal.id}/tasks`, { ...as(), body: { stageId: funnel.stages[0]!.id, label: 'Check budget' } });
    const later = await ok('POST', `/crm/deals/${deal.id}/tasks`, { ...as(), body: { stageId: funnel.stages[0]!.id, label: '' } });
    await ok('PATCH', `/crm/deal-tasks/${later.id}`, { ...as(), body: { label: 'Send the deck' } }, 200);
    await ok('PATCH', `/crm/deal-tasks/${later.id}`, { ...as(), body: { label: 'Send the deck v2' } }, 200);
    expect((await titles()).filter((t) => t.startsWith('To-do added'))).toEqual(expect.arrayContaining(['To-do added: Check budget', 'To-do added: Send the deck']));
    expect((await titles()).filter((t) => t.startsWith('To-do added'))).toHaveLength(2);
    await ok('DELETE', `/crm/deal-tasks/${open.id}`, as());
    expect(await activities(deal.id)).toContainEqual(expect.objectContaining({ title: 'To-do removed: Check budget', detail: null }));

    const blank = await ok('POST', `/crm/deals/${deal.id}/tasks`, { ...as(), body: { stageId: funnel.stages[0]!.id, label: '' } });
    const before = await activities(deal.id);
    await ok('DELETE', `/crm/deal-tasks/${blank.id}`, as());
    expect(await activities(deal.id)).toEqual(before);
  });
});

describe('linking a contact', () => {
  const newContact = (fullName: string) => ok<{ id: string }>('POST', '/crm/contacts', { ...as(), body: { companyId, fullName, jobTitle: 'CTO', buyerRole: 'Decision maker', ownerUserId: owner.userId } });

  it('makes it the primary contact when the opportunity has none, and leaves an existing one alone (QA TC12)', async () => {
    const deal = await newDeal('No contact yet');
    expect(deal.primaryContactId).toBeNull();
    const first = await newContact('Mila Linked');
    await ok('PUT', `/crm/deals/${deal.id}/contacts/${first.id}`, as(), 204);
    expect(await ok('GET', `/crm/deals/${deal.id}`, as())).toMatchObject({ primaryContactId: first.id });

    // A second link is only a link: the primary contact stays.
    const second = await newContact('Marko Linked');
    await ok('PUT', `/crm/deals/${deal.id}/contacts/${second.id}`, as(), 204);
    expect(await ok('GET', `/crm/deals/${deal.id}`, as())).toMatchObject({ primaryContactId: first.id });
    const rows = await ok<{ deal: { id: string }; contactIds: string[] }[]>('GET', '/crm/deals', as());
    expect(rows.find((r) => r.deal.id === deal.id)!.contactIds).toEqual(expect.arrayContaining([first.id, second.id]));
  });
});
