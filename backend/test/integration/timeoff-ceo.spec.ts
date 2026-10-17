/**
 * The CEO's time off (CD-350): only the workspace's CEO (the org chart's company node) gets their
 * own requests approved automatically; everyone else's waits for its approver, Admins included.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTenant, ok, type Session, signIn } from './helpers';
import { joinAsEmployee, START } from './people-helpers';

let owner: Session, ceo: Session, emp: Session;
let tenant: string, ceoId: string, empId: string;
const as = (s: Session) => ({ token: s.token, tenant });
const NEXT = new Date().getUTCFullYear() + 1;
// Next year's first Monday of February and weeks after it (avoiding 15 and 16 February, Serbian holidays).
const firstMonday = (() => {
  const d = new Date(Date.UTC(NEXT, 1, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  [owner, ceo, emp] = (await Promise.all(['owner', 'ceo', 'emp'].map((n) => signIn(`tceo-${n}`)))) as [Session, Session, Session];
  tenant = await createTenant(owner, 'CEO time off');
  ceoId = await joinAsEmployee(owner, tenant, ceo);
  empId = await joinAsEmployee(owner, tenant, emp);
  for (const id of [ceoId, empId]) await ok('PATCH', `/people/employees/${id}`, { ...as(owner), body: { employmentStartDate: START, ...(id === empId ? { managerId: ceoId } : {}) } }, 200);
  await ok('PATCH', '/workspace', { ...as(owner), body: { ceoEmployeeId: ceoId } });
});

describe("the CEO's own time off (CD-350)", () => {
  it('is approved automatically, and the preview says so', async () => {
    const body = { type: 'unpaid_leave', startDate: firstMonday, endDate: addDays(firstMonday, 1) };
    const preview = await ok<{ autoApproved: boolean }>('POST', '/timeoff/requests/preview', { ...as(ceo), body }, 200);
    expect(preview.autoApproved).toBe(true);
    const saved = await ok<{ status: string; recorded: boolean }>('POST', '/timeoff/requests', { ...as(ceo), body });
    expect(saved).toMatchObject({ status: 'approved', recorded: false });
  });

  it("everyone else's request waits for its approver, also when an Admin requests it for them", async () => {
    const body = { type: 'unpaid_leave', startDate: addDays(firstMonday, 7), endDate: addDays(firstMonday, 8) };
    expect((await ok<{ autoApproved: boolean }>('POST', '/timeoff/requests/preview', { ...as(emp), body }, 200)).autoApproved).toBe(false);
    expect((await ok<{ status: string }>('POST', '/timeoff/requests', { ...as(emp), body })).status).toBe('pending');
    const forThem = await ok<{ status: string }>('POST', '/timeoff/requests', { ...as(owner), body: { ...body, employeeId: empId, startDate: addDays(firstMonday, 28), endDate: addDays(firstMonday, 28) } });
    expect(forThem.status).toBe('pending');
  });

  it('a workspace without a CEO approves nobody automatically', async () => {
    await ok('PATCH', '/workspace', { ...as(owner), body: { ceoEmployeeId: null } });
    const saved = await ok<{ status: string }>('POST', '/timeoff/requests', { ...as(ceo), body: { type: 'unpaid_leave', startDate: addDays(firstMonday, 21), endDate: addDays(firstMonday, 21) } });
    expect(saved.status).toBe('pending');
  });
});
