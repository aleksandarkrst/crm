import { useEffect, useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { FieldRow, Switch } from '../../components/ui';
import type { ApiTimesheetSettings } from '../../lib/api';
import { type ApiHoliday, dayLabel, holidaysApi, parseHours, shortHours } from '../../lib/timesheetApi';
import { projectError, useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const isClock = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
/** When the reminder goes (CD-154). If a workspace has another number of hours, it is listed too. */
const REMINDER_HOURS: (number | null)[] = [null, 1, 2, 4, 8, 24];
const reminderLabel = (h: number | null) => (h === null ? 'Off' : h === 24 ? '1 day before the deadline' : `${h} ${h === 1 ? 'hour' : 'hours'} before the deadline`);
const REMINDERS = REMINDER_HOURS.map((hours) => ({ hours, label: reminderLabel(hours) }));

/** The two approval modes (CD-156, design `#cd-156`). */
const APPROVAL_MODES: { id: 'week' | 'day'; title: string; text: string }[] = [
  { id: 'week', title: 'Whole week', text: 'Employees submit the week. Managers approve it once every working day is submitted.' },
  { id: 'day', title: 'Day by day', text: 'Employees can also submit single days. Managers approve or reject each submitted day.' },
];

/** The workspace's timesheet settings and a save that sends them whole (one write after a pause, like every workspace setting). */
function useTimesheetSettings() {
  const { s, setWorkspace } = useStore();
  const t = s.workspace.timesheet;
  return { t, save: (patch: Partial<ApiTimesheetSettings>) => setWorkspace({ timesheet: { ...t, ...patch } }) };
}

function Pill({ on, label, onClick, testId }: { on: boolean; label: string; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className={`choice-pill${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} data-testid={testId}>
      {label}
    </button>
  );
}

/**
 * Time format and Max hours per day (CD-153), in Settings → Workforce → Employees' Employees card.
 * Typing either format always works; the setting is how hours are shown.
 */
export function TimeFormatAndMax() {
  const { t, save } = useTimesheetSettings();
  const [max, setMax] = useState(String(t.maxDayHours));
  const [seen, setSeen] = useState(t.maxDayHours);
  if (seen !== t.maxDayHours) {
    setSeen(t.maxDayHours);
    setMax(String(t.maxDayHours));
  }
  const n = Number(max);
  const valid = /^\d{1,2}$/.test(max) && n >= 1 && n <= 24;
  return (
    <>
      <FieldRow label="Time format">
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="time-format">
            <Pill on={t.timeFormat === 'decimal'} label="7.50" onClick={() => save({ timeFormat: 'decimal' })} testId="time-format-decimal" />
            <Pill on={t.timeFormat === 'clock'} label="7:30" onClick={() => save({ timeFormat: 'clock' })} testId="time-format-clock" />
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>How hours are shown in the Timesheet, Approvals and reports. Typing either format works.</span>
        </span>
      </FieldRow>
      <FieldRow label="Max hours per day">
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <input
            className="form-input"
            inputMode="numeric"
            aria-label="Max hours per day"
            data-testid="max-day-hours"
            value={max}
            style={{ maxWidth: 120, borderColor: valid ? undefined : 'var(--danger)' }}
            onChange={(e) => {
              const next = e.target.value.replace(/[^\d]/g, '').slice(0, 2);
              setMax(next);
              const v = Number(next);
              if (/^\d{1,2}$/.test(next) && v >= 1 && v <= 24) {
                setSeen(v);
                save({ maxDayHours: v });
              }
            }}
            onBlur={() => !valid && setMax(String(t.maxDayHours))}
          />
          <span style={{ fontSize: 12, color: valid ? 'var(--text-2)' : 'var(--danger)' }}>{valid ? 'Entries above this on one day are refused.' : 'Between 1 and 24 hours.'}</span>
        </span>
      </FieldRow>
    </>
  );
}

/** A "HH:MM" field saved once it is a time; anything else goes back on leaving. */
function ClockField({ label, value, onSave, testId }: { label: string; value: string; onSave: (v: string) => void; testId: string }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  return (
    <label className="form-label">
      {label}
      <input
        className="form-input"
        type="time"
        step={900}
        value={text}
        data-testid={testId}
        style={{ width: 130, borderColor: isClock(text) ? undefined : 'var(--danger)' }}
        onChange={(e) => {
          setText(e.target.value);
          if (isClock(e.target.value) && e.target.value !== value) {
            setSeen(e.target.value);
            onSave(e.target.value);
          }
        }}
        onBlur={() => !isClock(text) && setText(value)}
      />
    </label>
  );
}

/** The Standard working day card (CD-153): hours per day, start, end and the working days. */
export function WorkingDayCard() {
  const { t, save } = useTimesheetSettings();
  const [hours, setHours] = useState(shortHours(t.dayMinutes, 'decimal'));
  const [seen, setSeen] = useState(t.dayMinutes);
  if (seen !== t.dayMinutes) {
    setSeen(t.dayMinutes);
    setHours(shortHours(t.dayMinutes, 'decimal'));
  }
  const minutes = parseHours(hours);
  const valid = minutes !== null && minutes >= 15 && minutes <= 1440;
  const toggleDay = (d: number) => {
    const next = t.workingDays.includes(d) ? t.workingDays.filter((x) => x !== d) : [...t.workingDays, d].sort((a, b) => a - b);
    if (next.length) save({ workingDays: next });
  };
  const endBeforeStart = t.dayEnd <= t.dayStart;
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="working-day">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="card-title">Standard working day</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>The day every employee is expected to work. Drives expected hours in the Timesheet and the hours of time off.</span>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label className="form-label">
          Hours per day
          <input
            className="form-input"
            inputMode="decimal"
            value={hours}
            data-testid="day-hours"
            style={{ width: 120, borderColor: valid ? undefined : 'var(--danger)' }}
            onChange={(e) => {
              setHours(e.target.value);
              const m = parseHours(e.target.value);
              if (m !== null && m >= 15 && m <= 1440 && m !== t.dayMinutes) {
                setSeen(m);
                save({ dayMinutes: m });
              }
            }}
            onBlur={() => !valid && setHours(shortHours(t.dayMinutes, 'decimal'))}
          />
        </label>
        <ClockField label="Start" value={t.dayStart} onSave={(v) => save({ dayStart: v })} testId="day-start" />
        <ClockField label="End" value={t.dayEnd} onSave={(v) => save({ dayEnd: v })} testId="day-end" />
      </div>
      {endBeforeStart && <span style={{ fontSize: 12, color: 'var(--danger)' }}>The working day must end after it starts.</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Working days</span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="working-days">
          {WEEKDAYS.map((label, i) => (
            <Pill key={label} on={t.workingDays.includes(i + 1)} label={label} onClick={() => toggleDay(i + 1)} />
          ))}
        </span>
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Approved days keep the hours they had when they were approved.</span>
    </div>
  );
}

/**
 * Settings → Workforce → Approvals: the approval mode (CD-156), the submission deadline (day, time,
 * same or next week; a live line with the next one) and auto submit (CD-153), and the reminders
 * (CD-154: when the reminder goes, and the after-deadline emails).
 */
export function ApprovalsTab() {
  const { t, save } = useTimesheetSettings();
  // The live line reads again after any settings or holiday change (the workspace and holiday hints raise timesheetRev).
  const key = `${t.deadlineWeekday}|${t.deadlineTime}|${t.deadlineWeek}`;
  const { data: next } = useProjectsRead(true, holidaysApi.nextDeadline, `deadline:${key}`, 'timesheetRev');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="approval-mode">
        <span className="card-title">Approval mode</span>
        {APPROVAL_MODES.map((m) => (
          <label key={m.id} className={`ts-choice${t.approvalMode === m.id ? ' on' : ''}`} data-testid={`approval-mode-${m.id}`}>
            <input type="radio" name="approval-mode" checked={t.approvalMode === m.id} onChange={() => save({ approvalMode: m.id })} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
            <span className="ts-radio" aria-hidden />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{m.title}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{m.text}</span>
            </span>
          </label>
        ))}
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Changing the mode never changes a day's status, only the actions offered from then on.</span>
      </div>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="deadline-card">
        <span className="card-title">Submission deadline</span>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="form-label">
            Day
            <select className="form-input" value={t.deadlineWeekday} data-testid="deadline-day" style={{ width: 160 }} onChange={(e) => save({ deadlineWeekday: Number(e.target.value) })}>
              {WEEKDAY_NAMES.map((n, i) => (
                <option key={n} value={i + 1}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <ClockField label="Time" value={t.deadlineTime} onSave={(v) => save({ deadlineTime: v })} testId="deadline-time" />
          <label className="form-label">
            Week
            <select className="form-input" value={t.deadlineWeek} data-testid="deadline-week" style={{ width: 160 }} onChange={(e) => save({ deadlineWeek: e.target.value as 'same' | 'next' })}>
              <option value="same">Same week</option>
              <option value="next">Next week</option>
            </select>
          </label>
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }} data-testid="deadline-next">
          {next ? `Week ${next.weekNumber} is due ${dayLabel(next.date)}, ${next.time}. ` : ''}A deadline on a public holiday moves to the next working day.
        </span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0 0', borderTop: '1px solid var(--divider)' }} data-setting="auto-submit">
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Auto submit at the deadline</span>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Weeks with hours and draft days are submitted and marked Late and Auto-submitted. Weeks without hours and rejected days are left alone.</span>
          </span>
          <Switch on={t.autoSubmit} onClick={() => save({ autoSubmit: !t.autoSubmit })} label="Auto submit at the deadline" />
        </div>
      </div>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="reminders-card">
        <span className="card-title">Reminders</span>
        <FieldRow label="Reminder">
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
            <select
              className="form-input"
              value={t.reminderHours ?? ''}
              data-testid="reminder-hours"
              style={{ width: 260 }}
              onChange={(e) => save({ reminderHours: e.target.value ? Number(e.target.value) : null })}
            >
              {(REMINDER_HOURS.includes(t.reminderHours) ? REMINDERS : [...REMINDERS, { hours: t.reminderHours, label: reminderLabel(t.reminderHours) }]).map((r) => (
                <option key={r.label} value={r.hours ?? ''}>
                  {r.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Sent to everyone who hasn't submitted yet.</span>
          </span>
        </FieldRow>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0 0', borderTop: '1px solid var(--divider)' }} data-setting="after-deadline-emails">
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>After-deadline emails</span>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>At the deadline, late employees get a notice and each manager gets a list of their late people.</span>
          </span>
          <Switch on={t.afterDeadlineEmails} onClick={() => save({ afterDeadlineEmails: !t.afterDeadlineEmails })} label="After-deadline emails" />
        </div>
      </div>
      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Changes are saved as you make them and written to the audit log. Changing the deadline applies to the current week.</span>
    </div>
  );
}

/** One holiday: shown, or edited inline (date, name, whole day or hours) with Cancel / Save. */
function HolidayRow({ holiday, onChanged }: { holiday: ApiHoliday; onChanged: () => void }) {
  const { flash } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ date: holiday.date, name: holiday.name, hours: holiday.minutes ? shortHours(holiday.minutes, 'decimal') : '' });
  const save = async () => {
    const minutes = draft.hours.trim() ? parseHours(draft.hours) : null;
    if (draft.hours.trim() && !minutes) return flash('Type the hours off, like 4 or 4.5, or leave it empty for the whole day');
    try {
      await holidaysApi.update(holiday.id, { date: draft.date, name: draft.name.trim(), minutes });
      flash(`${draft.name.trim()} saved`);
      setEditing(false);
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
  };
  const remove = async () => {
    if (!(await askConfirm({ title: `Remove ${holiday.name}?`, message: 'The Timesheet expects the standard day on this date again.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      await holidaysApi.remove(holiday.id);
      flash(`${holiday.name} removed`);
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
  };
  if (editing) {
    return (
      <div className="holiday-row" data-testid="holiday-row">
        <input className="form-input" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="Date" />
        <input className="form-input" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" />
        <input className="form-input" value={draft.hours} inputMode="decimal" placeholder="Whole day" onChange={(e) => setDraft({ ...draft, hours: e.target.value })} aria-label="Hours off" />
        <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-plain" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} data-testid="holiday-save">
            Save
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="holiday-row" data-testid="holiday-row" data-date={holiday.date}>
      <span style={{ fontSize: 13 }}>{dayLabel(holiday.date)}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{holiday.name}</span>
      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{holiday.minutes ? `${shortHours(holiday.minutes, 'decimal')} h` : 'Whole day'}</span>
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="btn-outline" onClick={() => setEditing(true)} data-testid="holiday-edit">
          Edit
        </button>
        <button type="button" className="btn-outline" onClick={() => void remove()} data-testid="holiday-remove">
          Remove
        </button>
      </span>
    </div>
  );
}

/**
 * Settings → Workforce → Holidays (CD-153): the workspace's public holidays by year, added, edited
 * and removed here (owners and admins); Copy from last year for holidays on fixed dates.
 */
export function HolidaysTab() {
  const { flash } = useStore();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { data, error, reload } = useProjectsRead<ApiHoliday[]>(true, () => holidaysApi.list(year), `holidays:${year}`, 'timesheetRev');
  const [draft, setDraft] = useState({ date: '', name: '', hours: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft((d) => ({ ...d, date: '' })), [year]);
  const add = async () => {
    if (!draft.date || !draft.name.trim()) return flash('Enter a date and a name');
    const minutes = draft.hours.trim() ? parseHours(draft.hours) : null;
    if (draft.hours.trim() && !minutes) return flash('Type the hours off, like 4 or 4.5, or leave it empty for the whole day');
    setBusy(true);
    try {
      const h = await holidaysApi.create({ date: draft.date, name: draft.name.trim(), minutes });
      flash(`${h.name} added`);
      setDraft({ date: '', name: '', hours: '' });
      if (h.date.startsWith(String(year))) await reload();
      else setYear(Number(h.date.slice(0, 4)));
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(false);
  };
  const copy = async () => {
    try {
      const res = await holidaysApi.copyFromLastYear(year);
      flash(res.copied ? `Copied ${res.copied} ${res.copied === 1 ? 'holiday' : 'holidays'} from ${year - 1}` : `Nothing to copy: ${year} already has every date ${year - 1} had`);
      await reload();
    } catch (err) {
      flash(projectError(err));
    }
  };
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="holidays">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn-plain" style={{ padding: '7px 10px' }} aria-label="Previous year" onClick={() => setYear(year - 1)}>
          ←
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, minWidth: 48, textAlign: 'center' }} data-testid="holidays-year">
          {year}
        </span>
        <button type="button" className="btn-plain" style={{ padding: '7px 10px' }} aria-label="Next year" onClick={() => setYear(year + 1)}>
          →
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn-plain" onClick={() => void copy()} data-testid="holidays-copy">
          Copy from last year
        </button>
      </div>
      <div className="holiday-row holiday-head">
        <span className="th">Date</span>
        <span className="th">Name</span>
        <span className="th">Hours off</span>
        <span />
      </div>
      {error && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</span>}
      {data?.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-2)', padding: '8px 0' }}>No holidays in {year} yet.</span>}
      {data?.map((h) => <HolidayRow key={`${h.id}:${h.date}:${h.name}:${h.minutes}`} holiday={h} onChanged={() => void reload()} />)}
      <div className="holiday-row" data-testid="holiday-add">
        <input className="form-input" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="Date" data-testid="holiday-add-date" />
        <input className="form-input" value={draft.name} maxLength={100} placeholder="Name, e.g. Statehood Day" onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" data-testid="holiday-add-name" />
        <input className="form-input" value={draft.hours} inputMode="decimal" placeholder="Whole day" onChange={(e) => setDraft({ ...draft, hours: e.target.value })} aria-label="Hours off" data-testid="holiday-add-hours" />
        <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void add()} data-testid="holiday-add-go">
            Add holiday
          </button>
        </span>
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Leave Hours off empty for the whole standard day. Changes are written to the audit log.</span>
    </div>
  );
}
