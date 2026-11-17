import { enabledModules } from '../../components/modules';
import { notificationOff } from '../../lib/account';
import { VISIT_PLANS_ENABLED } from '../../lib/features';
import { useStore } from '../../store/store';
import { Card, Note, Row, Switch } from './parts';

/**
 * Your own notification settings for this workspace (CD-16, CD-207), saved on your membership.
 * Only what the app actually sends is listed. Everyone finds them in their account (Notifications,
 * CD-525), for every role: Settings has no Notifications since CD-489. Laid out as the design's
 * G-Profile-Notifications: one glass card, a row per email (the daily digest first), and where the
 * emails go under it. A switch whose module is off in the workspace stays visible but disabled.
 */
export function NotificationsTab() {
  const { s, patchProfile } = useStore();
  const p = s.profile;
  const modules = enabledModules(s.workspace.modules);
  const rows = [
    { id: 'digest', label: 'Daily digest email', desc: `Your tasks and meetings for the day, at 8:00 ${s.workspace.timezone}.`, on: p.digest, toggle: () => patchProfile({ digest: !p.digest }) },
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
    {
      id: 'proposal-approvals',
      label: 'Proposal approvals',
      desc: "As a funnel's approver: an email when someone requests your approval of a proposal. Pending ones are in your daily digest too.",
      on: p.proposalApprovals,
      toggle: () => patchProfile({ proposalApprovals: !p.proposalApprovals }),
    },
    { id: 'task-assignments', label: 'Task assignments', desc: 'An email when someone else assigns you to a task.', on: p.taskAssigned, toggle: () => patchProfile({ taskAssigned: !p.taskAssigned }) },
    { id: 'hour-limits', label: 'Hour limit warnings', desc: 'An email when the hours on a task reach 80 % and 100 % of an hour limit.', on: p.hourLimits, toggle: () => patchProfile({ hourLimits: !p.hourLimits }) },
    { id: 'org-changes', label: 'Org changes', desc: 'An email when someone else changes who you report to, or gives you a new direct report.', on: p.orgChanges, toggle: () => patchProfile({ orgChanges: !p.orgChanges }) },
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
      desc: "As a manager or Admin: sick leave reported or ended in your team, and the Admins' weekly list of records to check.",
      on: p.sickLeaveNotices,
      toggle: () => patchProfile({ sickLeaveNotices: !p.sickLeaveNotices }),
    },
  ];
  return (
    <>
      <Card testId="notifications-card">
        {rows.map((n) => {
          const off = notificationOff(n.id, modules);
          return (
            <Row key={n.id} label={n.label} desc={n.desc} dim={off} switchRow data={{ 'data-notification': n.id, ...(off ? { 'data-off': 'true' } : {}) }}>
              <Switch on={n.on} onChange={n.toggle} label={n.label} disabled={off} />
            </Row>
          );
        })}
      </Card>
      <Note testId="notifications-foot">Emails go to {p.email || 'your sign-in address'}. These settings are yours and do not change what others get.</Note>
    </>
  );
}
