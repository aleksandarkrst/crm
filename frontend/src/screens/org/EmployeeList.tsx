import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiEmployee } from '../../lib/api';
import { paths } from '../../lib/paths';
import { Avatar } from '../../components/ui';
import { initialsOfEmployee, type SortKey } from '../../store/people';
import type { Column } from './columns';

/** Row heights: the table's rows and the phones' cards (fixed, so only rows on screen are drawn). */
const ROW = 44;
const CARD = 66;
/** Rows drawn above and below the visible ones. */
const OVERSCAN = 12;

/** Which rows are on screen in a scrolling box of fixed-height rows. */
function useWindow(count: number, height: number) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setView((v) => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight }));
    read();
    el.addEventListener('scroll', read, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', read);
      ro?.disconnect();
    };
  }, []);
  const first = Math.max(0, Math.floor(view.top / height) - OVERSCAN);
  const last = Math.min(count, Math.ceil((view.top + view.height) / height) + OVERSCAN);
  return { box, first, last };
}

interface Props {
  rows: ApiEmployee[];
  columns: Column[];
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  onOpen: (id: string) => void;
  /** Ticking rows for bulk actions (Administration and Admin); null: no checkboxes. */
  selection: { selected: ReadonlySet<string>; toggle: (id: string) => void; setAll: (on: boolean) => void } | null;
  phone: boolean;
}

/**
 * The List tab (spec 5.4): every filtered employee without paging, virtualised (only the rows on
 * screen are in the page, so 5,000 rows stay fast). Sortable columns; the header stays on top while
 * the rows scroll. On phones each row is a card with name, job title and team.
 */
export function EmployeeList(props: Props) {
  return props.phone ? <CardList {...props} /> : <Table {...props} />;
}

function Table({ rows, columns, sort, onSort, onOpen, selection }: Props) {
  const { box, first, last } = useWindow(rows.length, ROW);
  const grid = (selection ? '36px ' : '') + columns.map((c) => c.width).join(' ');
  const allOn = !!selection && rows.length > 0 && rows.every((r) => selection.selected.has(r.id));
  return (
    <div className="org-list card" data-testid="org-list">
      <div className="org-list-scroll" ref={box}>
        <div className="org-list-inner">
          <div className="table-head org-list-head" role="row" style={{ gridTemplateColumns: grid }}>
            {selection && (
              <span className="org-check">
                <input type="checkbox" aria-label="Select all" data-testid="org-select-all" checked={allOn} onChange={(e) => selection.setAll(e.target.checked)} />
              </span>
            )}
            {columns.map((c) =>
              c.sortable ? (
                <button key={c.key} type="button" className="sort-btn" data-testid={'org-sort-' + c.key} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} onClick={() => onSort(c.key as SortKey)} style={{ color: sort.key === c.key ? 'var(--ink)' : 'var(--text-2)' }}>
                  <span>{c.label}</span>
                  <span style={{ fontSize: 10 }}>{sort.key === c.key ? (sort.dir === 1 ? '↑' : '↓') : ''}</span>
                </button>
              ) : (
                <span key={c.key} className="th">
                  {c.label}
                </span>
              ),
            )}
          </div>
          {rows.length === 0 && <div className="empty-state">Nobody matches these filters.</div>}
          <div className="org-list-body" style={{ height: rows.length * ROW }}>
            {rows.slice(first, last).map((e, i) => {
              const at = first + i;
              const on = !!selection?.selected.has(e.id);
              return (
                <div
                  key={e.id}
                  className={'table-row clickable org-list-row' + (on ? ' is-selected' : '')}
                  data-testid="org-row"
                  data-id={e.id}
                  role="row"
                  style={{ gridTemplateColumns: grid, top: at * ROW, height: ROW }}
                  onClick={(ev) => {
                    if ((ev.target as HTMLElement).closest('input, a')) return;
                    onOpen(e.id);
                  }}
                >
                  {selection && (
                    <span className="org-check">
                      <input type="checkbox" aria-label={`Select ${e.fullName}`} data-testid="org-select" checked={on} onChange={() => selection.toggle(e.id)} />
                    </span>
                  )}
                  {columns.map((c) => (
                    <span key={c.key} className="org-cell" data-col={c.key}>
                      {c.key === 'name' ? (
                        <Link to={paths.employee(e.id)} className="org-name-link">
                          {c.cell(e)}
                        </Link>
                      ) : (
                        c.cell(e)
                      )}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CardList({ rows, onOpen }: Props) {
  const { box, first, last } = useWindow(rows.length, CARD);
  return (
    <div className="org-list card" data-testid="org-list">
      <div className="org-list-scroll" ref={box}>
        {rows.length === 0 && <div className="empty-state">Nobody matches these filters.</div>}
        <div className="org-list-body" style={{ height: rows.length * CARD }}>
          {rows.slice(first, last).map((e, i) => (
            <button key={e.id} type="button" className="org-card-row" data-testid="org-row" data-id={e.id} style={{ top: (first + i) * CARD, height: CARD }} onClick={() => onOpen(e.id)}>
              <Avatar initials={initialsOfEmployee(e)} size={30} font={11} />
              <span className="org-person-text">
                <span className="org-person-name">{e.fullName}</span>
                <span className="org-person-sub">{[e.jobTitle, e.teamName ?? e.departmentName].filter(Boolean).join(' · ') || '—'}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
