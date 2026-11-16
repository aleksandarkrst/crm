import { useState } from 'react';
import { dayLabel, holidaysApi } from '../../lib/timesheetApi';
import { useProjectsRead } from '../../store/projects';
import { useTimesheetSettings } from './EmployeesPage';
import { Card, Dropdown, Note, Row, RowsModal, Section, Segmented, SummaryRow, Switch, TextField, Unit } from './parts';

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const isClock = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
/** When the reminder goes (CD-154). If a workspace has another number of hours, it is listed too. */
const REMINDER_HOURS: (number | null)[] = [null, 1, 2, 4, 8, 24];
const reminderLabel = (h: number | null) => (h === null ? 'Off' : h === 24 ? '1 day before' : `${h} ${h === 1 ? 'hour' : 'hours'} before`);
const TIME_FORMATS = [
  { value: 'decimal', label: '7.50', testId: 'time-format-decimal' },
  { value: 'clock', label: '7:30', testId: 'time-format-clock' },
] as const;
const APPROVAL_MODES = [
  { value: 'week', label: 'Whole week', testId: 'approval-mode-week', text: 'Employees submit the week. Managers approve it once every working day is submitted.' },
  { value: 'day', label: 'Day by day', testId: 'approval-mode-day', text: 'Employees submit the week. Managers approve or reject each submitted day on its own.' },
] as const;
const WEEKS = [
  { value: 'same', label: 'Same week' },
  { value: 'next', label: 'Next week' },
] as const;

/**
 * Workspace settings → Timesheet (CD-524 spec 2, design G-Settings-Timesheet): time entry, and
 * submission and approval. Not built because the app doesn't have them: notes being required,
 * locking approved weeks, and the whole Business trips section.
 */
export function TimesheetPage() {
  return (
    <>
      <TimeEntrySection />
      <ApprovalSection />
    </>
  );
}

/** Timesheet → Time entry (CD-153, CD-283): how hours show, the most a day, hours on a project itself. */
function TimeEntrySection() {
  const { t, save } = useTimesheetSettings();
  return (
    <Section title="Time entry" desc="How people log hours.">
      <Card>
        <Row label="Time format" desc="How hours show in the Timesheet, Approvals and reports. Typing either format works.">
          <Segmented label="Time format" value={t.timeFormat} options={TIME_FORMATS} onChange={(v) => save({ timeFormat: v })} testId="time-format" />
        </Row>
        <Row label="Max hours per day" desc="A day above this cannot be saved">
          <TextField label="Max hours per day" testId="max-day-hours" width={90} inputMode="numeric" value={String(t.maxDayHours)} validate={(v) => (/^\d{1,2}$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 24 ? '' : 'Between 1 and 24 hours.')} onSave={(v) => save({ maxDayHours: Number(v) })} />
          <Unit>hours</Unit>
        </Row>
        <Row label="Time on a project without a task" desc="People on a project's team, its lead and anyone with one of its tasks can log hours on the project itself." setting="project-time" switchRow>
          <Switch on={!!t.projectTime} label="Time on a project without a task" onChange={(on) => save({ projectTime: on })} />
        </Row>
      </Card>
    </Section>
  );
}

/**
 * Timesheet → Submission and approval: the approval mode (CD-156), the deadline (CD-153, a summary
 * row with a modal and a live line with the next one), auto submit, reminders and the after-deadline
 * emails (CD-154).
 */
function ApprovalSection() {
  const { t, save } = useTimesheetSettings();
  const [editing, setEditing] = useState(false);
  // The live line reads again after any settings or holiday change (the hints raise timesheetRev).
  const key = `${t.deadlineWeekday}|${t.deadlineTime}|${t.deadlineWeek}`;
  const { data: next } = useProjectsRead(true, holidaysApi.nextDeadline, `deadline:${key}`, 'timesheetRev');
  const mode = APPROVAL_MODES.find((m) => m.value === t.approvalMode) ?? APPROVAL_MODES[0];
  const reminders = REMINDER_HOURS.includes(t.reminderHours) ? REMINDER_HOURS : [...REMINDER_HOURS, t.reminderHours];
  return (
    <Section title="Submission and approval" desc="When timesheets are due and how managers approve them. Approvers find them in Approvals.">
      <Card testId="approval-mode">
        <Row label="Approve" desc={`${mode.text} Changing the mode never changes a day's status, only the actions offered from then on.`}>
          <Segmented label="Approval mode" value={t.approvalMode} options={APPROVAL_MODES} onChange={(v) => save({ approvalMode: v })} />
        </Row>
        <SummaryRow
          label="Deadline"
          desc={<span data-testid="deadline-next">{(next ? `Week ${next.weekNumber} is due ${dayLabel(next.date)}, ${next.time}. ` : '') + 'A deadline on a public holiday moves to the next working day.'}</span>}
          summary={`${WEEKDAY_NAMES[t.deadlineWeekday - 1]} at ${t.deadlineTime}, ${t.deadlineWeek === 'same' ? 'same week' : 'next week'}`}
          onEdit={() => setEditing(true)}
          testId="deadline-card"
        />
        <Row label="Auto submit at the deadline" desc="Weeks with hours and draft days are submitted and marked Late and Auto-submitted. Weeks without hours and rejected days are left alone." setting="auto-submit" switchRow>
          <Switch on={t.autoSubmit} label="Auto submit at the deadline" onChange={(on) => save({ autoSubmit: on })} />
        </Row>
        <Row label="Reminders" desc="An email before the deadline to everyone who hasn't submitted yet">
          <Dropdown label="Reminder" testId="reminder-hours" width={170} value={t.reminderHours === null ? '' : String(t.reminderHours)} options={reminders.map((h) => ({ value: h === null ? '' : String(h), label: reminderLabel(h) }))} onChange={(v) => save({ reminderHours: v ? Number(v) : null })} />
        </Row>
        <Row label="After-deadline emails" desc="At the deadline, late employees get a notice and each manager gets a list of their late people." setting="after-deadline-emails" switchRow>
          <Switch on={t.afterDeadlineEmails} label="After-deadline emails" onChange={(on) => save({ afterDeadlineEmails: on })} />
        </Row>
      </Card>
      <Note>Every change is kept in the audit log. Changing the deadline applies to the current week.</Note>
      {editing && (
        <RowsModal title="Submission deadline" desc="When people must submit their hours." onClose={() => setEditing(false)} testId="deadline-modal">
          <Row label="Day">
            <Dropdown label="Deadline day" testId="deadline-day" width={160} value={String(t.deadlineWeekday)} options={WEEKDAY_NAMES.map((n, i) => ({ value: String(i + 1), label: n }))} onChange={(v) => save({ deadlineWeekday: Number(v) })} />
          </Row>
          <Row label="Time">
            <TextField label="Deadline time" testId="deadline-time" type="time" width={130} value={t.deadlineTime} validate={(v) => (isClock(v) ? '' : 'Use a time like 17:00.')} onSave={(v) => save({ deadlineTime: v })} />
          </Row>
          <Row label="Week" desc="Same week, or the week after the hours">
            <Segmented label="Deadline week" value={t.deadlineWeek} options={WEEKS} onChange={(v) => save({ deadlineWeek: v })} testId="deadline-week" />
          </Row>
        </RowsModal>
      )}
    </Section>
  );
}
