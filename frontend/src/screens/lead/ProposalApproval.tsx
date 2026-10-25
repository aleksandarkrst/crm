import { useEffect, useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { APPROVAL_LABELS, approvalStatusOf, memberName, momentLabel } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

/**
 * "Offer approval" (CD-120): when the opportunity's funnel asks for it, its proposal is approved
 * before it is sent. Anyone who works it requests approval; the funnel's approver, owners and
 * admins approve, decline or revoke. Hidden in a funnel without the rule.
 */
export function ProposalApproval({ lead }: { lead: Lead }) {
  const { s, session, proposalApproval, ensureDocs } = useStore();
  const [busy, setBusy] = useState(false);
  useEffect(() => ensureDocs(lead.id), [lead.id, ensureDocs]);
  const status = approvalStatusOf(s, lead);
  if (status === 'not_required') return null;

  const funnel = s.funnels[lead.segment]!;
  const approver = funnel.approverId ? memberName(s, funnel.approverId) : 'an approver';
  const mayDecide = session.userId === funnel.approverId || session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const docs = s.dealDocs[lead.id];
  const noProposal = !!docs && !docs.some((d) => d.docType === 'Proposal' && d.status === 'ready');
  const closed = lead.outcome !== 'open';
  const tz = s.workspace.timezone;
  const a = lead.approval;
  const step = (which: 'request' | 'approve' | 'revoke') => {
    setBusy(true);
    void proposalApproval(lead.id, which).finally(() => setBusy(false));
  };
  const revoke = async () => {
    const ok = await askConfirm({
      title: 'Revoke the approval?',
      message: 'The proposal goes back to Not requested and needs approval again before it is sent. The activity keeps the revocation.',
      confirmLabel: 'Revoke approval',
      danger: true,
    });
    if (ok) step('revoke');
  };
  const badge = status === 'approved' ? 'badge-brand' : status === 'pending' ? 'badge-warn' : 'badge-neutral';

  return (
    <div className="card card-pad" data-testid="proposal-approval">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div className="card-title">Offer approval</div>
        <span className={'badge ' + badge} data-testid="approval-status">
          {APPROVAL_LABELS[status]}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55, marginTop: 8 }}>
        {status === 'not_requested' && (
          <>
            Proposals in the {funnel.label} funnel need approval by <b style={{ color: 'var(--ink)' }}>{approver}</b> before they are sent.
            {noProposal && ' Add the proposal on the Documents tab first.'}
          </>
        )}
        {status === 'pending' && (
          <>
            Requested by {memberName(s, a.requestedBy)}
            {a.requestedAt ? ` on ${momentLabel(a.requestedAt, tz)}` : ''}. Waiting for <b style={{ color: 'var(--ink)' }}>{approver}</b>.
          </>
        )}
        {status === 'approved' && (
          <>
            Approved by {memberName(s, a.approvedBy)}
            {a.approvedAt ? ` on ${momentLabel(a.approvedAt, tz)}` : ''}. {a.sentAt ? `Sent on ${momentLabel(a.sentAt, tz)}.` : 'The proposal can be sent.'}
          </>
        )}
      </div>
      {!closed && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {status === 'not_requested' && (
            <button type="button" className="btn btn-primary" data-testid="approval-request" disabled={busy || noProposal || !funnel.approverId} onClick={() => step('request')}>
              Request approval
            </button>
          )}
          {status === 'pending' && mayDecide && (
            <>
              <button type="button" className="btn btn-primary" data-testid="approval-approve" disabled={busy} onClick={() => step('approve')}>
                Approve
              </button>
              <button type="button" className="btn btn-secondary" data-testid="approval-decline" disabled={busy} onClick={() => step('revoke')}>
                Decline
              </button>
            </>
          )}
          {status === 'approved' && mayDecide && (
            <button type="button" className="btn btn-secondary" data-testid="approval-revoke" disabled={busy} onClick={() => void revoke()}>
              Revoke approval
            </button>
          )}
        </div>
      )}
    </div>
  );
}
