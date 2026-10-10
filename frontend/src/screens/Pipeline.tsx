import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilterBar } from '../components/ui';
import { DataActions } from '../components/DataActions';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { usePipelineView, type PipelineView } from '../lib/usePipelineView';
import { paths } from '../lib/paths';
import { dealsCsv } from '../store/exportCsv';
import { DEFAULT_FILTERS, INDUSTRIES, LOST_VIEWS, VALUE_BANDS, valueBandLabel } from '../store/seed';
import { bandOf, champTotal, curOf, currencySymbol, funnelOptions, needsNextStep, ownerOf, salesPeople, stageOf, valueTotal } from '../store/selectors';
import type { Lead, Stage, State } from '../store/types';
import { useStore } from '../store/store';

const VIEWS: { id: PipelineView; label: string; icon: string }[] = [
  { id: 'board', label: 'Kanban', icon: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v7h-4z' },
  { id: 'table', label: 'Table', icon: 'M4 6h16M4 12h16M4 18h16' },
];

export function Pipeline() {
  const store = useStore();
  const { s, set, session } = store;
  const navigate = useNavigate();
  const [view, setView] = usePipelineView(session.userId, session.tenant.id);

  const [filtersOpen, setFiltersOpen] = useState(false);

  const seg = s.segment;
  const stages = s.funnels[seg].stages;
  const f = s.filters;
  // Lost deals are hidden from the board unless the "lost" chip says otherwise (CD-60).
  const inView = s.leads
    .filter((l) => l.segment === seg)
    .filter((l) => f.owner === 'Salesperson' || l.ownerId === f.owner)
    .filter((l) => f.stalled === 'Status' || (f.stalled === 'Stalled only' ? l.stall >= 3 : l.stall < 3))
    .filter((l) => !f.industry || f.industry === 'Industry' || l.industry === f.industry)
    .filter((l) => f.band === 'Value' || bandOf(l.value) === f.band);
  const stageFiltered = inView.filter((l) => f.stage === 'Stage' || !stages.some((st) => st.name === f.stage) || stages.find((st) => st.name === f.stage)?.id === l.stage);
  const segLeads = stageFiltered.filter((l) => (f.lost === LOST_VIEWS[1] ? true : f.lost === LOST_VIEWS[2] ? l.outcome === 'lost' : l.outcome !== 'lost'));
  const lostHidden = f.lost === LOST_VIEWS[0] ? stageFiltered.filter((l) => l.outcome === 'lost').length : 0;
  const visible = f.stage === 'Stage' || !stages.some((x) => x.name === f.stage) ? stages : stages.filter((x) => x.name === f.stage);

  const pipelineValue = valueTotal(s, segLeads.filter((l) => l.outcome !== 'lost'));
  const setFilter = (k: keyof typeof f) => (v: string) => set((x) => ({ filters: { ...x.filters, [k]: v } }));
  const activeFilters = (['owner', 'industry', 'band', 'lost', 'stage', 'stalled'] as const).filter((k) => f[k] !== DEFAULT_FILTERS[k]).length;
  const dirty = activeFilters > 0;

  return (
    <Screen title="Pipeline">
      <div className="pipeline-toolbar">
        <FilterBar
          lead={
            <>
              <div className="view-toggle" role="group" aria-label="View">
                {VIEWS.map((v) => (
                  <button key={v.id} type="button" title={v.label} aria-label={v.label} aria-pressed={view === v.id} data-testid={`pipeline-view-${v.id}`} onClick={() => setView(v.id)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={v.icon} />
                    </svg>
                    <span>{v.label}</span>
                  </button>
                ))}
              </div>
              <div className="funnel-select">
                <select aria-label="Funnel" data-testid="pipeline-funnel" value={seg} onChange={(e) => set((x) => ({ segment: e.target.value, filters: { ...x.filters, audience: e.target.value } }))}>
                  {funnelOptions(s).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button type="button" title="Edit funnel in Workspace settings" aria-label="Edit funnel" data-testid="pipeline-edit-funnel" onClick={() => navigate(paths.settings('funnel'))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
                  </svg>
                </button>
              </div>
              <button type="button" className="btn btn-secondary" aria-expanded={filtersOpen} aria-controls="pipeline-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
                Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}
              </button>
            </>
          }
          chips={[]}
          extra={<DataActions type="deals" count={segLeads.length} exportCsv={() => dealsCsv(s, segLeads)} />}
          action={{ label: 'New deal', onClick: () => set({ newLeadOpen: true }) }}
        />
      </div>
      <div id="pipeline-filters" hidden={!filtersOpen}>
        <FilterBar chips={[
            { value: f.owner, options: ['Salesperson', ...salesPeople(s)], onChange: setFilter('owner'), keepFirst: true },
            { value: f.industry, options: ['Industry', ...INDUSTRIES], onChange: setFilter('industry'), keepFirst: true },
            { value: f.band, options: VALUE_BANDS.map((v) => ({ value: v, label: valueBandLabel(v, currencySymbol(curOf(s))) })), onChange: setFilter('band'), keepFirst: true },
            { value: f.lost, options: [...LOST_VIEWS], onChange: setFilter('lost'), keepFirst: true },
            { value: f.stage, options: ['Stage', ...stages.map((st) => st.name)], onChange: setFilter('stage'), keepFirst: true },
            { value: f.stalled, options: ['Status', 'Stalled only', 'Active only'], onChange: setFilter('stalled'), keepFirst: true },
          ]}
          dirty={dirty}
          onClear={() => set((x) => ({ filters: { ...x.filters, ...DEFAULT_FILTERS } }))}
        />
      </div>
      <p className="pipeline-summary" role="status">
        {segLeads.length} {segLeads.length === 1 ? 'deal' : 'deals'} · {pipelineValue} open
        {lostHidden > 0 && <span> · {lostHidden} lost hidden</span>}
        {dirty && !filtersOpen && <span> · Filters applied</span>}
      </p>

      {s.leads.length === 0 && (
        <div style={{ marginBottom: 14 }}>
          <EmptyState title="No deals yet" text="Deals move through your funnel's stages, left to right. Add your first one, or import deals from a CSV file." action={{ label: 'New deal', onClick: () => set({ newLeadOpen: true }) }} />
        </div>
      )}
      {view === 'table' ? s.leads.length > 0 && <PipelineTable s={s} stages={visible} leads={segLeads} openLead={store.openLead} /> : <PipelineBoard stages={visible} leads={segLeads} />}
    </Screen>
  );
}

/** The Kanban view: one column per stage; drag a card to move the deal there. */
function PipelineBoard({ stages, leads }: { stages: Stage[]; leads: Lead[] }) {
  const store = useStore();
  const { s } = store;
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  return (
    <div className="pipeline-board pipeline-simple">
      <div className="pipeline-columns">
        {stages.map((st) => {
          const cards = leads.filter((l) => l.stage === st.id);
          const short = valueTotal(s, cards.filter((l) => l.outcome !== 'lost'), true);
          const active = dragOver === st.id;
          return (
            <div
              key={st.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOver !== st.id) setDragOver(st.id);
              }}
              onDragLeave={() => dragOver === st.id && setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || dragId;
                setDragId(null);
                setDragOver(null);
                if (id) store.moveLead(id, st.id);
              }}
              className="pipeline-stage"
              data-drag-over={active || undefined}
            >
              <div className="pipeline-stage-header">
                <div className="pipeline-stage-title">
                  <span>{st.name}</span>
                  <span className="pipeline-stage-count">{cards.length}</span>
                </div>
                <span className="pipeline-stage-value">{short}</span>
              </div>

              <div className="pipeline-stage-cards">
                {cards.map((l) => {
                  const lost = l.outcome === 'lost';
                  return (
                    <div
                      key={l.id}
                      data-lost={lost || undefined}
                      draggable={!lost}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', l.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragId(l.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDragOver(null);
                      }}
                      onClick={() => store.openLead(l.id)}
                      className="pipeline-deal"
                      tabIndex={0}
                      role="button"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          store.openLead(l.id);
                        }
                      }}
                      style={{ opacity: dragId === l.id ? 0.45 : 1 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25 }}>{l.company}</span>
                        <span style={{ fontSize: 11, color: 'var(--brand)', whiteSpace: 'nowrap' }}>{l.value}</span>
                      </div>
                      <div className="pipeline-deal-contact">
                        {[l.contact, l.role].filter(Boolean).join(' · ')}
                      </div>
                      {l.stall >= 3 && <StallLabel stall={l.stall} />}
                      {lost ? (
                        <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 7 }}>
                          <span className="badge badge-danger">Lost · {l.lostReason}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: 'var(--text-2)', borderTop: '1px solid var(--divider)', paddingTop: 7, lineHeight: 1.35 }}>
                          Next: {stageOf(s, l).activity}
                          {needsNextStep(s, l) && (
                            <div style={{ marginTop: 6 }}>
                              <NoNextStep />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {cards.length === 0 && <div className="pipeline-stage-empty">No deals</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Table view (CD-274): the same deals and filters as the board, one band per stage that has
 * deals, in stage order. A row opens the deal.
 */
function PipelineTable({ s, stages, leads, openLead }: { s: State; stages: Stage[]; leads: Lead[]; openLead: (id: string) => void }) {
  const groups = stages.map((st) => ({ st, rows: leads.filter((l) => l.stage === st.id) })).filter((g) => g.rows.length > 0);
  return (
    <div className="pipeline-table" data-testid="pipeline-table">
      <div className="pipeline-table-inner">
        <div className="table-head caps">
          <span>Deal</span>
          <span>Contact</span>
          <span>Stage</span>
          <span>Value</span>
          <span>Fit</span>
          <span>Last contact</span>
          <span>Owner</span>
          <span>Next step</span>
        </div>
        {groups.length === 0 && <div className="pipeline-table-empty">No deals match these filters.</div>}
        {groups.map(({ st, rows }) => (
          <div key={st.id} data-testid="pipeline-table-group">
            <div className="pipeline-table-band">
              <span style={{ fontSize: 13, fontWeight: 600 }}>{st.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {valueTotal(s, rows.filter((l) => l.outcome !== 'lost'), true)} · {rows.length}
              </span>
            </div>
            {rows.map((l) => {
              const lost = l.outcome === 'lost';
              return (
                <div key={l.id} className="table-row clickable" data-testid="pipeline-table-row" data-lost={lost || undefined} onClick={() => openLead(l.id)}>
                  <span className="pt-cell">
                    <span className="pt-main" style={{ fontWeight: 600 }}>
                      {l.company}
                    </span>
                    {l.title && <span className="pt-sub">{l.title}</span>}
                  </span>
                  <span className="pt-cell">
                    <span className="pt-main">{l.contact}</span>
                    {l.role && <span className="pt-sub">{l.role}</span>}
                  </span>
                  <span style={{ color: 'var(--text-2)' }}>{st.name}</span>
                  <span>{l.value}</span>
                  <span>
                    <FitBadge score={champTotal(s, l)} />
                  </span>
                  <span>
                    <StallLabel stall={l.stall} />
                  </span>
                  <span className="pt-main">{ownerOf(s, l)}</span>
                  <span className="pt-main" style={{ color: 'var(--text-2)' }}>
                    {lost ? <span className="badge badge-danger">Lost · {l.lostReason}</span> : needsNextStep(s, l) ? <NoNextStep /> : stageOf(s, l).activity}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function FitBadge({ score }: { score: number }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '3px 5px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        background: score >= 80 ? '#E7F2EE' : score >= 65 ? '#FDF0E4' : '#F2F5F3',
        color: score >= 80 ? '#14503C' : score >= 65 ? '#B4531B' : '#475750',
      }}
    >
      fit {score}
    </span>
  );
}

function StallLabel({ stall }: { stall: number }) {
  return <span style={{ fontSize: 11.5, color: stall >= 4 ? '#B42318' : '#475750' }}>{stall === 0 ? 'active today' : stall + 'd since contact'}</span>;
}

function NoNextStep() {
  return (
    <span className="badge badge-warn" data-testid="no-next-step" title="No dated open task and no planned meeting on this deal. Stage to-dos are not scheduled next steps.">
      No next step
    </span>
  );
}
