import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { paths } from '../lib/paths';
import { askConfirm } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { usePicker } from '../components/ui';
import { addDays, type ApiLoggable, type ApiTimesheetRow, type ApiTimesheetWeek, dayLabel, dayName, shortHours, targetOf, timesheetApi } from '../lib/timesheetApi';
import { projectError } from '../store/projects';
import { useStore } from '../store/store';
import { useTimesheetWeek } from '../store/timesheet';
import { WEEK_BADGE as BADGE, when } from './approvals/parts';
import { CopyDialog, skippedText } from './timesheet/CopyDialog';
import { Grid, type SaveCell } from './timesheet/Grid';
import { ResubmitDialog } from './timesheet/ResubmitDialog';
import { HistoryPanel } from './approvals/HistoryPanel';

const LATE_NOTE = 'This week will be marked as submitted late.';
/** Week statuses with every required day sent: Submit week has nothing left to do. */
const SENT: ReadonlySet<ApiTimesheetWeek['status']> = new Set(['submitted', 'partly_approved', 'approved']);

/** "today", "yesterday", "3 days ago": how long ago the deadline passed. */
function sinceText(date: string, today: string): string {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

const listOf = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * My timesheet (CD-152, design `Timesheet.dc.html#cd-152`): the caller's week of hours on tasks and
 * work orders. The week is in the URL (`?week=<Monday>`). Every change saves at once, one at a time
 * in the order made, and the answer (the whole week) replaces what is shown, so totals always
 * match the database.
 */
export function Timesheet() {
  const { s, flash } = useStore();
  const [params, setParams] = useSearchParams();
  const weekParam = params.get('week') ?? undefined;
  /** An Admin entering time for someone else (CD-317): `?employee=<id>`; every call carries it. */
  const employeeParam = params.get('employee') ?? undefined;
  const { data: week, error, set } = useTimesheetWeek(weekParam, employeeParam);
  const [copying, setCopying] = useState(false);
  /** The rejected days being resubmitted (CD-158): all of them, or one in Day by day mode. */
  const [resubmitting, setResubmitting] = useState<string[] | null>(null);
  /** The week's History panel (CD-159). */
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const menu = usePicker();
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const go = (monday: string | null) => setParams({ ...(monday ? { week: monday } : {}), ...(employeeParam ? { employee: employeeParam } : {}) });
  /** Runs saves one after another, so an older answer never replaces a newer one. */
  const run = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(work, work);
    queue.current = next.catch(() => undefined);
    return next;
  };

  /**
   * Warn mode (CD-149 AC 4, TC 11): hours that take the person over their limit on a task are saved
   * only after a confirmation, then flagged. Block mode is the API's refusal, flashed like any other.
   */
  const confirmOverLimit = async (row: ApiTimesheetRow, date: string, minutes: number): Promise<boolean> => {
    if (row.kind !== 'task' || !row.limit || s.workspace.hourLimitMode === 'block' || !week) return true;
    const after = row.limit.loggedMinutes - (row.cells[date]?.minutes ?? 0) + minutes;
    if (after <= row.limit.limitMinutes || after <= row.limit.loggedMinutes) return true;
    const format = week.settings.timeFormat;
    const over = shortHours(after - row.limit.limitMinutes, format);
    const limit = shortHours(row.limit.limitMinutes, format);
    const who = employeeParam && week.employee ? { subject: week.employee.name, own: 'their' } : { subject: 'you', own: 'your' };
    return askConfirm({ title: `This puts ${who.subject} ${over} h over ${who.own} ${limit} h limit on ${row.code}. Save anyway?`, confirmLabel: 'Save anyway' });
  };

  const onSave: SaveCell = async (row: ApiTimesheetRow, date: string, minutes: number, note?: string | null) => {
    if (!(await confirmOverLimit(row, date, minutes))) return null;
    return run(async () => {
      try {
        set(await timesheetApi.setCell(date, targetOf(row), minutes, note, employeeParam));
        return true;
      } catch (err) {
        flash(projectError(err));
        return false;
      }
    });
  };

  /** The row's X (CD-354): asks first when the row has hours; the answer is the week without it. */
  const onRemove = async (row: ApiTimesheetRow) => {
    if (!week) return;
    const label = row.kind === 'project' ? `${row.path.split(' › ').pop()} · no task` : `${row.code} ${row.name}`;
    if (row.minutes > 0 && !(await askConfirm({ title: `Remove ${label} from this week?`, message: `Its ${shortHours(row.minutes, week.settings.timeFormat)} h this week are deleted too.`, confirmLabel: 'Remove', danger: true }))) return;
    await run(async () => {
      try {
        set(await timesheetApi.removeRow(week.weekStart, targetOf(row), employeeParam));
        flash(`${label} removed from the week`);
      } catch (err) {
        flash(projectError(err));
      }
    });
  };

  const onAdd = (item: ApiLoggable) =>
    run(async () => {
      if (!week) return;
      try {
        set(await timesheetApi.addRow(week.weekStart, targetOf(item), employeeParam));
      } catch (err) {
        flash(projectError(err));
      }
    });

  const submit = async (w: ApiTimesheetWeek) => {
    const empty = w.days.filter((d) => w.submittable.includes(d.date) && d.minutes === 0).map((d) => dayName(d.date));
    const late = w.lateIfSubmitted.length > 0;
    const label = late ? 'Submit late' : 'Submit week';
    if (empty.length && !(await askConfirm({ title: `${listOf(empty)} ${empty.length === 1 ? 'has' : 'have'} no hours. Submit anyway?`, message: late ? LATE_NOTE : undefined, confirmLabel: label }))) return;
    // After the deadline, submitting marks the week as submitted late (spec 5.5): say so first.
    if (late && !empty.length && !(await askConfirm({ title: `Submit week ${w.weekNumber} late?`, message: LATE_NOTE, confirmLabel: label }))) return;
    setBusy(true);
    await run(async () => {
      try {
        set(await timesheetApi.submit(w.weekStart, undefined, employeeParam));
        flash(`Week ${w.weekNumber} submitted`);
      } catch (err) {
        flash(projectError(err));
      }
    });
    setBusy(false);
  };

  /** Resubmit the rejected days (CD-158, spec 5.3 T5): all of them, or one in Day by day mode; never marks the week Late. */
  const resubmit = async (w: ApiTimesheetWeek, dates: string[], reply: string | null): Promise<string | null> => {
    const single = w.settings.approvalMode === 'day' && dates.length === 1 && w.resubmittable.length > 1 ? dates[0] : undefined;
    return run(async () => {
      try {
        set(await timesheetApi.resubmit(w.weekStart, single, reply, employeeParam));
        setResubmitting(null);
        flash(dates.length === 1 ? `${dayLabel(dates[0]!)} resubmitted` : `${dates.length} days resubmitted`);
        return null;
      } catch (err) {
        return projectError(err);
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
  /** Recall is the employee's own action (an Admin on behalf can't), and only once something is submitted. */
  const canRecall = week.canRecall && !employeeParam;
  return (
    <Screen title={employeeParam ? `${week.employee.name} · Timesheet` : 'Timesheet'} parent={employeeParam ? { label: 'Approvals', to: paths.approval(week.employee.id, week.weekStart) } : undefined}>
      {employeeParam && (
        <div className="hint-box" data-testid="ts-on-behalf" style={{ marginBottom: 14 }}>
          You are entering time on behalf of {week.employee.name}. Every change and submission is recorded in your name, and another approver must approve the days you submit.
        </div>
      )}
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
        {week.onBehalf && (
          <span className="badge badge-neutral" data-testid="ts-on-behalf-badge">
            Entered on behalf
          </span>
        )}
        {week.autoSubmitted && (
          <span className="badge badge-neutral" data-testid="ts-auto-submitted">
            Auto-submitted
          </span>
        )}
        {week.submittable.length > 0 &&
          (week.deadlinePassed ? (
            <span className="ts-due" style={{ color: 'var(--danger)' }} data-testid="ts-deadline-passed">
              Deadline passed {sinceText(week.deadline.date, week.today)}
            </span>
          ) : (
            <span className="ts-due">Submit by {deadline}</span>
          ))}
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
              {canRecall && week.submittable.length > 0 && (
                <button type="button" role="menuitem" data-testid="ts-recall" onClick={() => void recall(week)}>
                  Recall submission
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                data-testid="ts-history"
                onClick={() => {
                  menu.close();
                  setShowHistory(true);
                }}
              >
                History
              </button>
            </div>
          )}
        </div>
        {week.resubmittable.length > 0 && (
          <button type="button" className={week.submittable.length ? 'btn-plain' : 'btn btn-primary'} data-testid="ts-resubmit" disabled={busy} onClick={() => setResubmitting(week.resubmittable)}>
            Resubmit rejected days ({week.resubmittable.length})
          </button>
        )}
        {week.submittable.length > 0 ? (
          <button type="button" className="btn btn-primary" data-testid="ts-submit" disabled={busy} onClick={() => void submit(week)}>
            {busy ? 'Submitting…' : week.lateIfSubmitted.length ? 'Submit late' : 'Submit week'}
          </button>
        ) : canRecall ? (
          // Everything is submitted (CD-336): the week's action is taking it back, not submitting it again.
          <button type="button" className="btn-plain" data-testid="ts-recall-button" disabled={busy} onClick={() => void recall(week)}>
            Recall submission
          </button>
        ) : (
          !future &&
          week.resubmittable.length === 0 &&
          !SENT.has(week.status) && (
            <button type="button" className="btn btn-primary" data-testid="ts-submit" disabled title="Nothing to submit in this week">
              Submit week
            </button>
          )
        )}
      </div>
      {future && (
        <div className="ts-help" data-testid="ts-future" style={{ marginBottom: 10 }}>
          You can log time up to the current week. This week opens on {dayLabel(week.weekStart)}.
        </div>
      )}
      {week.days
        .filter((d) => d.status === 'rejected' && d.comment)
        .map((d) => (
          <div className="ts-rejected-note" key={d.date} data-testid="ts-rejected-note" data-date={d.date}>
            <div className="ts-rejected-head">
              {dayName(d.date)}
              {dayLabel(d.date).slice(3)} was rejected{d.returnedBy ? ` by ${d.returnedBy}` : ''}
              {d.returnedAt ? ` · ${when(d.returnedAt, s.workspace?.timezone)}` : ''}
            </div>
            <q>{d.comment}</q>
          </div>
        ))}
      <Grid
        week={week}
        employeeId={employeeParam}
        onSave={onSave}
        onAdd={onAdd}
        onRemove={onRemove}
        onResubmitDay={week.settings.approvalMode === 'day' ? (date) => setResubmitting([date]) : undefined}
      />
      <div className="ts-help">Type 7.5, 7,5 or 7:30 · saved when you leave the cell · arrows and Tab move · Shift+Enter opens the note</div>
      {resubmitting && <ResubmitDialog dates={resubmitting} onClose={() => setResubmitting(null)} onResubmit={(reply) => resubmit(week, resubmitting, reply)} />}
      {showHistory && (
        <HistoryPanel
          employeeId={week.employee.id}
          employeeName={week.employee.name}
          week={week.weekStart}
          weekNumber={week.weekNumber}
          format={week.settings.timeFormat}
          timeZone={s.workspace?.timezone}
          onClose={() => setShowHistory(false)}
        />
      )}
      {copying && (
        <CopyDialog
          weekStart={week.weekStart}
          employeeId={employeeParam}
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
