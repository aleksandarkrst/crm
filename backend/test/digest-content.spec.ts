import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  dealAssignedEmail,
  DIGEST_SECTION_LIMIT,
  digestEmail,
  digestItemCount,
  type DigestTaskRow,
  isDigestHour,
  isEmptyDigest,
  zonedNow,
} from '../src/modules/notifications/digest-content';

const task = (id: string, dueDate: string, over: Partial<DigestTaskRow> = {}): DigestTaskRow => ({ id, title: `Task ${id}`, dueDate, dealId: `deal-${id}`, dealTitle: `Deal ${id}`, company: 'Acme', ...over });

describe('buildDigest', () => {
  it('splits tasks into overdue and due today, oldest first, and keeps the deals without a next step', () => {
    const d = buildDigest('2026-09-24', [task('c', '2026-09-24'), task('a', '2026-09-20'), task('b', '2026-09-23')], [
      { id: 'd2', title: 'Zeta', company: null, stage: 'Discovery' },
      { id: 'd1', title: 'Alpha', company: 'Acme', stage: 'Proposal' },
    ]);
    expect(d.overdue.map((t) => t.id)).toEqual(['a', 'b']);
    expect(d.dueToday.map((t) => t.id)).toEqual(['c']);
    expect(d.noNextStep.map((x) => x.title)).toEqual(['Alpha', 'Zeta']);
    expect(digestItemCount(d)).toBe(5);
    expect(isEmptyDigest(d)).toBe(false);
  });

  it('leaves out tasks due later (the loader only asks up to today, but the builder is strict too)', () => {
    const d = buildDigest('2026-09-24', [task('x', '2026-09-25')], []);
    expect(isEmptyDigest(d)).toBe(true);
  });
});

describe('zonedNow and the digest hour', () => {
  const at = new Date('2026-09-24T06:30:00Z');
  it('reads the date and hour on the workspace clock', () => {
    expect(zonedNow('Europe/Belgrade', at)).toEqual({ date: '2026-09-24', hour: 8, minute: 30 });
    expect(zonedNow('America/New_York', at)).toEqual({ date: '2026-09-24', hour: 2, minute: 30 });
    expect(zonedNow('Pacific/Kiritimati', at)).toEqual({ date: '2026-09-24', hour: 20, minute: 30 });
    expect(zonedNow('Pacific/Pago_Pago', at)).toEqual({ date: '2026-09-23', hour: 19, minute: 30 });
    expect(zonedNow('Asia/Kolkata', at)).toEqual({ date: '2026-09-24', hour: 12, minute: 0 });
  });

  it('treats an unknown zone as UTC and midnight as hour 0', () => {
    expect(zonedNow('Not/AZone', at)).toEqual({ date: '2026-09-24', hour: 6, minute: 30 });
    expect(zonedNow('UTC', new Date('2026-09-24T00:05:00Z')).hour).toBe(0);
  });

  it('opens the window from 8:00 to 11:59', () => {
    expect([7, 8, 9, 11, 12, 20].map(isDigestHour)).toEqual([false, true, true, true, false, false]);
  });
});

describe('digestEmail', () => {
  const digest = buildDigest('2026-09-24', [task('a', '2026-09-22', { title: 'Call <Ana>' }), task('b', '2026-09-24', { company: null })], [{ id: 'd1', title: 'Renewal', company: 'Globex', stage: 'Proposal' }]);
  const mail = digestEmail({ to: 'bo@example.com', memberName: 'Bo Jensen', workspaceName: 'Acme Studio', appUrl: 'https://app.example.com/', digest });

  it('summarises the counts in the subject', () => {
    expect(mail.subject).toBe('Your day in Acme Studio: 1 overdue, 1 due today, 1 deal without a next step');
  });

  it('lists each section with links to the deals, in text and HTML', () => {
    expect(mail.text).toContain('Good morning, Bo.');
    expect(mail.text).toContain('Thursday 24 September');
    expect(mail.text).toContain('Overdue tasks (1)\n- Call <Ana> (was due 22 Sept) · Deal a · Acme\n  https://app.example.com/deals/deal-a');
    expect(mail.text).toContain('Due today (1)\n- Task b · Deal b\n');
    expect(mail.text).toContain('Deals with no next step (1)\n- Renewal · Globex · Proposal\n  https://app.example.com/deals/d1');
    expect(mail.text).toContain('https://app.example.com/settings/notifications');
    expect(mail.html).toContain('Call &lt;Ana&gt;');
    expect(mail.html).toContain('href="https://app.example.com/deals/d1"');
  });

  it('leaves out empty sections and caps long ones', () => {
    const many = buildDigest('2026-09-24', Array.from({ length: DIGEST_SECTION_LIMIT + 3 }, (_, i) => task(String(i).padStart(2, '0'), '2026-09-24')), []);
    const m = digestEmail({ to: 'x@example.com', memberName: null, workspaceName: 'W', appUrl: 'https://a.test', digest: many });
    expect(m.subject).toBe(`Your day in W: ${DIGEST_SECTION_LIMIT + 3} due today`);
    expect(m.text).not.toContain('Overdue tasks');
    expect(m.text).not.toContain('no next step');
    expect(m.text).toContain('- and 3 more');
    expect(m.text.startsWith('Good morning.')).toBe(true);
  });
});

describe('dealAssignedEmail', () => {
  it('says who assigned which deal, with its facts and link', () => {
    const mail = dealAssignedEmail({
      to: 'bo@example.com',
      assigneeName: 'Bo Jensen',
      actorName: 'Ana Petrović',
      workspaceName: 'Acme Studio',
      appUrl: 'https://app.example.com',
      deal: { id: 'd1', title: 'Website rebuild', company: 'Globex', stage: 'Discovery', amount: '14000.00', currency: 'EUR', closeDate: '2026-10-15' },
    });
    expect(mail.subject).toBe('Ana Petrović assigned you Website rebuild');
    expect(mail.text).toContain('Ana Petrović made you the owner of Website rebuild in Acme Studio.');
    expect(mail.text).toContain('Company: Globex\nStage: Discovery\nValue: €14,000\nExpected close: 15 Oct');
    expect(mail.text).toContain('https://app.example.com/deals/d1');
  });
});
