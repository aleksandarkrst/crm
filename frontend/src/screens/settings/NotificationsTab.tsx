import { Switch } from '../../components/ui';
import { useStore } from '../../store/store';

/**
 * Your own notification settings for this workspace (CD-16, CD-207), saved on your membership.
 * Only what the app actually sends is listed. Owners and admins find them in Settings →
 * Notifications; members, who don't see the workspace settings (CD-523), find them on Personal
 * preferences, where the card has a `title` and the `#notifications` anchor.
 */
export function NotificationsTab({ title }: { title?: string }) {
  const { s, session, patchProfile } = useStore();
  const p = s.profile;
  const rows = [
    {
      id: 'digest',
      label: 'Daily digest email',
      desc: `Every morning at 8:00 (${s.workspace.timezone}): your overdue tasks, tasks due today, your open opportunities with no next step and the ones late in a stage you answer for. Not sent when there is nothing to report.`,
      on: p.digest,
      toggle: () => patchProfile({ digest: !p.digest }),
    },
    { id: 'assigned', label: 'Opportunity assigned to you', desc: 'An email when someone else makes you the owner of an opportunity.', on: p.dealAssigned, toggle: () => patchProfile({ dealAssigned: !p.dealAssigned }) },
    {
      id: 'meetings',
      label: 'Meeting invitations',
      desc: "An email with a calendar file when someone else adds you to a meeting, or changes or cancels one you're in.",
      on: p.meetingInvites,
      toggle: () => patchProfile({ meetingInvites: !p.meetingInvites }),
    },
    { id: 'visit-plans', label: 'Visit plans', desc: 'An email when someone else creates or changes your visit plan.', on: p.visitPlans, toggle: () => patchProfile({ visitPlans: !p.visitPlans }) },
    { id: 'task-assignments', label: 'Task assignments', desc: 'An email when someone else assigns you to a task.', on: p.taskAssigned, toggle: () => patchProfile({ taskAssigned: !p.taskAssigned }) },
    {
      id: 'hour-limits',
      label: 'Hour limit warnings',
      desc: 'An email when the hours on a task reach 80 % and 100 % of an hour limit.',
      on: p.hourLimits,
      toggle: () => patchProfile({ hourLimits: !p.hourLimits }),
    },
    {
      id: 'proposal-approvals',
      label: 'Proposal approvals',
      desc: "As a funnel's approver: an email when someone requests your approval of a proposal. Pending ones are in your daily digest too.",
      on: p.proposalApprovals,
      toggle: () => patchProfile({ proposalApprovals: !p.proposalApprovals }),
    },
    {
      id: 'org-changes',
      label: 'Org changes',
      desc: 'An email when someone else changes who you report to, or gives you a new direct report.',
      on: p.orgChanges,
      toggle: () => patchProfile({ orgChanges: !p.orgChanges }),
    },
    {
      id: 'timeoff-balance',
      label: 'Time off balance',
      desc: 'An email when someone adjusts your vacation balance, and on 1 May and 1 June when carried-over days are about to expire.',
      on: p.timeOffBalance,
      toggle: () => patchProfile({ timeOffBalance: !p.timeOffBalance }),
    },
    {
      id: 'timeoff-approvals',
      label: 'Approval reminders',
      desc: 'As an approver: a daily summary of time off requests waiting for you, and a note when one is withdrawn.',
      on: p.timeOffApprovals,
      toggle: () => patchProfile({ timeOffApprovals: !p.timeOffApprovals }),
    },
    {
      id: 'sick-leave',
      label: 'Sick leave notices',
      desc: 'As a manager or Admin: sick leave reported or ended in your team, and the Admins\' weekly list of records to check.',
      on: p.sickLeaveNotices,
      toggle: () => patchProfile({ sickLeaveNotices: !p.sickLeaveNotices }),
    },
  ];
  const row = { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--divider)' } as const;
  return (
    <div className="card card-pad" id={title ? 'notifications' : undefined} data-testid="notifications-card" style={{ display: 'flex', flexDirection: 'column', scrollMarginTop: 72 }}>
      {title && <div className="card-title">{title}</div>}
      {rows.map((n) => (
        <div key={n.id} data-notification={n.id} style={row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{n.label}</span>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{n.desc}</span>
          </div>
          <Switch on={n.on} onClick={n.toggle} label={n.label} />
        </div>
      ))}
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 12 }}>
        Emails go to {p.email || 'your sign-in address'}. These settings are yours and apply to {session.tenant.name} only; changes are saved as you make them.
      </span>
    </div>
  );
}
