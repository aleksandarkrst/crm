import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ChangeHistory } from '../components/ChangeHistory';
import { Screen } from '../components/Layout';
import { Picker, PickerRow, RemoveButton, usePicker } from '../components/ui';
import { type ApiVisitPlanProgress, crmApi } from '../lib/api';
import { datedName, downloadText, toCsv } from '../lib/csv';
import { paths } from '../lib/paths';
import { VisitPlanDialog, type PlanDraft } from '../modals/VisitPlanDialog';
import { companyRecords, curOf, initialsOf, memberName } from '../store/selectors';
import { useStore } from '../store/store';
import { dateLabel, instantToZoned, todayIn } from '../store/time';
import { useVisitProgress } from '../store/useVisitProgress';
import { completionLabel, paceOf, shiftPeriod, type VisitCount, visitsInCalendar } from '../store/visitPlans';

const COLS = 'minmax(0,2fr) 0.8fr 0.7fr 0.8fr 0.8fr minmax(150px,auto)';
const COUNT_LABEL: Record<VisitCount, string> = { held: 'Held visits', upcoming: 'Upcoming visits', notClosed: 'Not closed visits' };

/** A number of visits that opens the meetings behind it (0 is plain text). */
function CountButton({ n, open, onClick, testId, label }: { n: number | undefined; open: boolean; onClick: () => void; testId: string; label: string }) {
  if (n === undefined) return <span style={{ color: 'var(--muted)' }}>…</span>;
  if (n === 0)
    return (
      <span data-testid={testId} style={{ color: 'var(--muted)' }}>
        0
      </span>
    );
  return (
    <button type="button" className={open ? 'vp-count open' : 'vp-count'} data-testid={testId} aria-expanded={open} aria-label={`${n} ${label.toLowerCase()}`} onClick={onClick}>
      {n}
    </button>
  );
}

/** The meetings behind a number: links to their pages, and the same list in the Calendar. */
function MeetingsBehind({ title, ids, progress, calendar, tz }: { title: string; ids: string[]; progress: ApiVisitPlanProgress; calendar: string; tz: string }) {
  return (
    <div className="vp-drill" data-testid="visit-plan-drill">
      <div className="vp-drill-head">
        <span className="caps-muted">{title}</span>
        <Link to={calendar} className="crumb-link" data-testid="visit-plan-drill-calendar">
          Open in Calendar
        </Link>
      </div>
      {ids.map((id) => {
        const m = progress.meetings[id];
        if (!m) return null;
        const at = instantToZoned(m.startsAt, tz);
        return (
          <Link key={id} to={paths.meeting(id)} className="vp-drill-row" data-testid="visit-plan-drill-meeting">
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
            <span style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
              {dateLabel(at.date)} · {at.time}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Planned visits of one customer, 1–99. A number is saved as it is typed; an emptied or invalid
 * field isn't, and goes back to the saved number when it loses focus.
 */
function PlannedInput({ company, value, onChange }: { company: string; value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  // A change from elsewhere (a live update, a failed save put back) shows; typing isn't interrupted.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (Number(text) !== value) setText(String(value));
  }
  const valid = /^\d{1,2}$/.test(text) && Number(text) >= 1;
  return (
    <input
      className="form-input vp-visits-input"
      inputMode="numeric"
      aria-label={`Planned visits at ${company}`}
      data-testid="visit-plan-planned"
      value={text}
      style={{ borderColor: valid ? undefined : 'var(--danger)' }}
      onChange={(e) => {
        const next = e.target.value.replace(/[^\d]/g, '').slice(0, 2);
        setText(next);
        if (/^\d{1,2}$/.test(next) && Number(next) >= 1 && Number(next) !== value) onChange(Number(next));
      }}
      onBlur={() => !valid && setText(String(value))}
    />
  );
}

/**
 * One visit plan (CD-134): its customers with the planned visits, the note and the change history.
 * Owners and admins change it in place (add a customer, change a number, remove one; saved as you
 * go), copy it to the next period and delete it. "Schedule visit" opens New meeting with the company, Customer visit and the
 * salesperson as organizer. Members see their own plans read-only and
 * schedule visits from them. Visit tracking (CD-135): per customer the visits held, upcoming and
 * not closed (each number opens its meetings), "+N over plan", completion, and the visits held at
 * customers outside the plan; counted by the API and recounted live when a visit changes.
 * Owners and admins export it as CSV.
 */
export function VisitPlan() {
  const store = useStore();
  const { s, canDelete: canManage } = store;
  const { id = '' } = useParams();
  const picker = usePicker();
  const [copying, setCopying] = useState<Partial<PlanDraft> | null>(null);
  const [drill, setDrill] = useState<string | null>(null);
  const plan = s.visitPlans.find((p) => p.id === id);
  const { data: progress } = useVisitProgress(plan ? 'plan:' + plan.id : null, () => crmApi.visitPlanProgress(id));
  if (!plan) return <Navigate to={paths.visitPlans} replace />;
  const tz = s.workspace.timezone;
  const today = todayIn(tz);
  const lineOf = (companyId: string) => progress?.lines.find((l) => l.companyId === companyId);
  const totals = progress?.totals;
  const toggle = (key: string) => setDrill((d) => (d === key ? null : key));
  const calendarFor = (kind: VisitCount, companyId: string) => visitsInCalendar(kind, plan, { userId: plan.salespersonUserId, companyId }, today);
  const drillFor = (companyId: string) => {
    const line = lineOf(companyId);
    const kind = (['held', 'upcoming', 'notClosed'] as const).find((k) => drill === `${companyId}:${k}`);
    if (!progress || !line || !kind) return null;
    const ids = kind === 'held' ? line.heldMeetingIds : kind === 'upcoming' ? line.upcomingMeetingIds : line.notClosedMeetingIds;
    return <MeetingsBehind title={COUNT_LABEL[kind]} ids={ids} progress={progress} calendar={calendarFor(kind, companyId)} tz={tz} />;
  };
  const exportCsv = () => {
    if (!progress) return;
    const rows = [
      ...progress.lines.map((l) => ({
        company: l.companyName,
        planned: l.planned,
        held: l.held,
        counted: l.heldCapped,
        over: l.overPlan,
        upcoming: l.upcoming,
        notClosed: l.notClosed,
        completion: completionLabel(l.completion),
      })),
      ...progress.unplanned.map((u) => ({ company: `${u.companyName} (unplanned)`, planned: 0, held: u.held, counted: 0, over: 0, upcoming: 0, notClosed: 0, completion: '' })),
      {
        company: 'Total',
        planned: progress.totals.planned,
        held: progress.totals.held,
        counted: progress.totals.heldCapped,
        over: progress.totals.overPlan,
        upcoming: progress.totals.upcoming,
        notClosed: progress.totals.notClosed,
        completion: completionLabel(progress.totals.completion),
      },
    ];
    type Row = (typeof rows)[number];
    const csv = toCsv<Row>(rows, [
      { header: 'Customer', value: (r) => r.company },
      { header: 'Planned visits', value: (r) => r.planned },
      { header: 'Held visits', value: (r) => r.held },
      { header: 'Held, counted toward the plan', value: (r) => r.counted },
      { header: 'Over plan', value: (r) => r.over },
      { header: 'Upcoming', value: (r) => r.upcoming },
      { header: 'Not closed', value: (r) => r.notClosed },
      { header: 'Visit-plan completion', value: (r) => r.completion },
    ]);
    downloadText(datedName(`visit-plan-${plan.periodStart}`), csv);
  };

  const salesperson = memberName(s, plan.salespersonUserId, plan.salespersonName);
  const lines = plan.lines.map((l) => ({ companyId: l.companyId, plannedVisits: l.plannedVisits }));
  const chosen = new Set(lines.map((l) => l.companyId));
  const q = picker.search.trim().toLowerCase();
  const available = companyRecords(s)
    .filter((c) => !chosen.has(c.id) && (!q || c.name.toLowerCase().includes(q)))
    .slice(0, 50);

  const setVisits = (companyId: string, n: number) =>
    store.setPlanLines(
      plan.id,
      lines.map((l) => (l.companyId === companyId ? { ...l, plannedVisits: n } : l)),
    );
  const removeLine = (companyId: string, name: string) => {
    if (lines.length === 1) return store.flash('A plan needs at least one customer. Delete the plan instead.');
    if (!window.confirm(`Remove ${name} from this plan? Meetings with ${name} are kept.`)) return;
    store.setPlanLines(
      plan.id,
      lines.filter((l) => l.companyId !== companyId),
    );
  };
  const onDelete = () => {
    if (window.confirm(`Delete the visit plan of ${salesperson} for ${plan.periodLabel}? Meetings are kept.`)) void store.deleteVisitPlan(plan.id);
  };
  const copyToNext = () =>
    setCopying({
      salespersonUserId: plan.salespersonUserId,
      periodType: plan.periodType,
      periodStart: shiftPeriod(plan.periodType, plan.periodStart, 1),
      note: plan.note ?? '',
      lines: plan.lines.map((l) => ({ companyId: l.companyId, plannedVisits: String(l.plannedVisits) })),
    });

  return (
    <Screen title="Visit plan" parent={{ label: 'Visit plans', to: paths.visitPlans }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="card deal-header" style={{ padding: '16px 20px' }}>
          <div className="deal-header-top">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 260px' }}>
              <span className="display" data-testid="visit-plan-period" style={{ fontSize: 22, lineHeight: 1.2 }}>
                {plan.periodLabel}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                <span data-testid="visit-plan-salesperson">{salesperson}</span> · {plan.periodType === 'month' ? 'Monthly plan' : 'Quarterly plan'} ·{' '}
                <span data-testid="visit-plan-summary">
                  {plan.totalPlanned === 1 ? '1 visit' : `${plan.totalPlanned} visits`} at {plan.lines.length === 1 ? '1 customer' : `${plan.lines.length} customers`}
                </span>
              </span>
              {totals && (
                <span style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className={paceOf(totals).className} title={paceOf(totals).title} data-testid="visit-plan-completion" data-pace={totals.pace}>
                    {completionLabel(totals.completion)}
                  </span>
                  <span data-testid="visit-plan-progress">
                    {totals.heldCapped} of {totals.planned} planned visits held
                    {totals.overPlan > 0 ? ` · +${totals.overPlan} over plan` : ''}
                  </span>
                </span>
              )}
            </div>
            {canManage && (
              <div className="deal-actions">
                <button type="button" className="btn btn-secondary" data-testid="visit-plan-export" disabled={!progress} onClick={exportCsv}>
                  Export CSV
                </button>
                <button type="button" className="btn btn-secondary" data-testid="visit-plan-copy-next" onClick={copyToNext}>
                  Copy to next period
                </button>
                <button type="button" className="btn btn-secondary" data-testid="visit-plan-delete" style={{ color: 'var(--danger)' }} onClick={onDelete}>
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <div style={{ flex: '999 1 520px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="card vp-plan" data-testid="visit-plan-lines">
              <div className="table-head vp-plan-head" style={{ gridTemplateColumns: COLS }}>
                {['Customer', 'Planned', 'Held', 'Upcoming', 'Not closed', ''].map((h, i) => (
                  <span key={i} className="th">
                    {h}
                  </span>
                ))}
              </div>
              {plan.lines.map((l) => {
                const p = lineOf(l.companyId);
                return (
                  <div key={l.companyId} className="vp-plan-line">
                    <div className="table-row vp-plan-row" data-testid="visit-plan-line" style={{ gridTemplateColumns: COLS, alignItems: 'center' }}>
                      <Link
                        to={paths.company(l.companyId)}
                        className="vp-plan-company"
                        style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--brand)', textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {l.companyName}
                      </Link>
                      <span className="vp-cell" data-label="Planned">
                        {canManage ? (
                          <PlannedInput company={l.companyName} value={l.plannedVisits} onChange={(n) => setVisits(l.companyId, n)} />
                        ) : (
                          <span data-testid="visit-plan-planned" style={{ fontSize: 13.5 }}>
                            {l.plannedVisits}
                          </span>
                        )}
                      </span>
                      <span className="vp-cell" data-label="Held" style={{ fontSize: 13.5 }}>
                        <CountButton n={p?.held} label="Held visits" testId="visit-plan-held" open={drill === `${l.companyId}:held`} onClick={() => toggle(`${l.companyId}:held`)} />
                        {!!p?.overPlan && (
                          <span className="vp-over" data-testid="visit-plan-over" title="Visits beyond the plan don't make up for another customer">
                            {' '}
                            +{p.overPlan} over plan
                          </span>
                        )}
                      </span>
                      <span className="vp-cell" data-label="Upcoming" style={{ fontSize: 13.5 }}>
                        <CountButton
                          n={p?.upcoming}
                          label="Upcoming visits"
                          testId="visit-plan-upcoming"
                          open={drill === `${l.companyId}:upcoming`}
                          onClick={() => toggle(`${l.companyId}:upcoming`)}
                        />
                      </span>
                      <span className="vp-cell" data-label="Not closed" style={{ fontSize: 13.5 }}>
                        <CountButton
                          n={p?.notClosed}
                          label="Not closed visits"
                          testId="visit-plan-not-closed"
                          open={drill === `${l.companyId}:notClosed`}
                          onClick={() => toggle(`${l.companyId}:notClosed`)}
                        />
                      </span>
                      <span className="vp-plan-actions">
                        <button
                          type="button"
                          className="btn-outline"
                          data-testid="visit-plan-schedule"
                          onClick={() => store.meetings.openDialog({ companyId: l.companyId, type: 'visit', organizerUserId: plan.salespersonUserId })}
                        >
                          Schedule visit
                        </button>
                        {canManage && <RemoveButton title={`Remove ${l.companyName}`} onClick={() => removeLine(l.companyId, l.companyName)} />}
                      </span>
                    </div>
                    {drillFor(l.companyId)}
                  </div>
                );
              })}
              <div className="table-row vp-plan-row vp-plan-total" style={{ gridTemplateColumns: COLS, alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Total</span>
                <span className="vp-cell" data-label="Planned" style={{ fontSize: 13.5, fontWeight: 600 }} data-testid="visit-plan-total">
                  {plan.totalPlanned}
                </span>
                <span
                  className="vp-cell"
                  data-label="Held"
                  style={{ fontSize: 13.5, fontWeight: 600 }}
                  data-testid="visit-plan-total-held"
                  title="Held visits counted toward the plan (at most the planned number per customer)"
                >
                  {totals ? totals.heldCapped : '…'}
                  {!!totals?.overPlan && <span className="vp-over"> +{totals.overPlan} over plan</span>}
                </span>
                <span className="vp-cell" data-label="Upcoming" style={{ fontSize: 13.5, fontWeight: 600 }} data-testid="visit-plan-total-upcoming">
                  {totals ? totals.upcoming : '…'}
                </span>
                <span className="vp-cell" data-label="Not closed" style={{ fontSize: 13.5, fontWeight: 600 }} data-testid="visit-plan-total-not-closed">
                  {totals ? totals.notClosed : '…'}
                </span>
                <span />
              </div>
              {canManage && (
                <div className="vp-plan-add" data-testid="visit-plan-add">
                  <Picker
                    picker={picker}
                    placeholder="+ Add customer"
                    items={
                      available.length ? (
                        available.map((c) => (
                          <PickerRow
                            key={c.id}
                            square
                            initials={initialsOf(c.name)}
                            title={c.name}
                            subtitle={c.hq && c.hq !== '—' ? c.hq : ''}
                            onPick={() => {
                              store.setPlanLines(plan.id, [...lines, { companyId: c.id, plannedVisits: 1 }]);
                              picker.close();
                            }}
                          />
                        ))
                      ) : (
                        <div style={{ padding: 8, fontSize: 12.5, color: 'var(--muted)' }}>No more companies.</div>
                      )
                    }
                  />
                </div>
              )}
            </div>
            {progress && progress.unplanned.length > 0 && (
              <div className="card card-pad" data-testid="visit-plan-unplanned">
                <div className="card-title">Unplanned visits</div>
                <div className="card-sub" style={{ marginBottom: 8 }}>
                  Visits {salesperson} held at customers outside this plan. They don't count toward completion.
                </div>
                {progress.unplanned.map((u) => (
                  <div key={u.companyId}>
                    <div className="vp-unplanned-row">
                      <Link to={paths.company(u.companyId)} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--brand)', textDecoration: 'none' }}>
                        {u.companyName}
                      </Link>
                      <CountButton n={u.held} label="Held visits" testId="visit-plan-unplanned-held" open={drill === `${u.companyId}:unplanned`} onClick={() => toggle(`${u.companyId}:unplanned`)} />
                    </div>
                    {drill === `${u.companyId}:unplanned` && <MeetingsBehind title="Held visits" ids={u.meetingIds} progress={progress} calendar={calendarFor('held', u.companyId)} tz={tz} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ flex: '1 1 320px', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="card card-pad">
              <div className="card-title">Note</div>
              {canManage ? (
                <textarea
                  className="form-input"
                  data-testid="visit-plan-note"
                  rows={3}
                  maxLength={2000}
                  placeholder="Focus, context for the salesperson"
                  value={plan.note ?? ''}
                  onChange={(e) => store.setPlanNote(plan.id, e.target.value)}
                  style={{ width: '100%', marginTop: 10 }}
                />
              ) : (
                <div data-testid="visit-plan-note" style={{ marginTop: 10, fontSize: 13, color: plan.note ? 'var(--ink)' : 'var(--muted)', whiteSpace: 'pre-line' }}>
                  {plan.note || 'No note.'}
                </div>
              )}
            </div>
            <div className="card card-pad">
              <div className="card-title" style={{ marginBottom: 8 }}>
                History
              </div>
              <ChangeHistory entity="visit_plan" id={plan.id} cur={curOf(s)} rev={s.versions['visit_plan:' + plan.id] ?? plan.updatedAt} />
            </div>
          </div>
        </div>
      </div>
      {copying && <VisitPlanDialog initial={copying} onClose={() => setCopying(null)} />}
    </Screen>
  );
}
