import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Board, BOARD_CARD, BoardColumn } from '../components/Board';
import { DataActions } from '../components/DataActions';
import { FilterRow } from '../components/FilterRow';
import { Icon } from '../components/icons';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { BOARD_STATUSES, dropOutcome } from '../store/companyBoard';
import { incompleteNote, LIST_STATUS_ORDER, lastActivityText, matchesSearch } from '../store/companyList';
import { companiesCsv } from '../store/exportCsv';
import { companyPageFields, filterPeople } from '../store/filterFields';
import { applyFilters, clearAll } from '../store/filters';
import { COMPANY_STATUS_LABELS, companyReadiness, type CompanyRecord, companyRecords, initialsOf, isoInZone, stagesFor, todayIso, valueTotal } from '../store/selectors';
import { useStore } from '../store/store';
import type { CompanyStatus } from '../store/types';
import { usePageFilters } from '../store/usePageFilters';

/** The status tags (CD-530 colours): Lead amber, Opportunity blue, Client green, Past client grey, Not interested red. */
const TAG: Record<CompanyStatus, string> = { lead: 'amber', opportunity: 'blue', client: 'green', past_client: '', not_interested: 'red' };

type Key = 'name' | 'status' | 'owner' | 'open' | 'lifetime' | 'contacts' | 'last';
const COLUMNS: { key: Key; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Company' },
  { key: 'status', label: 'Status' },
  { key: 'owner', label: 'Company owner' },
  { key: 'open', label: 'Open value', num: true },
  { key: 'lifetime', label: 'Lifetime value', num: true },
  { key: 'contacts', label: 'Contacts', num: true },
  { key: 'last', label: 'Last activity' },
];
/** Numbers and dates sort highest (newest) first on the first click. */
const DESC_FIRST = new Set<Key>(['open', 'lifetime', 'contacts', 'last']);

interface Row extends CompanyRecord {
  /** "3 of 7 ready" for a lead (CD-533), and its amber note when its PIB, address or contact is missing. */
  ready: string;
  note: string | null;
  lastText: string;
}

/**
 * Companies (CD-533): every company with its automatic status, owner and value, in a glass table.
 * The pinned filters are Status, Company owner and Industry, "+ Filter" adds any other; the top bar
 * search filters the table as you type. By default clients come first, then opportunities, past
 * clients, leads and not interested, each by open value; a column header sorts by that column.
 */
export function Companies() {
  const { s, set, addCompany, openCompany, session } = useStore();
  const fields = useMemo(() => companyPageFields(s), [s]);
  const [filters, setFilters] = usePageFilters('companies', clearAll(fields));
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 } | null>(null);
  // The search belongs to this page: leaving it clears the top bar.
  useEffect(() => () => set({ listSearch: '' }), [set]);

  const tz = s.workspace.timezone;
  const today = todayIso(tz);
  const all = companyRecords(s);
  const rows: Row[] = applyFilters(all, fields, filters, { today, fiscalMonth: s.workspace.fiscalMonth })
    .filter((c) => matchesSearch(s.listSearch, [c.name, c.pib, c.industry, c.city, c.companyOwner]))
    .map((c) => {
      const r = c.statusKey === 'lead' ? companyReadiness(s, c.id) : null;
      return {
        ...c,
        ready: r ? `${r.ready} of ${r.total} ready` : '',
        note: r ? incompleteNote({ pib: !c.pib, address: r.missing.includes('address'), contact: r.missing.includes('a contact') }) : null,
        lastText: lastActivityText(c.lastActivity && { channel: c.lastActivity.channel, day: isoInZone(new Date(c.lastActivity.at), tz) }, today),
      };
    });
  const value = (c: Row, key: Key): string | number => {
    if (key === 'name') return c.name.toLowerCase();
    if (key === 'status') return LIST_STATUS_ORDER[c.statusKey];
    if (key === 'owner') return c.companyOwner.toLowerCase();
    if (key === 'open') return c.value;
    if (key === 'lifetime') return c.lifetimeValue;
    if (key === 'contacts') return c.contactCount;
    return c.lastActivity?.at ?? '';
  };
  const cmp = (a: string | number, b: string | number) => (a > b ? 1 : a < b ? -1 : 0);
  rows.sort((a, b) =>
    sort
      ? cmp(value(a, sort.key), value(b, sort.key)) * sort.dir || a.name.localeCompare(b.name)
      : LIST_STATUS_ORDER[a.statusKey] - LIST_STATUS_ORDER[b.statusKey] || b.value - a.value || a.name.localeCompare(b.name),
  );
  const toggle = (key: Key) => setSort((cur) => (cur?.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: DESC_FIRST.has(key) ? -1 : 1 }));
  const clear = () => {
    setFilters(clearAll(fields));
    set({ listSearch: '' });
  };

  return (
    <Screen title="Companies">
      <div className="ov-fbar cl-bar">
        <FilterRow fields={fields} value={filters} onChange={setFilters} people={filterPeople(s, session.userId)} me={session.userId} />
        <span className="cl-actions">
          <DataActions type="companies" count={rows.length} exportCsv={() => companiesCsv(s, rows)} />
          <button type="button" className="gs-btn primary cl-new" data-testid="companies-new" onClick={addCompany}>
            <Icon name="plus" size={14} />
            New company
          </button>
        </span>
      </div>

      <section className="gs-glass cl-card">
        {all.length === 0 ? (
          <div className="cl-empty" data-testid="companies-empty">
            <span>No companies yet. Add the first one.</span>
            <button type="button" className="gs-btn primary" onClick={addCompany}>
              <Icon name="plus" size={14} />
              New company
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="cl-empty" data-testid="companies-no-match">
            <span>No companies match these filters.</span>
            <button type="button" className="cl-link" onClick={clear}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="cl-scroll">
            <table className="cl-table" data-testid="companies-table">
              <thead>
                <tr>
                  {COLUMNS.map((col) => {
                    const on = sort?.key === col.key;
                    return (
                      <th key={col.key} className={col.num ? 'num' : undefined} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                        <button type="button" className={'cl-sort' + (on ? ' on' : '')} onClick={() => toggle(col.key)}>
                          {col.label}
                          {on && <span aria-hidden="true">{sort.dir === 1 ? '↑' : '↓'}</span>}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="cl-row" data-testid="company-row" onClick={() => openCompany(c.id)}>
                    <td>
                      {/* The row opens the company; the link is there for keyboards and a new tab. */}
                      <Link to={paths.company(c.id)} className="cl-co" onClick={(e) => e.stopPropagation()}>
                        <span className="cl-tile" aria-hidden="true">
                          {initialsOf(c.name)}
                        </span>
                        <span className="cl-text">
                          <b>{c.name}</b>
                          {(c.industry || c.city) && <span className="cl-sub">{[c.industry, c.city].filter(Boolean).join(', ')}</span>}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="cl-status">
                        <span className={'gs-badge ' + TAG[c.statusKey]} data-testid="company-row-status">
                          {COMPANY_STATUS_LABELS[c.statusKey]}
                        </span>
                        {c.ready && <span className="cl-sub">{c.ready}</span>}
                      </span>
                    </td>
                    <td>
                      {c.companyOwner ? (
                        <span className="cl-owner">
                          <span className="gs-face ov-face-sm" aria-hidden="true">
                            {initialsOf(c.companyOwner)}
                          </span>
                          {c.companyOwner}
                        </span>
                      ) : (
                        <span className="cl-sub">No owner</span>
                      )}
                    </td>
                    <td className="num">{c.value ? <b>{c.valueLabel}</b> : <span className="cl-none" role="img" aria-label="None" />}</td>
                    <td className="num">{c.lifetimeLabel}</td>
                    <td className="num">{c.contactCount}</td>
                    <td>
                      <span className="cl-text">
                        <span className={c.lastActivity ? undefined : 'cl-sub'}>{c.lastText}</span>
                        {c.note && <span className="cl-note">{c.note}</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Screen>
  );
}

/**
 * The Kanban (CD-359): a column per status. A card dropped on a column further back sets the
 * status back by hand; further on, the company opens with a toast that says how it gets there.
 * A lead without a PIB can't be dragged.
 */
// Exported only while it is switched off (unused otherwise).
export function CompaniesBoard({ rows }: { rows: CompanyRecord[] }) {
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
        Statuses move by themselves: <b style={{ color: 'var(--ink)' }}>Lead → Opportunity</b> once identity, address, owner and a complete contact are in, <b style={{ color: 'var(--ink)' }}>→ Client</b> when an opportunity is won,{' '}
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
                          <span className="badge badge-warn">No company ID</span>
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
                        {ready.missing.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--warn)' }}>Missing: {c.pib ? ready.missing.join(', ') : 'Company ID first'}</span>}
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
