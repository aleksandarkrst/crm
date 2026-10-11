import { Modal, ModalHeader } from '../../components/ui';
import { type ApiWeekHistory, dayLabel, shortHours, type TimeFormat } from '../../lib/timesheetApi';
import { useWeekHistory } from '../../store/timesheet';
import { when } from './parts';

const EVENT_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  auto_submitted: 'Submitted automatically at the deadline',
  recalled: 'Recalled',
  approved: 'Approved',
  returned: 'Rejected',
  resubmitted: 'Resubmitted',
  unlocked: 'Unlocked',
};

/** "T-12 Inspect engine: 8 → 7.5 h", "added, 8 h", "removed". */
export function changeText(c: ApiWeekHistory['changes'][number], format: TimeFormat): string {
  if (c.action === 'created') return `${c.row}: added, ${shortHours(c.minutes, format)} h${c.note ? ` · “${c.note}”` : ''}`;
  if (c.action === 'deleted') return `${c.row}: removed (${shortHours(c.minutes, format)} h)`;
  if (c.field === 'minutes') return `${c.row}: ${shortHours(Number(c.from ?? 0), format)} → ${shortHours(Number(c.to ?? 0), format)} h`;
  if (c.field === 'note') return `${c.row}: note ${c.from ? `“${String(c.from)}”` : 'none'} → ${c.to ? `“${String(c.to)}”` : 'none'}`;
  if (c.field === 'date') return `${c.row}: moved from ${dayLabel(String(c.from))} to ${dayLabel(String(c.to))}`;
  return `${c.row}: moved to another task or work order`;
}

/** One list of what happened to the week, oldest first (spec 9.5): status events and entry changes merged by time. */
export function historyLines(h: ApiWeekHistory, format: TimeFormat, timeZone: string | undefined): { key: string; at: string; date: string; text: string; who: string }[] {
  const lines = [
    ...h.events.map((e, i) => ({ key: `e${i}`, at: e.at, date: e.date, text: `${EVENT_LABEL[e.kind] ?? e.kind}${e.comment ? `: “${e.comment}”` : ''}`, who: e.actorName ?? 'the system' })),
    ...h.changes.map((c, i) => ({ key: `c${i}`, at: c.at, date: c.date, text: changeText(c, format), who: c.actorName ?? 'the system' })),
  ];
  return lines.sort((a, b) => a.at.localeCompare(b.at)).map((l) => ({ ...l, who: `${l.who} · ${when(l.at, timeZone)}` }));
}

/** The week's History panel (CD-159, design `#cd-159` "Day history"): the employee, their approvers and Admins see the same list. */
export function HistoryPanel({ employeeId, week, weekNumber, format, timeZone, onClose }: { employeeId: string; week: string; weekNumber: number; format: TimeFormat; timeZone: string | undefined; onClose: () => void }) {
  const { data, error } = useWeekHistory(employeeId, week);
  const lines = data ? historyLines(data, format, timeZone) : [];
  return (
    <Modal maxWidth={620} onBackdrop={onClose}>
      <ModalHeader title={`History · week ${weekNumber}`} sub="Every submission, decision and change of hours, oldest first. Nobody can edit or delete it." />
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : !data ? (
        <div className="ts-help">Loading</div>
      ) : lines.length === 0 ? (
        <div className="emp-note">Nothing happened in this week yet.</div>
      ) : (
        <ul className="hist-list" data-testid="week-history">
          {lines.map((l) => (
            <li key={l.key} className="hist-line">
              <span className="hist-day">{dayLabel(l.date)}</span>
              <span className="hist-text">{l.text}</span>
              <span className="emp-note">{l.who}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" className="btn-plain" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
