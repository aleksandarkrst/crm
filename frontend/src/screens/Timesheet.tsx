import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { askConfirm } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { usePicker } from '../components/ui';
import { addDays, type ApiLoggable, type ApiTimesheetRow, type ApiTimesheetWeek, dayLabel, dayName, shortHours, targetOf, timesheetApi, type WeekStatus } from '../lib/timesheetApi';
import { projectError } from '../store/projects';
import { useStore } from '../store/store';
import { useTimesheetWeek } from '../store/timesheet';
import { CopyDialog, skippedText } from './timesheet/CopyDialog';
import { Grid, type SaveCell } from './timesheet/Grid';

const BADGE: Record<WeekStatus, string> = {
  no_entry: 'badge-neutral',
  not_submitted: 'badge-neutral',
  draft: 'badge-neutral',
  partly_submitted: 'badge-neutral',
  submitted: 'badge-brand',
  partly_approved: 'badge-neutral',
  approved: 'badge-brand',
  rejected: 'badge-warn',
};

const listOf = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * My timesheet (CD-152, design `Timesheet.dc.html#cd-152`): the caller's week of hours on tasks and
 * work orders. The week is in the URL (`?week=<Monday>`). Every change saves at once, one at a time
 * in the order made, and the answer (the whole week) replaces what is shown, so totals always
 * match the database.
 */
export function Timesheet() {
  const { flash } = useStore();
  const [params, setParams] = useSearchParams();
  const weekParam = params.get('week') ?? undefined;
  const { data: week, error, set } = useTimesheetWeek(weekParam);
  const [copying, setCopying] = useState(false);
  const [busy, setBusy] = useState(false);
  const menu = usePicker();
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const go = (monday: string | null) => setParams(monday ? { week: monday } : {});
  /** Runs saves one after another, so an older answer never replaces a newer one. */
  const run = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(work, work);
    queue.current = next.catch(() => undefined);
    return next;
  };

  const onSave: SaveCell = (row: ApiTimesheetRow, date: string, minutes: number, note?: string | null) =>
    run(async () => {
      try {
        set(await timesheetApi.setCell(date, targetOf(row), minutes, note));
        return true;
      } catch (err) {
        flash(projectError(err));
        return false;
      }
    });

  const onAdd = (item: ApiLoggable) =>
    run(async () => {
      if (!week) return;
      try {
        set(await timesheetApi.addRow(week.weekStart, targetOf(item)));
      } catch (err) {
        flash(projectError(err));
      }
    });

  const submit = async (w: ApiTimesheetWeek) => {
    const empty = w.days.filter((d) => w.submittable.includes(d.date) && d.minutes === 0).map((d) => dayName(d.date));
    if (empty.length && !(await askConfirm({ title: `${listOf(empty)} ${empty.length === 1 ? 'has' : 'have'} no hours. Submit anyway?`, confirmLabel: 'Submit week' }))) return;
    setBusy(true);
    await run(async () => {
      try {
        set(await timesheetApi.submit(w.weekStart));
        flash(`Week ${w.weekNumber} submitted`);
      } catch (err) {
        flash(projectError(err));
      }
    });
    setBusy(false);
  };

  /** One day (Day by day mode, CD-156). */
  const submitDay = async (w: ApiTimesheetWeek, date: string) => {
    const day = w.days.find((d) => d.date === date);
    if (day && day.minutes === 0 && !(await askConfirm({ title: `${dayName(date)} has no hours. Submit anyway?`, confirmLabel: 'Submit day' }))) return;
    await run(async () => {
      try {
        set(await timesheetApi.submit(w.weekStart, date));
        flash(`${dayLabel(date)} submitted`);
      } catch (err) {
        flash(projectError(err));
      }
    });
  };

  const recall = async (w: ApiTimesheetWeek) => {
    menu.close();
    await run(async () => {
      try {
        set(await timesheetApi.recall(w.weekStart));
        flash('Submission recalled: the days are Draft again');
      } catch (err) {
        flash(projectError(err));
      }
    });
  };

  if (!week) {
    return (
      <Screen title="Timesheet">
        {error ? <EmptyState title="The timesheet could not be loaded" text={error} action={weekParam ? { label: 'This week', onClick: () => go(null) } : undefined} /> : <div className="ts-help">Loading</div>}
      </Screen>
    );
  }
  if (!week.employee) {
    return (
      <Screen title="Timesheet">
        <EmptyState title="No timesheet for you here" text="You don't have an employee record in this workspace, so there are no hours to enter. An admin can add you on the Org structure page." />
      </Screen>
    );
  }

  const deadline = `${dayLabel(week.deadline.date)}, ${week.deadline.time}`;
  const future = week.weekStart > week.thisWeek;
  return (
    <Screen title="Timesheet">
      <div className="ts-toolbar">
        <button type="button" className="btn-plain ts-arrow" aria-label="Previous week" data-testid="ts-prev" onClick={() => go(addDays(week.weekStart, -7))}>
          ←
        </button>
        <button type="button" className="btn-plain" data-testid="ts-this-week" onClick={() => go(null)} disabled={week.weekStart === week.thisWeek && !weekParam}>
          This week
        </button>
        <button type="button" className="btn-plain ts-arrow" aria-label="Next week" data-testid="ts-next" onClick={() => go(addDays(week.weekStart, 7))}>
          →
        </button>
        <span className="ts-week-label" data-testid="ts-week-label">
          {week.label}
        </span>
        <span className={`badge ${BADGE[week.status]}`} data-testid="ts-status">
          {week.statusLabel}
        </span>
        {week.late && (
          <span className="badge badge-danger" data-testid="ts-late">
            Late
          </span>
        )}
        {week.autoSubmitted && (
          <span className="badge badge-neutral" data-testid="ts-auto-submitted">
            Auto-submitted
          </span>
        )}
        {week.submittable.length > 0 && <span className="ts-due">Submit by {deadline}</span>}
        <span className="ts-spacer" style={{ flex: 1 }} />
        <button type="button" className="btn-plain" data-testid="ts-copy" onClick={() => setCopying(true)} disabled={future}>
          Copy last week
        </button>
        <div ref={menu.ref} style={{ position: 'relative' }}>
          <button type="button" className="btn-plain" aria-label="More actions" aria-expanded={menu.open} data-testid="ts-menu" onClick={() => menu.setOpen(!menu.open)}>
            ⋯
          </button>
          {menu.open && (
            <div className="deal-menu" role="menu">
              <button type="button" role="menuitem" data-testid="ts-recall" disabled={!week.canRecall} onClick={() => void recall(week)}>
                Recall submission
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="ts-submit"
          disabled={busy || week.submittable.length === 0}
          title={future ? 'A week can be submitted once it has started' : week.submittable.length === 0 ? 'Nothing to submit in this week' : undefined}
          onClick={() => void submit(week)}
        >
          {busy ? 'Submitting…' : 'Submit week'}
        </button>
      </div>
      <Grid week={week} onSave={onSave} onAdd={onAdd} onSubmitDay={week.settings.approvalMode === 'day' ? (date) => void submitDay(week, date) : undefined} />
      <div className="ts-help">Type 7.5, 7,5 or 7:30 · saved when you leave the cell · arrows and Tab move · Shift+Enter opens the note</div>
      {copying && (
        <CopyDialog
          weekStart={week.weekStart}
          maxHours={week.settings.maxDayMinutes / 60}
          onClose={() => setCopying(false)}
          onCopied={(result) => {
            setCopying(false);
            set(result.week);
            const parts = [`Copied ${result.copiedRows} ${result.copiedRows === 1 ? 'row' : 'rows'}`];
            if (result.copiedCells) parts.push(`${result.copiedCells} ${result.copiedCells === 1 ? 'day' : 'days'} of hours`);
            let message = parts.join(' and ');
            if (result.fullDays.length) message += `. Not copied on ${listOf(result.fullDays.map(dayName))}: over ${shortHours(week.settings.maxDayMinutes, week.settings.timeFormat)} h`;
            if (result.skipped.length) message += `. ${skippedText(result.skipped)}`;
            flash(message);
          }}
        />
      )}
    </Screen>
  );
}
