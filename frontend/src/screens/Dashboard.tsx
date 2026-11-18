import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { FilterRow } from '../components/FilterRow';
import { Screen } from '../components/Layout';
import { Popover } from '../components/Popover';
import { VisitProgressCard } from '../components/VisitProgressCard';
import { VISIT_PLANS_ENABLED } from '../lib/features';
import { paths } from '../lib/paths';
import { filterPeople, opportunityFields } from '../store/filterFields';
import { allOpen, applyFilters, type FilterValue, isActive, markSeen, pruneList, valueText, withNewSubs } from '../store/filters';
import { initialsOf } from '../store/initials';
import { conversionMetrics, daysLabel, MIN_MOVED_DEALS, TIME_BUCKETS } from '../store/metrics';
import { bandShade, bandWidth, dayCount, daysSince, PIPELINE_KEY, pipelineFilters, type PipelineTarget, STALL_DAYS } from '../store/overview';
import { APPROVAL_LABELS, approvalStatusOf, billedShare, bonusOf, bonusRule, closeIsoOf, curOf, currencySymbol, dealPayments, funnelOptions, memberName, moneyTotal, num, opportunityName, salesPeople, stageOf, stageOwnerId, stagesFor, stageTargetDays, todayIso, valueNum, valueTotal } from '../store/selectors';
import { useStore } from '../store/store';
import { usePageFilters } from '../store/usePageFilters';
import type { Drill, Lead, SegKey } from '../store/types';

const BONUS_COLS = 'minmax(0,1.6fr) 90px 120px 120px 120px 120px';
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const pct = (r: number | null) => (r === null ? '—' : Math.round(r * 100) + '%');
const shadeVar = (i: number, n: number, won: boolean) => {
  const { shade } = bandShade(i, n, won);
  return `var(--ov-shade-${shade})`;
};

/**
 * Overview (CD-531, boards C-Overview and C-Overview-Stage): how sales is doing at a glance. The
 * filter bar (Pipeline, Salesperson, Closing date, + Filter), four KPI cards, the pipeline funnel
 * and the funnel by payment due date, then stage conversion and the opportunities late in their
 * stage. Every number follows the filter bar; the cards open the Pipeline with the same filter.
 */
export function Dashboard() {
  const { s, set, refreshHistory, canSeeBonuses, session } = useStore();
  const navigate = useNavigate();
  // The stage history is loaded each time Overview opens, so it includes the latest moves.
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);
  const me = session.userId;
  const [saved, setSaved] = usePageFilters('overview', { order: ['owner', 'close'], f: { owner: { op: 'is', vals: [] }, close: {} } });
  // The Pipeline choice is kept with the other filters (not a chip of the row), so Clear resets it to
  // All pipelines; a pipeline deleted since counts as all.
  const picked = saved.f[PIPELINE_KEY]?.vals?.[0] ?? '';
  const pipeline: SegKey | null = s.funnels[picked] ? picked : null;
  // On All pipelines the Status choices are every funnel's stages, so none of them hides another funnel's opportunities.
  const fields = useMemo(() => opportunityFields(s, pipeline, ['owner', 'close']), [s, pipeline]);
  // A Status chip keeps "Open" across funnels; single stages of another funnel are dropped.
  const filters = withNewSubs(fields, pruneList(fields, saved, 'status'), 'status');
  const setFilters = (v: FilterValue) => setSaved(markSeen(fields, v, 'status'));
  const pickPipeline = (id: SegKey | null) => {
    // Another pipeline: a Status chip takes all of its Open stages, keeping Won and Lost.
    const next = allOpen(filters, 'status');
    setFilters({ ...next, f: { ...next.f, [PIPELINE_KEY]: { vals: id ? [id] : [] } } });
  };

  // On All pipelines the funnel cards show the first pipeline, and a small select switches them.
  const firstSeg = funnelOptions(s)[0]?.value ?? s.segment;
  const [cardSeg, setCardSeg] = useState<SegKey>(firstSeg);
  const seg: SegKey = pipeline ?? (s.funnels[cardSeg] ? cardSeg : firstSeg);
  const funnel = s.funnels[seg]!;

  const inPipeline = pipeline ? s.leads.filter((l) => l.segment === pipeline) : s.leads;
  // "This quarter" is a fiscal one, and "today" is the workspace's (CD-73).
  const ctx = { today: todayIso(s.workspace.timezone), fiscalMonth: s.workspace.fiscalMonth };
  const closeField = fields.find((x) => x.id === 'close')!;
  const closeOn = isActive(closeField, filters.f.close);
  // Every card below works on these opportunities, so the filter chips (the closing date too) apply everywhere.
  const beforeDates = applyFilters(inPipeline, fields, { ...filters, order: filters.order.filter((id) => id !== 'close') }, ctx);
  const dashLeads = applyFilters(beforeDates, fields, filters, ctx);
  const undatedHidden = closeOn ? beforeDates.filter((l) => !closeIsoOf(l)).length : 0;
  const closeText = valueText(closeField, filters.f.close, { today: ctx.today });
  const owners = filters.f.owner?.vals ?? [];
  const drill = (kicker: string, title: string, leadIds: string[], extra?: Pick<Drill, 'amounts' | 'summary'>) => set({ drill: { kicker, title, leadIds, ...extra } });
  /** The Pipeline with Overview's filter (the funnel the cards show), and Status as the card says. */
  const openPipeline = (target: PipelineTarget) => {
    if (s.segment !== seg) set({ segment: seg });
    navigate(paths.pipeline, { state: { filters: pipelineFilters(filters, target) } });
  };

  // Lost opportunities (CD-60) count nowhere in the pipeline: not open, not weighted, not stalled.
  const liveLeads = dashLeads.filter((l) => l.outcome !== 'lost');
  const openLeads = dashLeads.filter((l) => l.outcome === 'open');
  const wonLeads = dashLeads.filter((l) => l.outcome === 'won');
  // Sums are per currency: an opportunity in another currency than the workspace's is listed next to it, not added in.
  const weighted = moneyTotal(s, openLeads.map((l) => ({ currency: l.currency, amount: (valueNum(l.value) * num(stageOf(s, l).prob)) / 100 })), true);
  const stalled = openLeads.filter((l) => l.stall >= STALL_DAYS);
  const kpis: { label: string; value: string; note: string; target: PipelineTarget }[] = [
    { label: 'Open pipeline', value: valueTotal(s, openLeads, true), note: plural(openLeads.length, 'open opportunity', 'open opportunities') + ' in the current filter', target: { kind: 'open' } },
    { label: 'Weighted pipeline', value: weighted, note: "Open value times each stage's win probability", target: { kind: 'open' } },
    { label: 'Won', value: valueTotal(s, wonLeads, true), note: plural(wonLeads.length, 'opportunity', 'opportunities') + ' in the won stage', target: { kind: 'won' } },
    { label: 'Stalled', value: String(stalled.length), note: `Open opportunities with no contact for ${STALL_DAYS}+ days`, target: { kind: 'stalled' } },
  ];

  // The funnel counts the open and won opportunities of its pipeline (CD-478), so it says what it leaves out.
  const stages = stagesFor(s, seg);
  const lostInView = dashLeads.length - liveLeads.length;
  const otherFunnels = liveLeads.filter((l) => l.segment !== seg).length;
  const notCounted = [lostInView && `${lostInView} lost`, otherFunnels && `${otherFunnels} in other funnels`].filter(Boolean).join(', ');
  const inFunnel = liveLeads.filter((l) => l.segment === seg);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const bandRefs = useRef(new Map<string, HTMLButtonElement>());
  const shownStage = openStage && stages.some((st) => st.id === openStage) ? openStage : null;
  const closeStage = () => {
    const band = shownStage ? bandRefs.current.get(shownStage) : undefined;
    setOpenStage(null);
    band?.focus();
  };

  // Payments without a date (a product without a billing start date, an installment without a
  // date) can't be placed, so they are left out and their opportunities counted below. Only Won
  // opportunities count: money that is contracted, not hoped for (CD-365).
  const now = new Date();
  const payments: { leadId: string; currency?: string; when: Date; amount: number }[] = [];
  let undatedDeals = 0;
  for (const l of wonLeads) {
    const { payments: dated, undated } = dealPayments(s, l);
    if (undated) undatedDeals++;
    for (const p of dated) payments.push({ leadId: l.id, currency: l.currency, ...p });
  }
  const dueBands: DueBand[] = TIME_BUCKETS.map((b, i) => {
    const due = payments.filter((p) => {
      const diff = (p.when.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.4);
      return diff > b.range[0] && diff <= b.range[1];
    });
    const ids = [...new Set(due.map((p) => p.leadId))];
    return {
      i,
      label: b.label,
      ids,
      short: moneyTotal(s, due, true),
      full: moneyTotal(s, due),
      count: due.length,
      // Per opportunity, only what falls due in this band (CD-365), not its whole value.
      amounts: Object.fromEntries(ids.map((id) => [id, moneyTotal(s, due.filter((p) => p.leadId === id))])),
      counts: Object.fromEntries(ids.map((id) => [id, due.filter((p) => p.leadId === id).length])),
    };
  });
  // A payment period opens the same side panel as a stage (CD-531); one panel at a time.
  const [openDue, setOpenDue] = useState<number | null>(null);
  const dueRefs = useRef(new Map<number, HTMLButtonElement>());
  const pickStage = (id: string | null) => {
    setOpenDue(null);
    setOpenStage(id);
  };
  const pickDue = (i: number | null) => {
    setOpenStage(null);
    setOpenDue(i);
  };
  const closeDue = () => {
    const band = openDue !== null ? dueRefs.current.get(openDue) : undefined;
    setOpenDue(null);
    band?.focus();
  };

  const late = openLeads.filter((l) => l.lateDays > 0).sort((a, b) => b.lateDays - a.lateDays);
  const countLine = `${plural(openLeads.length, 'open opportunity', 'open opportunities')} in view, ${closeOn ? 'closing ' + closeText.charAt(0).toLowerCase() + closeText.slice(1) : 'any closing date'}${undatedHidden ? `, ${undatedHidden} without a closing date hidden` : ''}`;

  return (
    <Screen title="Overview">
      <div className="ov" data-testid="overview">
        <div className="ov-fbar">
          <PipelineChip value={pipeline} onPick={pickPipeline} />
          <FilterRow fields={fields} value={filters} onChange={setFilters} people={filterPeople(s, me)} me={me} forceClear={pipeline !== null} />
          <span className="ov-count" data-testid="overview-count">
            {countLine}
          </span>
        </div>

        {s.leads.length === 0 && (
          <EmptyState title="Nothing to measure yet" text="Overview measures your opportunities: open and weighted pipeline, wins, conversion and time in each stage. It fills in as opportunities move." action={{ label: 'New opportunity', onClick: () => set({ newLeadOpen: true }) }} />
        )}

        <div className="ov-kpis">
          {kpis.map((k) => (
            <button key={k.label} type="button" className="gs-glass ov-kpi" data-testid="overview-kpi" title={`Open ${funnel.label} in the Pipeline`} onClick={() => openPipeline(k.target)}>
              <span className="ov-kpi-label">{k.label}</span>
              <b className="ov-kpi-value">{k.value}</b>
              <span className="ov-sub">{k.note}</span>
            </button>
          ))}
        </div>
        {/* The Pipeline shows one funnel, so on All pipelines a card's total and the Pipeline it opens differ: say which one. */}
        {pipeline === null && funnelOptions(s).length > 1 && (
          <p className="ov-sub ov-kpi-hint" data-testid="kpi-pipeline-note">
            The cards add up every pipeline. A card opens {funnel.label} in the Pipeline, the funnel shown below.
          </p>
        )}

        {/* Its own plan period, independent of the closing-period filter above (CD-135). Switched off for now (CD-522). */}
        {VISIT_PLANS_ENABLED && <VisitProgressCard />}

        <div className="ov-grid ov-grid-top">
          <section className="gs-glass ov-card" data-testid="funnel-card">
            <div className="ov-card-head">
              <div className="ov-card-titles">
                <b className="ov-card-title">Pipeline funnel</b>
                <span className="ov-sub" data-testid="funnel-sub">
                  {funnel.label}: click a stage to see its opportunities{notCounted ? `, not counted: ${notCounted}` : ''}
                </span>
              </div>
              {pipeline === null && funnelOptions(s).length > 1 && (
                <select className="ov-select" aria-label="Funnel shown" data-testid="funnel-card-select" value={seg} onChange={(e) => {
                    setCardSeg(e.target.value);
                    setOpenStage(null);
                  }}
                >
                  {funnelOptions(s).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className={'ov-bands' + (shownStage ? ' has-on' : '')}>
              {stages.map((st, i) => {
                const rows = inFunnel.filter((l) => l.stage === st.id);
                const on = shownStage === st.id;
                const dark = bandShade(i, stages.length, !!st.won).dark;
                return (
                  // A button (CD-502): Tab reaches it, Enter opens the stage, and closing it puts focus back here.
                  <button
                    key={st.id}
                    ref={(el) => {
                      if (el) bandRefs.current.set(st.id, el);
                      else bandRefs.current.delete(st.id);
                    }}
                    type="button"
                    className={'ov-band' + (on ? ' on' : '') + (dark ? ' dark' : '') + (st.won ? ' won' : '')}
                    data-testid="funnel-stage-band"
                    aria-pressed={on}
                    aria-label={`${st.name}: ${plural(rows.length, 'opportunity', 'opportunities')}, ${valueTotal(s, rows)}. Show them`}
                    title={`${st.name}: ${plural(rows.length, 'opportunity', 'opportunities')}, ${valueTotal(s, rows)}`}
                    onClick={() => (on ? closeStage() : pickStage(st.id))}
                    style={{ width: bandWidth(i, stages.length), background: shadeVar(i, stages.length, !!st.won) }}
                  >
                    <b className="ov-band-name">{st.name}</b>
                    <span className="ov-band-count">{rows.length}</span>
                    <b className="ov-band-value">{rows.length ? valueTotal(s, rows, true) : '—'}</b>
                  </button>
                );
              })}
            </div>
            {inFunnel.length === 0 && <div className="ov-empty">No open or won opportunities in this pipeline for the current filter.</div>}
          </section>

          <section className="gs-glass ov-card" data-testid="due-card">
            <div className="ov-card-titles">
              <b className="ov-card-title">Funnel by payment due date</b>
              <span className="ov-sub">
                {/* CD-365: the bands are separate periods, not running totals. */}
                Won opportunities only. Each band is its own period; the bands don't add up. Product and service payments falling due in that period, without VAT.
                {undatedDeals ? ` ${plural(undatedDeals, 'opportunity', 'opportunities')} without billing dates left out.` : ''}
              </span>
            </div>
            <div className={'ov-bands ov-due' + (openDue !== null ? ' has-on' : '')}>
              {dueBands.map((b) => {
                const on = openDue === b.i;
                const text = b.ids.length ? `${b.label}: ${b.full} due, ${plural(b.ids.length, 'opportunity', 'opportunities')}` : `${b.label}: nothing due`;
                return (
                  <button
                    key={b.label}
                    ref={(el) => {
                      if (el) dueRefs.current.set(b.i, el);
                      else dueRefs.current.delete(b.i);
                    }}
                    type="button"
                    className={'ov-band' + (on ? ' on' : '') + (b.i >= 3 ? ' dark' : '')}
                    data-testid="funnel-due-band"
                    aria-pressed={on}
                    aria-label={`${text}. Show them`}
                    title={text}
                    onClick={() => (on ? closeDue() : pickDue(b.i))}
                    style={{ width: bandWidth(b.i, dueBands.length, 46), background: `var(--ov-due-${b.i})` }}
                  >
                    <b className="ov-band-name">{b.label}</b>
                    {b.ids.length ? <b className="ov-band-value">{b.short}</b> : <span className="ov-band-dash" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {wonLeads.length === 0 && <div className="ov-empty">No won opportunities in view. Payments show here once an opportunity is won.</div>}
          </section>
        </div>

        <div className="ov-grid">
          <StageConversion leads={dashLeads} seg={seg} />

          <section className="gs-glass ov-card ov-late" data-testid="late-card">
            <div className="ov-late-head">
              <h2>Late in their stage</h2>
              <span className="ov-sub">Past the stage target</span>
            </div>
            {late.length === 0 ? (
              <div className="ov-empty">Nothing is late. Every opportunity is within its stage target.</div>
            ) : (
              late.map((l) => {
                const owner = memberName(s, stageOwnerId(s, l));
                const target = stageTargetDays(s, l);
                return (
                  <Link key={l.id} to={paths.lead(l.id)} className="ov-row" data-testid="late-row">
                    <span className="gs-face soft ov-face-sm" title={owner}>
                      {initialsOf(owner)}
                    </span>
                    <span className="ov-row-text">
                      <b>
                        {opportunityName(l)}
                        {l.title?.trim() ? `, ${l.company}` : ''}
                      </b>
                      <span className="ov-sub">
                        {stageOf(s, l).name}, owned by {owner}
                        {target ? `, target ${dayCount(target)}` : ''}
                      </span>
                    </span>
                    <span className="ov-tag late">{dayCount(l.lateDays)} late</span>
                  </Link>
                );
              })
            )}
          </section>
        </div>

        {canSeeBonuses && <Bonuses leads={liveLeads} owners={owners} drill={drill} />}
      </div>

      {shownStage && (
        <StagePanel
          seg={seg}
          stageId={shownStage}
          leads={inFunnel}
          onClose={closeStage}
          onPick={setOpenStage}
        />
      )}
      {openDue !== null && <DuePanel bands={dueBands} index={openDue} leads={wonLeads} onClose={closeDue} onPick={setOpenDue} />}
    </Screen>
  );
}

/** The Pipeline chip (CD-531): All pipelines, or one; one value, so radio rows. */
function PipelineChip({ value, onPick }: { value: SegKey | null; onPick: (id: SegKey | null) => void }) {
  const { s } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const options: { id: SegKey | null; name: string }[] = [{ id: null, name: 'All pipelines' }, ...funnelOptions(s).map((o) => ({ id: o.value, name: o.label }))];
  return (
    <>
      <button ref={ref} type="button" className={'fr-chip' + (value ? ' on' : '')} data-testid="filter-chip-pipeline" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="fr-chip-label">Pipeline</span>
        <span className="fr-chip-val">{value ? s.funnels[value]?.label : 'All pipelines'}</span>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} label="Pipeline" className="fr-pop" testId="filter-pop-pipeline" keepOnScroll>
          <div className="fr-list">
            {options.map((o) => {
              const on = o.id === value;
              return (
                <button
                  key={o.id ?? 'all'}
                  type="button"
                  className="fr-opt"
                  data-testid="filter-option"
                  data-value={o.id ?? ''}
                  aria-pressed={on}
                  onClick={() => {
                    onPick(o.id);
                    setOpen(false);
                  }}
                >
                  <span className={'fr-box radio' + (on ? ' on' : '')}>
                    {on && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m5 12.5 4.5 4.5L19 7.5" />
                      </svg>
                    )}
                  </span>
                  <span className="fr-opt-text">{o.name}</span>
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </>
  );
}

/**
 * The glass side panel (board C-Overview-Stage) shared by a funnel stage and a payment period: a
 * panel on the right with a few numbers, a note, the previous and next band, and the
 * opportunities. Escape, the scrim, × and the band again close it.
 */
function SidePanel({ panelKey, label, color, title, subtitle, stats, note, prev, next, onPrev, onNext, emptyText, onClose, children }: {
  panelKey: string;
  label: string;
  color: string;
  title: string;
  subtitle: string;
  stats: { k: string; v: string }[];
  note: ReactNode;
  prev?: string;
  next?: string;
  onPrev: () => void;
  onNext: () => void;
  emptyText: string;
  onClose: () => void;
  children: ReactNode[];
}) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
  }, [panelKey]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="gs-tokens ov-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ov-panel" role="dialog" aria-modal="true" aria-label={label} data-testid="stage-panel">
        <div className="ov-panel-head">
          <span className="ov-panel-dot" style={{ background: color }} aria-hidden="true" />
          <div className="ov-panel-titles">
            <b>{title}</b>
            <span className="ov-sub">{subtitle}</span>
          </div>
          <button ref={closeBtn} type="button" className="gs-x plain" aria-label="Close" data-testid="stage-panel-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="ov-panel-stats">
          {stats.map((x) => (
            <div key={x.k} className="ov-mini">
              <span className="ov-sub">{x.k}</span>
              <b>{x.v}</b>
            </div>
          ))}
        </div>
        <div className="ov-panel-owner">{note}</div>
        {(prev || next) && (
          <div className="ov-panel-nav">
            {prev && (
              <button type="button" className="gs-btn small" onClick={onPrev}>
                ← {prev}
              </button>
            )}
            {next && (
              <button type="button" className="gs-btn small" onClick={onNext}>
                {next} →
              </button>
            )}
          </div>
        )}
        <div className="gs-glass ov-panel-list">
          {children.length === 0 && <div className="ov-empty">{emptyText}</div>}
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One opportunity in a side panel: owner, name, a line about it, tags, and an amount. */
function PanelRow({ lead, line, amount, amountNote }: { lead: Lead; line: string; amount: string; amountNote: string }) {
  const { s } = useStore();
  const owner = memberName(s, lead.ownerId, lead.owner);
  const approval = approvalStatusOf(s, lead);
  return (
    <Link to={paths.lead(lead.id)} className="ov-row ov-opp" data-testid="stage-panel-row">
      <span className="gs-face" title={owner}>
        {initialsOf(owner)}
      </span>
      <span className="ov-row-text">
        <b>{opportunityName(lead)}</b>
        <span className="ov-sub">{line}</span>
        {(lead.lateDays > 0 || lead.qualifiedAt || approval === 'pending' || approval === 'approved') && (
          <span className="ov-tags">
            {lead.lateDays > 0 && <span className="ov-tag late">{dayCount(lead.lateDays)} late</span>}
            {lead.qualifiedAt && <span className="ov-tag ok">Qualified</span>}
            {(approval === 'pending' || approval === 'approved') && <span className={'ov-tag ' + (approval === 'pending' ? 'amber' : 'ok')}>{APPROVAL_LABELS[approval]}</span>}
          </span>
        )}
      </span>
      <span className="ov-opp-value">
        <b>{amount}</b>
        <span className="ov-sub">{amountNote}</span>
      </span>
    </Link>
  );
}

/** A funnel stage's opportunities, with the stage's numbers, its owner and target. */
function StagePanel({ seg, stageId, leads, onClose, onPick }: { seg: SegKey; stageId: string; leads: Lead[]; onClose: () => void; onPick: (id: string) => void }) {
  const { s } = useStore();
  const stages = stagesFor(s, seg);
  const i = Math.max(0, stages.findIndex((st) => st.id === stageId));
  const st = stages[i]!;
  const rows = leads.filter((l) => l.stage === st.id);
  const prob = num(st.prob);
  const target = st.targetDays ?? s.funnels[seg]?.targetDays ?? null;
  const prev = stages[i - 1];
  const next = stages[i + 1];
  const weightedOf = (l: Lead) => moneyTotal(s, [{ currency: l.currency, amount: (valueNum(l.value) * prob) / 100 }], true);
  const stageOwner = st.ownerId ? memberName(s, st.ownerId) : null;

  return (
    <SidePanel
      panelKey={st.id}
      label={`${st.name} opportunities`}
      color={shadeVar(i, stages.length, !!st.won)}
      title={st.name}
      subtitle={`${s.funnels[seg]?.label}, stage ${i + 1} of ${stages.length}`}
      stats={[
        { k: 'Opportunities', v: String(rows.length) },
        { k: 'Value', v: rows.length ? valueTotal(s, rows, true) : '—' },
        { k: 'Weighted', v: rows.length ? moneyTotal(s, rows.map((l) => ({ currency: l.currency, amount: (valueNum(l.value) * prob) / 100 })), true) : '—' },
      ]}
      note={
        stageOwner ? (
          <>
            <span className="gs-face soft ov-face-sm">{initialsOf(stageOwner)}</span>
            <span>
              Stage owner <b>{stageOwner}</b>, target {target ? dayCount(target) : 'none'}
            </span>
          </>
        ) : (
          <span>Each opportunity's owner answers for this stage, target {target ? dayCount(target) : 'none'}</span>
        )
      }
      prev={prev?.name}
      next={next?.name}
      onPrev={() => prev && onPick(prev.id)}
      onNext={() => next && onPick(next.id)}
      emptyText="No opportunities in this stage right now."
      onClose={onClose}
    >
      {rows.map((l) => (
        <PanelRow key={l.id} lead={l} line={`${l.company}, ${dayCount(daysSince(l.stageSince))} in stage`} amount={valueTotal(s, [l])} amountNote={`${prob}%, ${weightedOf(l)} weighted`} />
      ))}
    </SidePanel>
  );
}

type DueBand = { i: number; label: string; ids: string[]; short: string; full: string; count: number; amounts: Record<string, string>; counts: Record<string, number> };

/** A payment period's won opportunities (CD-531), with what each has falling due in it. */
function DuePanel({ bands, index, leads, onClose, onPick }: { bands: DueBand[]; index: number; leads: Lead[]; onClose: () => void; onPick: (i: number) => void }) {
  const { s } = useStore();
  const b = bands[index]!;
  const prev = bands[index - 1];
  const next = bands[index + 1];
  const rows = b.ids.map((id) => leads.find((l) => l.id === id)).filter((l): l is Lead => !!l);

  return (
    <SidePanel
      panelKey={String(index)}
      label={`Payments due ${b.label}`}
      color={`var(--ov-due-${b.i})`}
      title={b.label}
      subtitle={`Funnel by payment due date, period ${index + 1} of ${bands.length}`}
      stats={[
        { k: 'Opportunities', v: String(rows.length) },
        { k: 'Due', v: b.ids.length ? b.short : '—' },
        { k: 'Payments', v: String(b.count) },
      ]}
      note={<span>Won opportunities only. Product and service payments falling due in this period, without VAT.</span>}
      prev={prev?.label}
      next={next?.label}
      onPrev={() => onPick(index - 1)}
      onNext={() => onPick(index + 1)}
      emptyText="Nothing falls due in this period."
      onClose={onClose}
    >
      {rows.map((l) => (
        <PanelRow key={l.id} lead={l} line={`${l.company}, ${plural(b.counts[l.id] ?? 0, 'payment')} in this period`} amount={b.amounts[l.id] ?? '—'} amountNote={`of ${valueTotal(s, [l])} won`} />
      ))}
    </SidePanel>
  );
}

/**
 * Stage-to-stage conversion, win rate, time in stage and time to proposal (CD-62), computed in the
 * browser from the stage history of the opportunities in view, for the funnel the funnel card shows.
 */
function StageConversion({ leads, seg }: { leads: Lead[]; seg: SegKey }) {
  const { s, set } = useStore();
  const stages = stagesFor(s, seg);
  const inFunnel = leads.filter((l) => l.segment === seg);
  const m = s.stageHistory ? conversionMetrics(stages, inFunnel, s.stageHistory) : null;
  const drill = (title: string, leadIds: string[]) => leadIds.length && set({ drill: { kicker: 'Stage conversion', title, leadIds } });
  const stats = m && [
    { label: 'Win rate', value: pct(m.winRate), note: m.won + m.lost ? `${m.won} won, ${m.lost} lost` : 'No won or lost opportunities yet' },
    {
      label: m.proposal ? `To ${m.proposal.name}` : 'To proposal',
      value: daysLabel(m.toProposalDays),
      note: !m.proposal ? 'This funnel has no proposal stage' : m.toProposalDeals ? `Average from ${stages[0]!.name}, ${plural(m.toProposalDeals, 'opportunity', 'opportunities')}` : 'No opportunity has reached it yet',
    },
    { label: 'Opportunities that moved', value: String(m.moved), note: `of ${plural(inFunnel.length, 'opportunity', 'opportunities')} in view` },
  ];

  return (
    <section className="gs-glass ov-card" data-testid="stage-conversion">
      <div className="ov-card-titles">
        <b className="ov-card-title">Stage conversion</b>
        <span className="ov-sub">{s.funnels[seg]?.label}: share of opportunities that reached a stage and moved on to a later one</span>
      </div>
      {!m ? (
        <div className="ov-empty">Loading the stage history…</div>
      ) : m.moved < MIN_MOVED_DEALS ? (
        <div className="ov-empty">
          Conversion rates appear once at least {MIN_MOVED_DEALS} opportunities in view have moved between stages ({m.moved} so far).
        </div>
      ) : (
        <>
          <div className="ov-minis">
            {stats!.map((x) => (
              <div key={x.label} className="ov-mini">
                <span className="ov-kpi-label small">{x.label}</span>
                <b className="ov-mini-value">{x.value}</b>
                <span className="ov-sub">{x.note}</span>
              </div>
            ))}
          </div>
          {/* Narrow screens: the table scrolls inside its card (CD-530). */}
          <div className="ov-conv-wrap">
          <table className="ov-conv">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Moved on</th>
                <th aria-label="Share" />
                <th className="num">Count</th>
                <th className="num">Avg in stage</th>
              </tr>
            </thead>
            <tbody>
              {m.stages.map((r) => (
                <tr key={r.stage.id} data-stage={r.stage.name}>
                  <td className="ov-conv-stage">
                    <button type="button" className="ov-linkbtn" disabled={!r.reached.length} title={r.stage.name} onClick={() => drill(`Reached ${r.stage.name}`, r.reached)}>
                      {r.stage.name}
                    </button>
                  </td>
                  <td>
                    <span className="ov-bar">
                      <span style={{ width: (r.rate ?? 0) * 100 + '%' }} />
                    </span>
                  </td>
                  <td className="num strong">{pct(r.rate)}</td>
                  <td className="num ov-sub">
                    {r.advanced.length}/{r.reached.length}
                  </td>
                  <td className="num ov-sub">{daysLabel(r.avgDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  );
}

/** Sales bonuses (CD-17): owners and admins only, from the rules saved in Settings, Sales bonuses. */
function Bonuses({ leads, owners, drill }: { leads: Lead[]; owners: string[]; drill: (kicker: string, title: string, leadIds: string[]) => void }) {
  const { s } = useStore();
  const trigger = s.bonusTrigger || 'On contract signed';
  const totalEarned: { currency?: string; amount: number }[] = [];
  const totalPending: { currency?: string; amount: number }[] = [];
  const rows = salesPeople(s)
    .filter(({ value: ownerId }) => !owners.length || owners.includes(ownerId))
    .map(({ value: ownerId, label: owner }) => {
      const rule = bonusRule(s, ownerId);
      const earned: { currency?: string; amount: number }[] = [];
      const pending: { currency?: string; amount: number }[] = [];
      const earnedIds: string[] = [];
      const pendingIds: string[] = [];
      for (const l of leads.filter((x) => x.ownerId === ownerId)) {
        const bonus = bonusOf(l, rule, s.workspace.currency);
        const full = rule.trigger === 'When fully billed' ? billedShare(s, l) >= 0.999 : true;
        if (l.outcome === 'won' && full) {
          earned.push({ currency: l.currency, amount: bonus });
          earnedIds.push(l.id);
        } else {
          pending.push({ currency: l.currency, amount: bonus });
          pendingIds.push(l.id);
        }
      }
      totalEarned.push(...earned);
      totalPending.push(...pending);
      return { ownerId, owner, rule, earned, pending, earnedIds, pendingIds };
    });
  const ruleText = (v: number | string, suffix = '') => (v === '' ? '—' : String(v) + suffix);

  return (
    <section className="gs-glass ov-card" data-testid="bonus-card">
      <div className="ov-card-head">
        <div className="ov-card-titles">
          <b className="ov-card-title">Sales bonuses</b>
          <span className="ov-sub">
            Rate per salesperson, with a flat amount on opportunities under the minimum, earned {trigger.toLowerCase()}. Only owners and admins see this.{' '}
            <Link to={paths.settings('bonuses')}>Edit the rules</Link>
          </span>
        </div>
        <span className="ov-sub">
          {moneyTotal(s, totalEarned)} earned, {moneyTotal(s, totalPending)} pending
        </span>
      </div>
      <div className="ov-scroll">
        <div style={{ minWidth: 760 }}>
          <div className="ov-bonus-row head" style={{ gridTemplateColumns: BONUS_COLS }}>
            {['Salesperson', 'Rate %', `Minimum (${currencySymbol(curOf(s))})`, 'Flat under min', 'Earned', 'Pending'].map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.ownerId} className="ov-bonus-row" style={{ gridTemplateColumns: BONUS_COLS }}>
              <b>{r.owner}</b>
              <span className="ov-sub">{ruleText(r.rule.rate, '%')}</span>
              <span className="ov-sub">{ruleText(r.rule.floor)}</span>
              <span className="ov-sub">{ruleText(r.rule.fixed)}</span>
              <button type="button" className="ov-linkbtn strong" disabled={!r.earnedIds.length} onClick={() => drill('Bonus earned, ' + r.owner, r.rule.trigger, r.earnedIds)}>
                {moneyTotal(s, r.earned)}
              </button>
              <button type="button" className="ov-linkbtn" disabled={!r.pendingIds.length} onClick={() => drill('Bonus pending, ' + r.owner, r.rule.trigger, r.pendingIds)}>
                {moneyTotal(s, r.pending)}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
