import { useMemo, useState } from 'react';
import { Board, BOARD_CARD, BoardColumn, ViewToggle } from '../components/Board';
import { FilterBar, SortHeader, useSort } from '../components/ui';
import { DataActions } from '../components/DataActions';
import { EmptyState } from '../components/EmptyState';
import { FilterEmpty, FilterRow } from '../components/FilterRow';
import { Screen } from '../components/Layout';
import { BOARD_STATUSES, dropOutcome } from '../store/companyBoard';
import { companiesCsv } from '../store/exportCsv';
import { companyPageFields, filterPeople } from '../store/filterFields';
import { applyFilters, clearAll } from '../store/filters';
import { COMPANY_STATUS_LABELS, companyReadiness, type CompanyRecord, companyRecords, stagesFor, todayIso, valueTotal } from '../store/selectors';
import { useStore } from '../store/store';
import type { CompanyStatus } from '../store/types';
import { useBoardView } from '../store/useBoardView';
import { usePageFilters } from '../store/usePageFilters';

const COLS = '1.5fr 1fr 0.9fr 0.8fr 1.1fr 1fr 0.9fr 0.7fr 0.8fr 1fr 1fr 1.1fr 1.1fr 0.8fr 1fr';
type Key = 'name' | 'pib' | 'status' | 'ownership' | 'industry' | 'hq' | 'size' | 'contactCount' | 'oppCount' | 'value' | 'lifetimeValue' | 'stageName' | 'owner' | 'lastTouch' | 'source';
const HEADERS: { key: Key; label: string }[] = [
  { key: 'name', label: 'Company' },
  { key: 'pib', label: 'Company ID' },
  { key: 'status', label: 'Status' },
  { key: 'ownership', label: 'Ownership' },
  { key: 'industry', label: 'Industry' },
  { key: 'hq', label: 'HQ' },
  { key: 'size', label: 'Team size' },
  { key: 'contactCount', label: 'Contacts' },
  { key: 'oppCount', label: 'Opportunities' },
  { key: 'value', label: 'Open value' },
  { key: 'lifetimeValue', label: 'Lifetime value' },
  { key: 'stageName', label: 'Latest stage' },
  { key: 'owner', label: 'Owner' },
  { key: 'lastTouch', label: 'Last touch' },
  { key: 'source', label: 'Source' },
];
const NUMERIC = new Set<Key>(['value', 'lifetimeValue', 'oppCount', 'contactCount']);

export function Companies() {
  const { s, addCompany, openCompany, session } = useStore();
  const fields = useMemo(() => companyPageFields(s), [s]);
  const [filters, setFilters] = usePageFilters('companies', { order: ['owner'], f: { owner: { vals: [] } } });
  const { sort, toggle } = useSort<Key>('name');
  const [view, setView] = useBoardView('crm.companiesView');

  // Status sorts in its order (Not interested, Lead, Opportunity, Past client, Client), not by name.
  const sortVal = (c: CompanyRecord) => (sort.key === 'status' ? c.statusRank : NUMERIC.has(sort.key) ? (c[sort.key] as number) : String(c[sort.key] || '').toLowerCase());
  const rows = applyFilters(companyRecords(s), fields, filters, { today: todayIso(s.workspace.timezone), fiscalMonth: s.workspace.fiscalMonth })
    .sort((a, b) => {
      const av = sortVal(a);
      const bv = sortVal(b);
      return (av > bv ? 1 : av < bv ? -1 : 0) * sort.dir;
    });

  return (
    <Screen title="Companies">
      <FilterBar
        lead={<ViewToggle value={view} onChange={setView} testId="companies-view" />}
        row={<FilterRow fields={fields} value={filters} onChange={setFilters} people={filterPeople(s, session.userId)} me={session.userId} />}
        meta={rows.length + (rows.length === 1 ? ' company' : ' companies')}
        extra={<DataActions type="companies" count={rows.length} exportCsv={() => companiesCsv(s, rows)} />}
        action={{ label: 'New company', onClick: addCompany }}
      />
      {companyRecords(s).length === 0 ? (
        <EmptyState title="No companies yet" text="Companies are the organisations you sell to. Add one, or import a list from a CSV file." action={{ label: 'Add company', onClick: addCompany }} />
      ) : rows.length === 0 ? (
        <FilterEmpty noun="companies" onClear={() => setFilters(clearAll(fields))} />
      ) : view === 'board' ? (
        <CompaniesBoard rows={rows} />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1580 }}>
            <div className="table-head" style={{ gridTemplateColumns: COLS }}>
              {HEADERS.map((h) => (
                <SortHeader key={h.key} label={h.label} active={sort.key === h.key} dir={sort.dir} onClick={() => toggle(h.key)} />
              ))}
            </div>
            {rows.map((c) => (
              <div key={c.id} className="table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => openCompany(c.id)}>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span style={{ color: 'var(--text-2)' }}>{c.pib || <span className="badge badge-warn">No PIB</span>}</span>
                <span style={{ color: 'var(--text-2)' }} data-testid="company-row-status">
                  {c.status}
                </span>
                <span style={{ color: 'var(--text-2)' }}>{c.ownership}</span>
                <span style={{ color: 'var(--text-2)' }}>{c.industry}</span>
                <span style={{ color: 'var(--text-2)' }}>{c.hq}</span>
                <span style={{ color: 'var(--text-2)' }}>{c.size}</span>
                <span style={{ color: 'var(--text-2)' }}>{c.contactCount}</span>
                <span style={{ color: 'var(--text-2)' }}>{c.oppCount}</span>
                <span style={{ color: 'var(--brand)' }}>{c.valueLabel}</span>
                <span style={{ color: 'var(--text-2)' }}>{c.lifetimeLabel}</span>
                <span style={{ fontSize: 12.5 }}>{c.stageName}</span>
                <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{c.owner}</span>
                <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{c.lastTouch}</span>
                <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{c.source}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Screen>
  );
}

/**
 * The Kanban (CD-359): a column per status. A card dropped on a column further back sets the
 * status back by hand; further on, the company opens with a toast that says how it gets there.
 * A lead without a PIB can't be dragged.
 */
function CompaniesBoard({ rows }: { rows: CompanyRecord[] }) {
  const store = useStore();
  const { s, session } = store;
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<CompanyStatus | null>(null);
  const extras = new Map(s.extraCompanies.map((c) => [c.id, c]));
  const statusOf = (id: string): CompanyStatus => extras.get(id)?.status ?? 'lead';
  const byName = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const month = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: s.workspace.timezone || undefined });

  const drop = (id: string, to: CompanyStatus) => {
    const rec = rows.find((r) => r.id === id);
    const extra = extras.get(id);
    if (!rec) return;
    const status = statusOf(id);
    const out = dropOutcome({ name: rec.name, status, manual: !!extra?.statusManual, missing: status === 'lead' ? companyReadiness(s, id).missing : [] }, to, store.canDelete || extra?.ownerId === session.userId);
    if (out.kind === 'setBack') void store.setCompanyStatus(id, out.to);
    else if (out.kind === 'refuse') store.flash(out.message, 7000);
    else if (out.kind === 'open') {
      store.openCompany(id);
      store.flash(out.message, 9000);
    }
  };

  return (
    <>
      <div className="hint-box" style={{ marginBottom: 14 }}>
        Statuses move by themselves: <b style={{ color: 'var(--ink)' }}>Lead → Opportunity</b> once identity, address and a complete contact are in, <b style={{ color: 'var(--ink)' }}>→ Client</b> when an opportunity is won,{' '}
        <b style={{ color: 'var(--ink)' }}>→ Past client</b> when the last project ends. Drag a card to the left to set it back by hand; dragging to the right opens what is still missing.
      </div>
      <Board tall testId="companies-board">
        {BOARD_STATUSES.map((st, ci) => {
          const cards = byName.filter((c) => statusOf(c.id) === st);
          const open = cards.flatMap((c) => c.leads.filter((l) => l.outcome === 'open'));
          return (
            <BoardColumn
              key={st}
              testId={`companies-col-${st}`}
              name={COMPANY_STATUS_LABELS[st]}
              sub={`${valueTotal(s, open, true)} · ${cards.length}`}
              first={ci === 0}
              last={ci === BOARD_STATUSES.length - 1}
              active={dragOver === st}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOver !== st) setDragOver(st);
              }}
              onDragLeave={() => dragOver === st && setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || dragId;
                setDragId(null);
                setDragOver(null);
                if (id) drop(id, st);
              }}
            >
              {cards.map((c) => {
                const extra = extras.get(c.id);
                const draggable = st !== 'lead' || !!c.pib;
                const ready = st === 'lead' ? companyReadiness(s, c.id) : null;
                const openLeads = c.leads.filter((l) => l.outcome === 'open');
                // The furthest stage of its open opportunities, each in its own funnel.
                const furthest = openLeads
                  .map((l) => {
                    const stages = stagesFor(s, l.segment);
                    const i = stages.findIndex((x) => x.id === l.stage);
                    return { i, name: stages[i]?.name };
                  })
                  .sort((a, b) => b.i - a.i)[0]?.name;
                const since = extra?.statusChangedAt;
                const touch = c.lastTouch === '—' ? 'no touch yet' : `last touch ${c.lastTouch === 'Today' ? 'today' : c.lastTouch}`;
                return (
                  <div
                    key={c.id}
                    data-testid="company-card"
                    data-company={c.id}
                    draggable={draggable}
                    title={draggable ? undefined : 'Add its Company ID (PIB) first'}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', c.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(c.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDragOver(null);
                    }}
                    onClick={() => store.openCompany(c.id)}
                    style={{ ...BOARD_CARD, cursor: draggable ? 'grab' : 'pointer', opacity: dragId === c.id ? 0.45 : 1 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25 }}>{c.name}</span>
                      {st === 'lead' || !c.value ? (
                        c.pib ? (
                          <span style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{c.pib}</span>
                        ) : (
                          <span className="badge badge-warn">No PIB</span>
                        )
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--brand)', whiteSpace: 'nowrap' }}>{c.valueLabel}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{[c.industry, c.hq, c.owner].filter((x) => x && x !== '—').join(' · ')}</div>
                    {ready && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="company-card-readiness">
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-2)' }}>
                          <span>Ready for Opportunity</span>
                          <span>
                            {ready.ready} of {ready.total}
                          </span>
                        </div>
                        <span className="check-bar">
                          <span style={{ width: `${Math.round((ready.ready / ready.total) * 100)}%` }} />
                        </span>
                        {ready.missing.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--warn)' }}>Missing: {c.pib ? ready.missing.join(', ') : 'PIB first'}</span>}
                      </div>
                    )}
                    {(st === 'opportunity' || st === 'client') && openLeads.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className="badge badge-brand" data-testid="company-card-opps">
                          {openLeads.length} {openLeads.length === 1 ? 'opportunity' : 'opportunities'}
                          {furthest ? ` · ${furthest}` : ''}
                        </span>
                      </div>
                    )}
                    {st === 'past_client' && since && !extra?.statusManual && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className="badge badge-neutral">Last project done {month(since)}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      {st !== 'lead' && since ? `${COMPANY_STATUS_LABELS[st]} since ${month(since)}${extra?.statusManual ? ' (set by hand)' : ''} · ${touch}` : touch.charAt(0).toUpperCase() + touch.slice(1)}
                    </div>
                  </div>
                );
              })}
              {cards.length === 0 && <div className="empty-dashed">No companies here</div>}
            </BoardColumn>
          );
        })}
      </Board>
    </>
  );
}
