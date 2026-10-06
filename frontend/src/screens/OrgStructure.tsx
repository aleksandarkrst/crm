import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { XIcon } from '../components/ui';
import { Screen } from '../components/Layout';
import type { ApiEmployee, ApiEmployeeStatus, ApiOrgLevel } from '../lib/api';
import { paths } from '../lib/paths';
import {
  ACCOUNT_LABEL,
  DEFAULT_STATUSES,
  filterEmployees,
  filtersFromParams,
  isAdminOf,
  isFiltered,
  isHrOf,
  isManagerOf,
  ISSUE_FILTERS,
  managerForUnit,
  matchesText,
  pathsTo,
  reportingTree,
  reportsByManager,
  type SortKey,
  sortEmployees,
  STATUS_LABEL,
  type TreeNode,
  unitChart,
  unitForManager,
  unitPathLabel,
} from '../store/people';
import { useStore } from '../store/store';
import { ExportDialog, ManagerDropDialog, MoveDialog, SetManagerDialog, SetUnitDialog } from './org/BulkDialogs';
import { listColumns } from './org/columns';
import { EmployeeList } from './org/EmployeeList';
import { EmployeePicker, MultiSelect, usePhone } from './org/parts';
import { ReportingChart, ReportingList, type TreeView } from './org/ReportingChart';
import { type CompanyNode, type DropTarget, UnitChart, UnitList } from './org/UnitChart';
import { CreateUnitDialog, UnitsPanel } from './org/UnitsPanel';

type Tab = 'chart' | 'list';
type Mode = 'department' | 'reporting';
const SORT_KEYS: SortKey[] = ['name', 'jobTitle', 'unit', 'manager', 'workEmail', 'workPhone', 'startDate', 'type', 'status', 'account'];
// `dept` and `team`: links from before CD-226 (store/people.ts filtersFromParams).
const FILTER_PARAMS = ['q', 'unit', 'dept', 'team', 'manager', 'scope', 'status', 'account', 'issues'];
const toggle = <T,>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const employeesLabel = (n: number) => (n === 1 ? '1 employee' : `${n} employees`);

type Dialog =
  | { kind: 'units' }
  | { kind: 'create'; level: ApiOrgLevel }
  | { kind: 'org' }
  | { kind: 'manager' }
  | { kind: 'export'; selected: boolean }
  | { kind: 'move'; employee: ApiEmployee; target: DropTarget }
  | { kind: 'boss'; employee: ApiEmployee; manager: ApiEmployee }
  | null;

/** The header's "Create" (Admins, CD-226): "New <level>" for each organization level. */
function CreateMenu({ levels, onPick }: { levels: ApiOrgLevel[]; onPick: (level: ApiOrgLevel) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);
  return (
    <div className="org-multi" ref={ref}>
      <button type="button" className="btn btn-primary" data-testid="org-create" aria-expanded={open} disabled={!levels.length} onClick={() => setOpen(!open)}>
        Create
      </button>
      {open && (
        <div className="org-multi-pop org-create-pop" role="menu">
          {levels.map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitem"
              className="org-picker-item"
              data-testid={'org-create-' + l.name}
              onClick={() => {
                setOpen(false);
                onPick(l);
              }}
            >
              New {l.name.toLowerCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Org structure (CD-137, spec 5): the chart (by department or by reporting lines) and the list of
 * employees, with search and filters shared by both. The tab, the chart mode, the filters and the
 * list's sort live in the URL, so links can be shared. Everyone sees the directory; Admins also get
 * data issues, inactive people, bulk actions, export and drag and drop (CD-225: only Admins do HR
 * work). "By unit" hangs the organization's units below a company node with the CEO (CD-225,
 * CD-226); Admins create units from the header's Create menu, and drag a person onto a unit (move
 * them) or onto another person (make them the manager) in both charts.
 *
 * Only members and people with a pending invitation are shown (CD-226: the API leaves out the
 * rest): people join by invitation from Settings → Team, so there is no Add employee or Import.
 */
export function OrgStructure() {
  const { s, people: actions, flash, session, setWorkspace, canEditWorkspace } = useStore();
  const { employees, levels, units, access, loaded, loading, error } = s.people;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const phone = usePhone();

  const watch = actions.watch;
  useEffect(() => watch(), [watch]);

  // ------------------------------------------------------------ state from the URL
  const tab: Tab = params.get('tab') === 'list' ? 'list' : 'chart';
  const mode: Mode = params.get('mode') === 'reporting' ? 'reporting' : 'department';
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const sortKey = SORT_KEYS.find((k) => k === params.get('sort')) ?? 'name';
  const sortDir: 1 | -1 = params.get('dir') === 'desc' ? -1 : 1;

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === '') next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // The search box answers each key at once; the URL (and the filtering) follows after a short pause.
  // A change of the URL's search from elsewhere (Clear filters, Back) shows in the box.
  const [searchText, setSearchText] = useState(filters.q);
  const [typing, setTyping] = useState(false);
  const [seenQ, setSeenQ] = useState(filters.q);
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    if (!typing) setSearchText(filters.q);
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const typeSearch = (text: string) => {
    setSearchText(text);
    setTyping(true);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setTyping(false);
      update({ q: text });
    }, 150);
  };
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const hr = isHrOf(access);
  const admin = isAdminOf(access);
  const me = access?.employeeId ?? null;

  // ------------------------------------------------------------ filtering
  const filtered = useMemo(() => filterEmployees(employees, filters, access, units), [employees, filters, access, units]);
  const dirty = isFiltered(filters);
  // The chart never shows inactive people (spec 5.3).
  const chartPeople = useMemo(() => employees.filter((e) => e.status !== 'inactive'), [employees]);
  const chartMatches = useMemo(() => filtered.filter((e) => e.status !== 'inactive'), [filtered]);

  const rows = useMemo(() => sortEmployees(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const columns = useMemo(() => listColumns(access, units), [access, units]);
  const count = tab === 'list' ? rows.length : chartMatches.length;

  // ------------------------------------------------------------ the charts
  // The CEO (CD-225): a workspace setting, shown in the company node above the units.
  const ceoId = s.workspace.ceoEmployeeId;
  const ceo = useMemo(() => chartPeople.find((e) => e.id === ceoId) ?? null, [chartPeople, ceoId]);
  const chart = useMemo(
    () => (tab === 'chart' && mode === 'department' ? unitChart(chartMatches, chartPeople, levels, units, !dirty, ceo?.id ?? null) : { roots: [], noUnit: [] }),
    [tab, mode, chartMatches, chartPeople, levels, units, dirty, ceo],
  );
  const roots = useMemo(() => (tab === 'chart' && mode === 'reporting' ? reportingTree(chartPeople, ceo?.id ?? null) : []), [tab, mode, chartPeople, ceo]);
  const company: CompanyNode = {
    name: s.workspace.name || session.tenant.name,
    ceo,
    setCeo: admin && canEditWorkspace ? (id) => setWorkspace({ ceoEmployeeId: id }) : null,
    employees: chartPeople,
  };
  const q = filters.q.trim();
  const hits = useMemo(() => (q ? new Set(chartPeople.filter((e) => matchesText(e, q, hr)).map((e) => e.id)) : null), [q, chartPeople, hr]);
  const searchPath = useMemo(() => (hits ? pathsTo(chartPeople, hits) : new Set<string>()), [hits, chartPeople]);
  const matchIds = useMemo(() => (dirty ? new Set(chartMatches.map((e) => e.id)) : null), [dirty, chartMatches]);
  // Opened and closed nodes; a new search starts from its own expansion.
  const [opened, setOpened] = useState<{ q: string; map: Map<string, boolean> }>({ q: '', map: new Map() });
  const overrides = opened.q === q ? opened.map : null;
  const view: TreeView = {
    isOpen: (n: TreeNode) => overrides?.get(n.employee.id) ?? (searchPath.has(n.employee.id) || n.depth < 2),
    toggle: (n: TreeNode) =>
      setOpened((o) => {
        const map = new Map(o.q === q ? o.map : []);
        map.set(n.employee.id, !view.isOpen(n));
        return { q, map };
      }),
    matches: matchIds,
    hits,
    onOpen: (id) => navigate(paths.employee(id)),
    hr,
    onDropOnPerson: !phone && hr ? (id, managerId) => onDropOnPerson(id, managerId) : null,
  };

  // ------------------------------------------------------------ selection and bulk actions
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const selection = hr
    ? {
        selected,
        toggle: (id: string) => setSelected((cur) => new Set(toggle([...cur], id))),
        setAll: (on: boolean) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set()),
      }
    : null;
  const [dialog, setDialog] = useState<Dialog>(null);
  // Phones: the filters fold under a button (the search stays).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = [filters.unitIds.length, filters.managerId, filters.accounts.length, filters.issues.length, filters.statuses.join() !== DEFAULT_STATUSES.join()].filter(Boolean).length;
  const open = useCallback((id: string) => navigate(paths.employee(id)), [navigate]);
  // Desktop, Admins (spec 9.3).
  const canDrag = !phone && hr ? () => true : null;
  const onDrop = (id: string, target: DropTarget) => {
    const employee = employees.find((e) => e.id === id);
    if (!employee || employee.unitId === target.unitId) return;
    setDialog({ kind: 'move', employee, target });
  };
  // A person dropped on another person: the second becomes the first one's manager (CD-226).
  function onDropOnPerson(id: string, managerId: string) {
    const employee = employees.find((e) => e.id === id);
    const manager = employees.find((e) => e.id === managerId);
    if (!employee || !manager || id === managerId || employee.managerId === managerId) return;
    setDialog({ kind: 'boss', employee, manager });
  }
  const nameOf = (id: string | null) => (id ? (employees.find((e) => e.id === id)?.fullName ?? null) : null);
  // `?new=unit` (a link to "Create"): the dialog for the top level.
  const wantsNew = params.get('new') === 'unit';
  useEffect(() => {
    if (!wantsNew || !hr || !levels.length) return;
    setDialog({ kind: 'create', level: levels[0]! });
    update({ new: null });
  }, [wantsNew, hr, levels, update]);

  // ------------------------------------------------------------ filter options
  // One "Unit" filter grouped by level, each unit with its path (CD-226).
  const unitOptions = useMemo(
    () =>
      [...levels]
        .sort((a, b) => a.position - b.position)
        .flatMap((l) =>
          units
            .filter((u) => u.levelId === l.id)
            .map((u) => ({ value: u.id, label: unitPathLabel(units, u.id), group: l.name }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        ),
    [levels, units],
  );
  const managers = useMemo(() => {
    const byManager = reportsByManager(employees);
    return employees.filter((e) => e.status !== 'inactive' && (byManager.has(e.id) || e.id === filters.managerId));
  }, [employees, filters.managerId]);
  const statusChoices: ApiEmployeeStatus[] = hr ? ['active', 'leaving', 'inactive'] : ['active', 'leaving'];


  return (
    <Screen title="Org structure">
      <div className="org" data-testid="org">
        <div className="org-toolbar">
          <div className="cal-views" role="tablist" aria-label="View">
            {(['chart', 'list'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} data-testid={'org-tab-' + t} className={tab === t ? 'on' : ''} onClick={() => update({ tab: t === 'chart' ? null : t })}>
                {t === 'chart' ? 'Chart' : 'List'}
              </button>
            ))}
          </div>
          {tab === 'chart' && (
            <div className="cal-views" role="tablist" aria-label="Chart">
              {(['department', 'reporting'] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} data-testid={'org-mode-' + m} className={mode === m ? 'on' : ''} onClick={() => update({ mode: m === 'department' ? null : m })}>
                  {m === 'department' ? 'By unit' : 'Reporting lines'}
                </button>
              ))}
            </div>
          )}
          <span className="org-count-label" data-testid="org-count" aria-live="polite">
            {loaded ? employeesLabel(count) : loading ? 'Loading…' : ''}
          </span>
          <div className="org-actions">
            {/* Admins: the units (CD-226) and Create ("New <level>"). */}
            {hr && (
              <button type="button" className="btn-plain" data-testid="org-units" onClick={() => setDialog({ kind: 'units' })}>
                Organization
              </button>
            )}
            {hr && <CreateMenu levels={[...levels].sort((a, b) => a.position - b.position)} onPick={(level) => setDialog({ kind: 'create', level })} />}
            {hr && tab === 'list' && (
              <button type="button" className="btn-plain" data-testid="org-export" disabled={!rows.length} onClick={() => setDialog({ kind: 'export', selected: false })}>
                Export CSV
              </button>
            )}
          </div>
        </div>

        <div className="cal-filters org-filters" data-testid="org-filters">
          <div className="org-search">
            <input
              type="search"
              className="form-input"
              data-testid="org-search"
              aria-label="Search employees"
              placeholder={hr ? 'Search name, job title, email, number' : 'Search name, job title, email'}
              value={searchText}
              onChange={(e) => typeSearch(e.target.value)}
            />
          </div>
          {phone && (
            <button type="button" className={'cal-pill' + (filtersOpen || activeFilters ? ' on' : '')} aria-expanded={filtersOpen} data-testid="org-filters-toggle" onClick={() => setFiltersOpen(!filtersOpen)}>
              Filters{activeFilters ? ` · ${activeFilters}` : ''}
            </button>
          )}
          {(!phone || filtersOpen) && (
            <>
          <MultiSelect
            label="Unit"
            testId="org-filter-unit"
            options={unitOptions}
            value={filters.unitIds}
            onChange={(ids) => update({ unit: ids.join(','), dept: null, team: null })}
            empty="No units yet"
            emptyAction={
              hr && levels.length
                ? (close) => (
                    <button
                      type="button"
                      className="org-multi-clear"
                      data-testid="org-filter-add-unit"
                      onClick={() => {
                        close();
                        setDialog({ kind: 'create', level: [...levels].sort((a, b) => a.position - b.position)[0]! });
                      }}
                    >
                      Create a unit
                    </button>
                  )
                : undefined
            }
          />
          {/* Every filter is a dropdown (CD-225). Manager: type a name, or "Me"; the scope once one is chosen. */}
          <div className="org-manager-filter">
            <EmployeePicker employees={managers} value={filters.managerId} onChange={(id) => update({ manager: id })} placeholder="Manager" testId="org-filter-manager" none="Any manager" me={me && isManagerOf(access) ? me : null} />
            {filters.managerId && (
              <select className="cal-select org-scope" aria-label="Reports" data-testid="org-filter-scope" value={filters.managerScope} onChange={(e) => update({ scope: e.target.value === 'indirect' ? 'indirect' : null })}>
                <option value="direct">Direct reports</option>
                <option value="indirect">Including indirect</option>
              </select>
            )}
          </div>
          <MultiSelect
            label="Status"
            testId="org-filter-status"
            options={statusChoices.map((st) => ({ value: st, label: STATUS_LABEL[st] }))}
            value={filters.statuses}
            onChange={(v) => {
              const next = statusChoices.filter((st) => v.includes(st));
              update({ status: next.join(',') === DEFAULT_STATUSES.join(',') ? null : next.join(',') || 'none' });
            }}
          />
          {admin && (
            <MultiSelect
              label="Account"
              testId="org-filter-account"
              options={(['linked', 'invited'] as const).map((a) => ({ value: a, label: ACCOUNT_LABEL[a] }))}
              value={filters.accounts}
              onChange={(v) => update({ account: v.join(',') })}
            />
          )}
          {hr && <MultiSelect label="Data issues" testId="org-filter-issues" options={ISSUE_FILTERS} value={filters.issues} onChange={(v) => update({ issues: v.join(',') })} />}
            </>
          )}
          {dirty && (
            <button type="button" className="btn-plain" data-testid="org-filter-clear" onClick={() => update(Object.fromEntries(FILTER_PARAMS.map((k) => [k, null])))}>
              <XIcon size={11} /> Clear filters
            </button>
          )}
        </div>

        {tab === 'list' && selection && selectedRows.length > 0 && (
          <div className="org-bulk" role="toolbar" aria-label="Selected employees" data-testid="org-bulk">
            <span className="org-bulk-count">{selectedRows.length} selected</span>
            <button type="button" className="btn-plain" data-testid="org-bulk-unit" onClick={() => setDialog({ kind: 'org' })}>
              Set unit
            </button>
            <button type="button" className="btn-plain" data-testid="org-bulk-manager" onClick={() => setDialog({ kind: 'manager' })}>
              Set manager
            </button>
            <button type="button" className="btn-plain" data-testid="org-bulk-export" onClick={() => setDialog({ kind: 'export', selected: true })}>
              Export selected
            </button>
            <button type="button" className="btn-plain org-bulk-clear" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        )}

        {error && !loaded ? (
          <div className="empty-block" data-testid="org-error">
            <div className="empty-block-title">Could not load the employees</div>
            <div className="empty-block-text">{error}</div>
            <div className="empty-block-actions">
              <button type="button" className="btn btn-primary" onClick={() => void actions.load()}>
                Try again
              </button>
            </div>
          </div>
        ) : !loaded ? (
          <div className="empty-state">Loading…</div>
        ) : count === 0 ? (
          // Empty states point to the next step (CD-224).
          <div className="empty-block" data-testid="org-empty">
            <div className="empty-block-title">{dirty ? 'Nobody matches these filters' : 'No employees yet'}</div>
            <div className="empty-block-text">{dirty ? 'Change or clear the filters to see more people.' : 'People appear here once they are invited in Settings → Team.'}</div>
            <div className="empty-block-actions">
              {dirty && (
                <button type="button" className="btn btn-secondary" onClick={() => update(Object.fromEntries(FILTER_PARAMS.map((k) => [k, null])))}>
                  Clear filters
                </button>
              )}
              {admin && !dirty && (
                <button type="button" className="btn btn-primary" onClick={() => navigate(paths.settings('team') + '?invite=1')}>
                  Invite people
                </button>
              )}
            </div>
          </div>
        ) : tab === 'list' ? (
          <EmployeeList rows={rows} columns={columns} sort={{ key: sortKey, dir: sortDir }} onSort={(k) => update({ sort: k === 'name' ? null : k, dir: k === sortKey && sortDir === 1 ? 'desc' : null })} onOpen={open} selection={selection} phone={phone} />
        ) : mode === 'department' ? (
          <>
            {hr && !dirty && units.length === 0 && levels.length > 0 && (
              <div className="hint-box" data-testid="org-no-units" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ flex: 1, minWidth: 200 }}>No units yet. Group people into {levels[0]!.name.toLowerCase()}s such as Sales or Service.</span>
                <button type="button" className="btn btn-primary" data-testid="org-add-unit" onClick={() => setDialog({ kind: 'create', level: levels[0]! })}>
                  New {levels[0]!.name.toLowerCase()}
                </button>
              </div>
            )}
            {phone ? (
              <UnitList company={company} chart={chart} onOpen={open} hr={hr} />
            ) : (
              <UnitChart company={company} chart={chart} onOpen={open} hr={hr} canDrag={canDrag} onDrop={onDrop} onDropOnPerson={onDropOnPerson} />
            )}
          </>
        ) : phone ? (
          <ReportingList roots={roots} view={view} />
        ) : (
          <ReportingChart roots={roots} view={view} focusKey={q} />
        )}
      </div>

      {dialog?.kind === 'units' && <UnitsPanel onClose={() => setDialog(null)} />}
      {dialog?.kind === 'create' && <CreateUnitDialog level={dialog.level} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'org' && (
        <SetUnitDialog count={selectedRows.length} units={units} onClose={() => setDialog(null)} onSave={(unitId) => actions.bulkUpdate({ employeeIds: selectedRows.map((r) => r.id), unitId }, 'Unit set for {n}')} />
      )}
      {dialog?.kind === 'manager' && (
        <SetManagerDialog
          count={selectedRows.length}
          employees={employees}
          exclude={new Set(selectedRows.map((r) => r.id))}
          onClose={() => setDialog(null)}
          onSave={(managerId) => actions.bulkUpdate({ employeeIds: selectedRows.map((r) => r.id), managerId }, 'Manager set for {n}')}
        />
      )}
      {dialog?.kind === 'export' && (
        <ExportDialog rows={dialog.selected ? selectedRows : rows} columns={columns} selected={dialog.selected} loadPersonal={actions.exportPersonal} onClose={() => setDialog(null)} onDone={(msg) => flash(msg)} />
      )}
      {dialog?.kind === 'move' &&
        (() => {
          const { employee, target } = dialog;
          const next = target.unitId ? managerForUnit(units, target.unitId, employee.id, ceo?.id ?? null) : null;
          const label = target.unitId ? unitPathLabel(units, target.unitId, target.label) : 'No unit';
          return (
            <MoveDialog
              employee={employee}
              target={label}
              from={unitPathLabel(units, employee.unitId, employee.unitName)}
              manager={next && next !== employee.managerId ? nameOf(next) : null}
              onClose={() => setDialog(null)}
              onSave={() => actions.bulkUpdate({ employeeIds: [employee.id], unitId: target.unitId }, `${employee.fullName} moved to ${label}`)}
            />
          );
        })()}
      {dialog?.kind === 'boss' &&
        (() => {
          const { employee, manager } = dialog;
          const leads = units.some((u) => u.leadEmployeeId === employee.id);
          const next = leads ? null : unitForManager(units, employees, manager.id);
          return (
            <ManagerDropDialog
              employee={employee}
              manager={manager}
              unit={next && next !== employee.unitId ? unitPathLabel(units, next) : null}
              onClose={() => setDialog(null)}
              onSave={() => actions.bulkUpdate({ employeeIds: [employee.id], managerId: manager.id }, `${manager.fullName} is now ${employee.fullName}'s manager`)}
            />
          );
        })()}
    </Screen>
  );
}
