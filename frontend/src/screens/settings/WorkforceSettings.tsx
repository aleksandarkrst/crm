import { useEffect, useRef, useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { type DateRange, DateRangePicker, rangeText } from '../../components/DateRangePicker';
import { FieldRow, Switch } from '../../components/ui';
import type { ApiTimesheetSettings } from '../../lib/api';
import { type ApiHoliday, type ApiHolidayPreload, dayLabel, holidaysApi, parseHours, shortHours } from '../../lib/timesheetApi';
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
  { id: 'day', title: 'Day by day', text: 'Employees submit the week. Managers approve or reject each submitted day on its own.' },
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

/** The last day of the year's month that is on screen, so the picker opens on a sensible month. */
const monthIn = (year: number) => (year === new Date().getFullYear() ? new Date().toISOString().slice(0, 7) : `${year}-01`);

/** One holiday: its dates and name with a ⋯ menu (Edit, Delete), or edited inline with Cancel / Save. */
function HolidayRow({ holiday, year, onChanged }: { holiday: ApiHoliday; year: number; onChanged: () => void }) {
  const { flash } = useStore();
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ range: DateRange; name: string }>({ range: { from: holiday.date, to: holiday.endDate }, name: holiday.name });
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);
  const save = async () => {
    if (!draft.name.trim()) return flash('Enter a name');
    try {
      await holidaysApi.update(holiday.id, { date: draft.range.from, endDate: draft.range.to === draft.range.from ? null : draft.range.to, name: draft.name.trim() });
      flash(`${draft.name.trim()} saved`);
      setEditing(false);
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
  };
  const remove = async () => {
    setMenu(false);
    if (!(await askConfirm({ title: `Delete ${holiday.name}?`, message: 'It goes from every year. The Timesheet expects the standard day on these dates again.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await holidaysApi.remove(holiday.id);
      flash(`${holiday.name} deleted`);
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
  };
  if (editing) {
    return (
      <div className="holiday-row" data-testid="holiday-row">
        <DateRangePicker label="Dates" value={draft.range} month={monthIn(year)} onChange={(range) => setDraft({ ...draft, range })} testId="holiday-edit-dates" />
        <input className="form-input" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" />
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
      <span style={{ fontSize: 13 }}>{rangeText({ from: holiday.date, to: holiday.endDate })}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{holiday.name}</span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {holiday.minutes ? `${shortHours(holiday.minutes, 'decimal')} h off · ` : ''}
          {!holiday.repeats ? `${holiday.since} only` : holiday.since < year ? `every year since ${holiday.since}` : 'repeats every year'}
          {holiday.source === 'preload' ? ' · preloaded' : ''}
        </span>
      </span>
      <span ref={menuRef} style={{ position: 'relative', justifySelf: 'end' }}>
        <button type="button" className="btn btn-secondary" aria-label={`More actions for ${holiday.name}`} aria-expanded={menu} data-testid="holiday-menu" onClick={() => setMenu((m) => !m)} style={{ padding: '8px 11px' }}>
          ⋯
        </button>
        {menu && (
          <div className="deal-menu row-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              data-testid="holiday-edit"
              onClick={() => {
                setMenu(false);
                setDraft({ range: { from: holiday.date, to: holiday.endDate }, name: holiday.name });
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button type="button" role="menuitem" className="danger" data-testid="holiday-remove" onClick={() => void remove()}>
              Delete
            </button>
          </div>
        )}
      </span>
    </div>
  );
}

/**
 * Settings → Workforce → Holidays (CD-153, simplified in CD-318): the workspace's public holidays
 * by year. A holiday is a day or a span of days picked in one calendar; it repeats every year from
 * the year it was added, so nothing is copied. Owners and admins add, edit and delete them.
 */
export function HolidaysTab() {
  const { flash } = useStore();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { data, error, reload } = useProjectsRead<ApiHoliday[]>(true, () => holidaysApi.list(year), `holidays:${year}`, 'timesheetRev');
  const [draft, setDraft] = useState<{ range: DateRange | null; name: string }>({ range: null, name: '' });
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!draft.range || !draft.name.trim()) return flash('Pick the dates and enter a name');
    setBusy(true);
    try {
      const h = await holidaysApi.create({ date: draft.range.from, endDate: draft.range.to === draft.range.from ? null : draft.range.to, name: draft.name.trim() });
      flash(`${h.name} added`);
      setDraft({ range: null, name: '' });
      if (h.since === year) await reload();
      else setYear(h.since);
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(false);
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
      </div>
      <div className="holiday-row holiday-head">
        <span className="th">Dates</span>
        <span className="th">Name</span>
        <span />
      </div>
      {error && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</span>}
      {data?.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-2)', padding: '8px 0' }}>No holidays in {year} yet.</span>}
      {data?.map((h) => <HolidayRow key={`${h.id}:${h.date}:${h.endDate}:${h.name}:${h.minutes}`} holiday={h} year={year} onChanged={() => void reload()} />)}
      <div className="holiday-row" data-testid="holiday-add">
        <DateRangePicker label="Dates" value={draft.range} month={monthIn(year)} onChange={(range) => setDraft({ ...draft, range })} placeholder="Pick the dates" testId="holiday-add-dates" />
        <input className="form-input" value={draft.name} maxLength={100} placeholder="Name, e.g. Statehood Day" onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" data-testid="holiday-add-name" />
        <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void add()} data-testid="holiday-add-go">
            Add holiday
          </button>
        </span>
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>A holiday repeats every year from the year it is added; a preloaded moving day (Orthodox Easter, a moved Sunday holiday) holds in its year only. Changes are written to the audit log.</span>
      <PreloadControl year={year} onChanged={() => void reload()} />
    </div>
  );
}

/**
 * "Preload holidays for: Serbia / None" (milestone 16, spec 4.3): the country whose non-working
 * days are generated once per year (Orthodox Easter and moved Sunday holidays included), with a
 * button to generate the year on screen now. A generated year is never overwritten.
 */
function PreloadControl({ year, onChanged }: { year: number; onChanged: () => void }) {
  const { flash } = useStore();
  const { data, set } = useProjectsRead<ApiHolidayPreload>(true, () => holidaysApi.preload(), 'holidays:preload', 'timesheetRev');
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const change = async (country: 'none' | 'serbia', only?: number) => {
    setBusy(true);
    try {
      const res = await holidaysApi.setPreload({ country, ...(only ? { year: only } : {}) });
      set({ country: res.country, years: res.years });
      flash(country === 'none' ? 'Holidays are no longer preloaded' : res.added ? `${res.added} ${res.added === 1 ? 'holiday' : 'holidays'} added` : 'Nothing to add: these years were generated already');
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(false);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--divider)' }} data-testid="holiday-preload">
      <span style={{ fontSize: 13 }}>Preload holidays for</span>
      <select className="form-input" style={{ padding: '7px 10px' }} value={data.country} disabled={busy} onChange={(e) => void change(e.target.value as 'none' | 'serbia')} aria-label="Preload holidays for" data-testid="holiday-preload-country">
        <option value="serbia">Serbia</option>
        <option value="none">None</option>
      </select>
      {data.country !== 'none' && !data.years.includes(year) && (
        <button type="button" className="btn-plain" disabled={busy} onClick={() => void change(data.country, year)} data-testid="holiday-preload-year">
          Preload {year}
        </button>
      )}
      <span className="emp-note">{data.years.length ? `Generated: ${data.years.join(', ')}. Next year is added on 1 November.` : 'Nothing generated yet.'}</span>
    </div>
  );
}
