import { useEffect, useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { APPROVAL_LABELS, approvalStatusOf, memberName, momentLabel } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

/**
 * The proposal's next step (CD-120), on the Documents tab and in the built-in proposal: Request
 * approval when the funnel asks for it (Approval pending once asked), Approve or Decline for the
 * funnel's approver, owners and admins, then Send proposal (with Revoke approval for them); Send
 * proposal straight away in a funnel without approval. The badge keeps the approval status.
 * `look="doc"` styles the buttons for the proposal's dark header.
 */
export function ProposalActions({ lead, look = 'tab' }: { lead: Lead; look?: 'tab' | 'doc' }) {
  const { s, session, proposalApproval, markProposalSent, ensureDocs } = useStore();
  const [busy, setBusy] = useState(false);
  useEffect(() => ensureDocs(lead.id), [lead.id, ensureDocs]);
  const status = approvalStatusOf(s, lead);
  const funnel = s.funnels[lead.segment];
  const approverId = funnel?.approverId ?? null;
  const approver = approverId ? memberName(s, approverId) : 'an approver';
  const mayDecide = session.userId === approverId || session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const docs = s.dealDocs[lead.id];
  const noProposal = !!docs && !docs.some((d) => d.docType === 'Proposal' && d.status === 'ready');
  const tz = s.workspace.timezone;
  const a = lead.approval;
  const primary = look === 'doc' ? 'doc-btn doc-btn-primary' : 'btn btn-primary';
  const secondary = look === 'doc' ? 'doc-btn' : 'btn btn-secondary';

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };
  const revoke = async () => {
    const ok = await askConfirm({
      title: 'Revoke the approval?',
      message: 'The proposal goes back to Not requested and needs approval again before it is sent. The activity keeps the revocation.',
      confirmLabel: 'Revoke approval',
      danger: true,
    });
    if (ok) run(() => proposalApproval(lead.id, 'revoke'));
  };
  const detail =
    status === 'pending'
      ? `Requested by ${memberName(s, a.requestedBy)}${a.requestedAt ? ' on ' + momentLabel(a.requestedAt, tz) : ''}. Waiting for ${approver}.`
      : status === 'approved'
        ? `Approved by ${memberName(s, a.approvedBy)}${a.approvedAt ? ' on ' + momentLabel(a.approvedAt, tz) : ''}.${a.sentAt ? ` Sent on ${momentLabel(a.sentAt, tz)}.` : ''}`
        : status === 'not_requested'
          ? `Proposals in this funnel need approval by ${approver} before they are sent.`
          : a.sentAt
            ? `Sent on ${momentLabel(a.sentAt, tz)}.`
            : undefined;
  // Why Request approval can't be pressed: shown as text, since a disabled button's title never shows on touch.
  const blocked =
    lead.outcome !== 'open'
      ? null
      : status === 'not_requested'
        ? !approverId
          ? 'This funnel has no approver yet. An admin picks one in Settings → Funnels.'
          : noProposal
            ? 'Generate the proposal or import your own first.'
            : null
        : (status === 'not_required' || status === 'approved') && !a.sentAt && noProposal
          ? 'Generate the proposal or import your own first.'
          : null;
  const badge = status === 'approved' ? 'badge-brand' : status === 'pending' ? 'badge-warn' : 'badge-neutral';
  const send = a.sentAt ? (
    <button type="button" className={primary} data-testid="proposal-send" disabled title={`Sent on ${momentLabel(a.sentAt, tz)}`}>
      Proposal sent
    </button>
  ) : (
    <button type="button" className={primary} data-testid="proposal-send" disabled={busy || noProposal} title="Emailing proposals is coming soon; this marks the proposal as sent." onClick={() => run(() => markProposalSent(lead.id))}>
      Send proposal
    </button>
  );

  const note = blocked ?? detail;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: look === 'tab' ? 'flex-end' : 'stretch', gap: 6 }}>
      <div data-testid="proposal-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {lead.outcome === 'open' && (
          <>
            {status === 'not_requested' && (
              <button
                type="button"
                className={primary}
                data-testid="approval-request"
                disabled={busy || noProposal || !approverId}
                title={blocked ?? `Emails ${approver} and gives them a task to approve it.`}
                onClick={() => run(() => proposalApproval(lead.id, 'request'))}
              >
                Request approval
              </button>
            )}
            {status === 'pending' && !mayDecide && (
              <button type="button" className={primary} data-testid="approval-pending" disabled>
                Approval pending
              </button>
            )}
            {status === 'pending' && mayDecide && (
              <>
                <button type="button" className={primary} data-testid="approval-approve" disabled={busy} onClick={() => run(() => proposalApproval(lead.id, 'approve'))}>
                  Approve
                </button>
                <button type="button" className={secondary} data-testid="approval-decline" disabled={busy} onClick={() => run(() => proposalApproval(lead.id, 'decline'))}>
                  Decline
                </button>
              </>
            )}
            {status === 'approved' && mayDecide && !a.sentAt && (
              <button type="button" className={secondary} data-testid="approval-revoke" disabled={busy} onClick={() => void revoke()}>
                Revoke approval
              </button>
            )}
            {(status === 'approved' || status === 'not_required') && send}
          </>
        )}
        {status !== 'not_required' && (
          <span className={'badge ' + badge} data-testid="approval-status" title={detail}>
            {APPROVAL_LABELS[status]}
          </span>
        )}
      </div>
      {look === 'tab' && note && (
        <span data-testid="approval-note" style={{ fontSize: 12, color: blocked ? 'var(--warn)' : 'var(--text-2)', lineHeight: 1.45 }}>
          {note}
        </span>
      )}
    </div>
  );
}
