import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilterBar } from '../components/ui';
import { DataActions } from '../components/DataActions';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { dealsCsv } from '../store/exportCsv';
import { DEFAULT_FILTERS, INDUSTRIES, LOST_VIEWS, VALUE_BANDS, valueBandLabel } from '../store/seed';
import { bandOf, champTotal, curOf, currencySymbol, funnelOptions, needsNextStep, ownerOf, salesPeople, stageOf, valueTotal } from '../store/selectors';
import type { Lead, Stage, State } from '../store/types';
import { useStore } from '../store/store';

type PipelineView = 'board' | 'table';

const viewKey = (userId: string, tenantId: string) => `crm.pipelineView.${userId}.${tenantId}`;

/** The Kanban / Table choice, remembered per person and workspace in this browser (CD-274). */
function usePipelineView(userId: string, tenantId: string): [PipelineView, (v: PipelineView) => void] {
  const [view, setView] = useState<PipelineView>(() => {
    try {
      return localStorage.getItem(viewKey(userId, tenantId)) === 'table' ? 'table' : 'board';
    } catch {
      return 'board';
    }
  });
  const choose = (v: PipelineView) => {
    setView(v);
    try {
      localStorage.setItem(viewKey(userId, tenantId), v);
    } catch {
      // No storage (private mode, blocked): the choice lasts until the page is left.
    }
  };
  return [view, choose];
}

const VIEWS: { id: PipelineView; label: string; icon: string }[] = [
  { id: 'board', label: 'Kanban', icon: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v7h-4z' },
  { id: 'table', label: 'Table', icon: 'M4 6h16M4 12h16M4 18h16' },
];

export function Pipeline() {
  const store = useStore();
  const { s, set, session } = store;
  const navigate = useNavigate();
  const [view, setView] = usePipelineView(session.userId, session.tenant.id);

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
  const segLeads = inView.filter((l) => (f.lost === LOST_VIEWS[1] ? true : f.lost === LOST_VIEWS[2] ? l.outcome === 'lost' : l.outcome !== 'lost'));
  const lostHidden = f.lost === LOST_VIEWS[0] ? inView.filter((l) => l.outcome === 'lost').length : 0;
  const visible = f.stage === 'Stage' || !stages.some((x) => x.name === f.stage) ? stages : stages.filter((x) => x.name === f.stage);

  const pipelineValue = valueTotal(s, segLeads.filter((l) => l.outcome !== 'lost'));
  const setFilter = (k: keyof typeof f) => (v: string) => set((x) => ({ filters: { ...x.filters, [k]: v } }));
  const dirty = (['owner', 'industry', 'band', 'lost'] as const).some((k) => f[k] !== DEFAULT_FILTERS[k]);

  return (
    <Screen title="Pipeline">
      <FilterBar
        lead={
          <>
            <div className="view-toggle" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" title={v.label} aria-label={v.label} aria-pressed={view === v.id} data-testid={`pipeline-view-${v.id}`} onClick={() => setView(v.id)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={v.icon} />
                  </svg>
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
          </>
        }
        chips={[
          { value: f.owner, options: ['Salesperson', ...salesPeople(s)], onChange: setFilter('owner') },
          { value: f.industry, options: ['Industry', ...INDUSTRIES], onChange: setFilter('industry') },
          { value: f.band, options: VALUE_BANDS.map((v) => ({ value: v, label: valueBandLabel(v, currencySymbol(curOf(s))) })), onChange: setFilter('band') },
          { value: f.lost, options: [...LOST_VIEWS], onChange: setFilter('lost'), keepFirst: true },
        ]}
        dirty={dirty}
        onClear={() => set((x) => ({ filters: { ...x.filters, ...DEFAULT_FILTERS } }))}
        meta={`${segLeads.length} ${segLeads.length === 1 ? 'lead' : 'leads'} · ${pipelineValue} open${lostHidden ? ` · ${lostHidden} lost hidden` : ''}`}
        extra={<DataActions type="deals" count={segLeads.length} exportCsv={() => dealsCsv(s, segLeads)} />}
        action={{ label: 'New deal', onClick: () => set({ newLeadOpen: true }) }}
      />

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
    <div className="pipeline-board" style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '0 -30px -44px', padding: '0 30px', minHeight: 'calc(100vh - 118px)' }}>
      <div className="pipeline-columns" style={{ display: 'flex', gap: 14, overflowX: 'auto', alignItems: 'stretch', flex: 1, minHeight: s.leads.length ? 520 : 260 }}>
        {stages.map((st, ci) => {
          const cards = leads.filter((l) => l.stage === st.id);
          const short = valueTotal(s, cards.filter((l) => l.outcome !== 'lost'), true);
          const active = dragOver === st.id;
          const first = ci === 0;
          const last = ci === stages.length - 1;
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
              style={{ flex: '0 0 268px', width: 268, border: `1px solid ${active ? '#14503C' : 'transparent'}`, borderRadius: '6px 6px 0 0', display: 'flex', flexDirection: 'column' }}
            >
              <div
                style={{
                  position: 'relative',
                  width: last ? 268 : 282,
                  background: active ? '#D7E9E1' : '#F4F4F5',
                  clipPath: first
                    ? 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%)'
                    : last
                      ? 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 16px 50%)'
                      : 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%, 16px 50%)',
                  padding: first ? '12px 30px 12px 12px' : last ? '12px 12px 12px 26px' : '12px 30px 12px 26px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                  borderRadius: last ? '6px 6px 0 0' : '6px 0 0 0',
                  height: 57,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{st.name}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
                    {short} · {cards.length}
                  </span>
                </div>
              </div>

              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, background: active ? '#E7F2EE' : '#F4F4F5' }}>
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
                      style={{ background: lost ? 'var(--panel)' : 'var(--white)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-tile)', padding: '11px 12px', cursor: lost ? 'pointer' : 'grab', display: 'flex', flexDirection: 'column', gap: 8, opacity: dragId === l.id ? 0.45 : 1 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25 }}>{l.company}</span>
                        <span style={{ fontSize: 11, color: 'var(--brand)', whiteSpace: 'nowrap' }}>{l.value}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                        {l.contact} · {l.role}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <FitBadge score={champTotal(s, l)} />
                        <StallLabel stall={l.stall} />
                      </div>
                      {lost ? (
                        <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 7 }}>
                          <span className="badge badge-danger">Lost · {l.lostReason}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: 'var(--text-2)', borderTop: '1px dashed var(--border)', paddingTop: 7, lineHeight: 1.35 }}>
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
                {cards.length === 0 && <div className="empty-dashed">Drop a deal here</div>}
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
