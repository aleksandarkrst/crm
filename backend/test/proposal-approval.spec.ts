import { describe, expect, it } from 'vitest';
import { approvalStatus } from '../src/modules/crm/deals/proposal-approval';
import { approvalRequestedEmail, buildDigest, digestEmail } from '../src/modules/notifications/digest-content';

const at = new Date('2026-10-20T09:00:00Z');

describe('approvalStatus (CD-120)', () => {
  it('is Not required when the funnel asks for no approval, whatever was stored', () => {
    expect(approvalStatus(false, { approvalRequestedAt: at, approvedAt: at })).toBe('not_required');
  });

  it('goes Not requested → Pending → Approved, and back to Not requested once cleared', () => {
    expect(approvalStatus(true, { approvalRequestedAt: null, approvedAt: null })).toBe('not_requested');
    expect(approvalStatus(true, { approvalRequestedAt: at, approvedAt: null })).toBe('pending');
    expect(approvalStatus(true, { approvalRequestedAt: at, approvedAt: at })).toBe('approved');
  });
});

describe('approval emails and the digest (CD-120)', () => {
  it('asks the approver, with a link to the opportunity', () => {
    const mail = approvalRequestedEmail({
      to: 'dragan@example.test',
      recipientName: 'Dragan Tomić',
      actorName: 'Marko Jović',
      workspaceName: 'Vega',
      funnelName: 'Tender',
      appUrl: 'https://app.example.test/',
      deal: { id: 'd1', title: 'SCADA upgrade', company: 'JKP Vodovod Niš', stage: 'Offer' },
    });
    expect(mail.subject).toBe('Marko Jović asks you to approve the proposal for SCADA upgrade');
    expect(mail.text).toContain('Hi Dragan,');
    expect(mail.text).toContain('https://app.example.test/deals/d1');
    expect(mail.text).toContain('Funnel: Tender');
  });

  it('lists pending proposals, and they alone are reason enough to send the digest', () => {
    const digest = buildDigest('2026-10-20', [], [], { approvalsPending: [{ id: 'd1', title: 'SCADA upgrade', company: 'JKP Vodovod Niš', stage: 'Offer' }] });
    expect(digest.approvalsPending).toHaveLength(1);
    const mail = digestEmail({ to: 'dragan@example.test', memberName: 'Dragan Tomić', workspaceName: 'Vega', appUrl: 'https://app.example.test', digest });
    expect(mail.subject).toContain('1 proposal to approve');
    expect(mail.text).toContain('Proposals waiting for your approval');
  });
});
