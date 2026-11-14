import { Switch } from '../../components/ui';
import { VISIT_PLANS_ENABLED } from '../../lib/features';
import { useStore } from '../../store/store';

/**
 * Your own notification settings for this workspace (CD-16, CD-207), saved on your membership.
 * Only what the app actually sends is listed. Everyone finds them in their account (Notifications,
 * CD-525); owners and admins also in Settings → Notifications. Laid out as the design's
 * G-Profile-Notifications: one card, a row per email, and where the emails go under it.
 */
export function NotificationsTab() {
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
    // Not sent while visit plans are switched off (CD-522, lib/features.ts); the saved choice stays.
    ...(VISIT_PLANS_ENABLED ? [{ id: 'visit-plans', label: 'Visit plans', desc: 'An email when someone else creates or changes your visit plan.', on: p.visitPlans, toggle: () => patchProfile({ visitPlans: !p.visitPlans }) }] : []),
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
  return (
    <>
      <div className="card account-rows" data-testid="notifications-card">
        {rows.map((n) => (
          <div key={n.id} data-notification={n.id} className="account-row with-switch">
            <div className="account-row-text">
              <span className="account-row-label">{n.label}</span>
              <span className="account-row-hint">{n.desc}</span>
            </div>
            <div className="account-row-control">
              <Switch on={n.on} onClick={n.toggle} label={n.label} />
            </div>
          </div>
        ))}
      </div>
      <p className="account-foot">
        Emails go to {p.email || 'your sign-in address'}. These settings are yours, apply to {session.tenant.name} only and do not change what others get.
      </p>
    </>
  );
}
