import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Board, BOARD_CARD, BoardColumn, ViewToggle } from '../components/Board';
import { FilterBar, SortHeader, useSort } from '../components/ui';
import { DataActions } from '../components/DataActions';
import { EmptyState } from '../components/EmptyState';
import { FilterEmpty, FilterRow } from '../components/FilterRow';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { dealsCsv } from '../store/exportCsv';
import { filterPeople, openAndWon, opportunityFields, WON } from '../store/filterFields';
import { allOpen, applyFilters, clearAll, type FilterValue, isActive, markSeen, matchField, pruneList, withNewSubs } from '../store/filters';
import { funnelOptions, initialsOf, memberName, needsNextStep, ownerOf, stageOf, stageOwnerId, todayIso, valueNum, valueTotal } from '../store/selectors';
import type { Lead, SegKey, Stage, State } from '../store/types';
import { useStore } from '../store/store';
import { useBoardView } from '../store/useBoardView';
import { usePageFilters } from '../store/usePageFilters';

export function Pipeline() {
  const store = useStore();
  const { s, set, session } = store;
  const navigate = useNavigate();
  const [view, setView] = useBoardView('crm.pipelineView');
  const seg = s.segment;
  const stages = s.funnels[seg].stages;
  const me = session.userId;
  // The funnel is the select next to the view toggle (owner's call, 24 Oct), not a chip.
  const fields = useMemo(() => opportunityFields(s, seg, ['owner', 'status']), [s, seg]);
  const [saved, setSaved] = usePageFilters('pipeline', { order: ['owner', 'status'], f: { owner: { op: 'is', vals: [me] }, status: { op: 'is', vals: openAndWon() } } });
  // "Open" is saved as the whole group, so it follows the funnel's stages; single stages of another
  // funnel are dropped ("Open, Won" if nothing is left), and stages added since are ticked.
  const filters = withNewSubs(fields, pruneList(fields, saved, 'status', openAndWon()), 'status');
  const setFilters = (v: FilterValue) => setSaved(markSeen(fields, v, 'status'));
  // Another funnel: all of its Open stages, keeping Won and Lost (owner's call, 25 Oct).
  const pickFunnel = (next: SegKey) => {
    if (next === seg || !s.funnels[next]) return;
    setSaved(allOpen(filters, 'status'));
    set({ segment: next });
  };
  // The open funnel, then every chip (Status included: Lost is one of its values, CD-60), with AND.
  const segLeads = applyFilters(
    s.leads.filter((l) => l.segment === seg),
    fields,
    filters,
    { today: todayIso(s.workspace.timezone), fiscalMonth: s.workspace.fiscalMonth },
  );
  // The columns are the stages Status picks, and any other stage a deal in view sits in (a lost one).
  const statusField = fields.find((x) => x.id === 'status')!;
  const status = filters.f.status;
  const visible = isActive(statusField, status) ? stages.filter((st) => matchField(statusField, status, st.won ? WON : st.id, { today: '' }) || segLeads.some((l) => l.stage === st.id)) : stages;

  // Open means neither Won nor Lost (CD-380): the summary counts and totals only those.
  const openLeads = segLeads.filter((l) => l.outcome === 'open');
  const pipelineValue = valueTotal(s, openLeads);
  const noMatch = segLeads.length === 0 && s.leads.some((l) => l.segment === seg);

  return (
    <Screen title="Pipeline">
      <FilterBar
        lead={
          <>
            <ViewToggle value={view} onChange={setView} testId="pipeline-view" />
            <div className="funnel-select">
              <select aria-label="Funnel" data-testid="pipeline-funnel" value={seg} onChange={(e) => pickFunnel(e.target.value)}>
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
        row={
          <FilterRow
            fields={fields}
            value={filters}
            onChange={setFilters}
            people={filterPeople(s, me)}
            me={me}
          />
        }
        meta={`${openLeads.length} open ${openLeads.length === 1 ? 'opportunity' : 'opportunities'} · ${pipelineValue}`}
        extra={<DataActions type="deals" count={segLeads.length} exportCsv={() => dealsCsv(s, segLeads)} />}
        action={{ label: 'New opportunity', onClick: () => set({ newLeadOpen: true }) }}
      />

      {s.leads.length === 0 && (
        <div style={{ marginBottom: 14 }}>
          <EmptyState title="No opportunities yet" text="Opportunities move through your funnel's stages, left to right. Add your first one, or import opportunities from a CSV file." action={{ label: 'New opportunity', onClick: () => set({ newLeadOpen: true }) }} />
        </div>
      )}
      {noMatch ? (
        <FilterEmpty noun="opportunities" onClear={() => setFilters(clearAll(fields))} />
      ) : view === 'table' ? (
        s.leads.length > 0 && <PipelineTable s={s} stages={visible} leads={segLeads} openLead={store.openLead} />
      ) : (
        <PipelineBoard stages={visible} leads={segLeads} />
      )}
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
    <Board tall={s.leads.length > 0}>
      {stages.map((st, ci) => {
        const cards = leads.filter((l) => l.stage === st.id);
        const short = valueTotal(s, cards.filter((l) => l.outcome !== 'lost'), true);
        return (
          <BoardColumn
            key={st.id}
            name={st.name}
            sub={`${short} · ${cards.length}`}
            first={ci === 0}
            last={ci === stages.length - 1}
            active={dragOver === st.id}
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
          >
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
                  style={{ ...BOARD_CARD, background: lost ? 'var(--panel)' : 'var(--white)', cursor: lost ? 'pointer' : 'grab', opacity: dragId === l.id ? 0.45 : 1 }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25 }}>{l.company}</span>
                    <span style={{ fontSize: 11, color: 'var(--brand)', whiteSpace: 'nowrap' }}>{l.value}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {l.contact} · {l.role}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {/* The fit score is switched off with CHAMP (CD-362). <FitBadge score={l.score} /> */}
                    <StallLabel stall={l.stall} />
                    {l.lateDays > 0 && (
                      <span className="badge badge-warn" data-testid="card-late">
                        Late · {l.lateDays} {l.lateDays === 1 ? 'day' : 'days'}
                      </span>
                    )}
                    {/* The stage owner (CD-363), shown when it isn't the opportunity's owner. */}
                    {!lost && stageOwnerId(s, l) && stageOwnerId(s, l) !== l.ownerId && (
                      <span className="avatar" title={'Stage owner: ' + memberName(s, stageOwnerId(s, l))} style={{ width: 20, height: 20, fontSize: 9, marginLeft: 'auto' }}>
                        {initialsOf(memberName(s, stageOwnerId(s, l)))}
                      </span>
                    )}
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
            {cards.length === 0 && <div className="empty-dashed">Drop an opportunity here</div>}
          </BoardColumn>
        );
      })}
    </Board>
  );
}

// 'fit' is switched off with CHAMP (CD-362).
type TableKey = 'company' | 'contact' | 'stage' | 'value' | 'stall' | 'owner' | 'next';
const TABLE_HEADERS: { key: TableKey; label: string }[] = [
  { key: 'company', label: 'Opportunity' },
  { key: 'contact', label: 'Contact' },
  { key: 'stage', label: 'Stage' },
  { key: 'value', label: 'Value' },
  // { key: 'fit', label: 'Fit' },
  { key: 'stall', label: 'Last contact' },
  { key: 'owner', label: 'Owner' },
  { key: 'next', label: 'Next step' },
];

/**
 * The Table view (CD-274, flat since CD-318): the same deals and filters as the board as one list,
 * sorted by the column header that was clicked (stage order by default). A row opens the deal.
 */
function PipelineTable({ s, stages, leads, openLead }: { s: State; stages: Stage[]; leads: Lead[]; openLead: (id: string) => void }) {
  const { sort, toggle } = useSort<TableKey>('stage');
  const order = new Map(stages.map((st, i) => [st.id, i]));
  const sortValue = (l: Lead): string | number => {
    switch (sort.key) {
      case 'company':
        return `${l.company} ${l.title ?? ''}`.toLowerCase();
      case 'contact':
        return (l.contact ?? '').toLowerCase();
      case 'stage':
        return order.get(l.stage) ?? stages.length;
      case 'value':
        return valueNum(l.value);
      // case 'fit':
      //   return l.score;
      case 'stall':
        return l.stall;
      case 'owner':
        return ownerOf(s, l).toLowerCase();
      case 'next':
        return l.outcome === 'lost' ? `~${l.lostReason ?? ''}` : (stageOf(s, l).activity ?? '').toLowerCase();
    }
  };
  const rows = leads
    .map((l) => ({ l, v: sortValue(l) }))
    .sort((a, b) => (a.v > b.v ? 1 : a.v < b.v ? -1 : 0) * sort.dir || (order.get(a.l.stage) ?? 0) - (order.get(b.l.stage) ?? 0))
    .map((x) => x.l);
  return (
    <div className="pipeline-table" data-testid="pipeline-table">
      <div className="pipeline-table-inner">
        <div className="table-head caps">
          {TABLE_HEADERS.map((h) => (
            <SortHeader key={h.key} label={h.label} active={sort.key === h.key} dir={sort.dir} onClick={() => toggle(h.key)} />
          ))}
        </div>
        {rows.length === 0 && <div className="pipeline-table-empty">No opportunities match these filters.</div>}
        {rows.map((l) => {
          const lost = l.outcome === 'lost';
          const st = stages.find((x) => x.id === l.stage) ?? stageOf(s, l);
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
              {/* <span>
                <FitBadge score={l.score} />
              </span> */}
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
    </div>
  );
}

// The fit score is switched off with CHAMP (CD-362).
// function FitBadge({ score }: { score: number }) {
//   return (
//     <span
//       style={{
//         fontSize: 10,
//         padding: '3px 5px',
//         borderRadius: 4,
//         whiteSpace: 'nowrap',
//         background: score >= 80 ? '#E7F2EE' : score >= 65 ? '#FDF0E4' : '#F2F5F3',
//         color: score >= 80 ? '#14503C' : score >= 65 ? '#B4531B' : '#475750',
//       }}
//     >
//       fit {score}
//     </span>
//   );
// }

function StallLabel({ stall }: { stall: number }) {
  return <span style={{ fontSize: 11.5, color: stall >= 4 ? '#B42318' : '#475750' }}>{stall === 0 ? 'active today' : stall + 'd since contact'}</span>;
}

function NoNextStep() {
  return (
    <span className="badge badge-warn" data-testid="no-next-step" title="No dated open task and no planned meeting on this opportunity. Stage to-dos are not scheduled next steps.">
      No next step
    </span>
  );
}
