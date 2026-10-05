import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { XIcon } from '../components/ui';
import { Screen } from '../components/Layout';
import type { ApiEmployee, ApiEmployeeStatus } from '../lib/api';
import { paths } from '../lib/paths';
import {
  ACCOUNT_LABEL,
  DEFAULT_STATUSES,
  departmentChart,
  filterEmployees,
  filtersFromParams,
  isAdminOf,
  isFiltered,
  isHrOf,
  isManagerOf,
  ISSUE_FILTERS,
  matchesText,
  pathsTo,
  reportingTree,
  reportsByManager,
  type SortKey,
  sortEmployees,
  STATUS_LABEL,
  type TreeNode,
} from '../store/people';
import { useStore } from '../store/store';
import { ExportDialog, MoveDialog, SetManagerDialog, SetOrgDialog } from './org/BulkDialogs';
import { listColumns } from './org/columns';
import { DepartmentChart, DepartmentList, type DropTarget } from './org/DepartmentChart';
import { EmployeeList } from './org/EmployeeList';
import { EmployeePicker, MultiSelect, usePhone } from './org/parts';
import { ReportingChart, ReportingList, type TreeView } from './org/ReportingChart';

type Tab = 'chart' | 'list';
type Mode = 'department' | 'reporting';
const SORT_KEYS: SortKey[] = ['name', 'jobTitle', 'department', 'team', 'manager', 'workEmail', 'workPhone', 'startDate', 'type', 'status', 'account'];
const FILTER_PARAMS = ['q', 'dept', 'team', 'manager', 'scope', 'status', 'account', 'issues'];
const toggle = <T,>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const employeesLabel = (n: number) => (n === 1 ? '1 employee' : `${n} employees`);

type Dialog = { kind: 'org' } | { kind: 'manager' } | { kind: 'export'; selected: boolean } | { kind: 'move'; employee: ApiEmployee; target: DropTarget } | null;

/**
 * Org structure (CD-137, spec 5): the chart (by department or by reporting lines) and the list of
 * employees, with search and filters shared by both. The tab, the chart mode, the filters and the
 * list's sort live in the URL, so links can be shared. Everyone sees the directory; Administration
 * and Admin also get data issues, inactive people, bulk actions, export and drag-to-move.
 */
export function OrgStructure() {
  const { s, people: actions, flash } = useStore();
  const { employees, departments, teams, access, loaded, loading, error } = s.people;
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
  const filtered = useMemo(() => filterEmployees(employees, filters, access), [employees, filters, access]);
  const dirty = isFiltered(filters);
  // The chart never shows inactive people (spec 5.3).
  const chartPeople = useMemo(() => employees.filter((e) => e.status !== 'inactive'), [employees]);
  const chartMatches = useMemo(() => filtered.filter((e) => e.status !== 'inactive'), [filtered]);

  const rows = useMemo(() => sortEmployees(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const columns = useMemo(() => listColumns(access), [access]);
  const count = tab === 'list' ? rows.length : chartMatches.length;

  // ------------------------------------------------------------ the charts
  const blocks = useMemo(() => (tab === 'chart' && mode === 'department' ? departmentChart(chartMatches, chartPeople, departments, teams, !dirty) : []), [tab, mode, chartMatches, chartPeople, departments, teams, dirty]);
  const roots = useMemo(() => (tab === 'chart' && mode === 'reporting' ? reportingTree(chartPeople) : []), [tab, mode, chartPeople]);
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
  const activeFilters = [filters.departmentIds.length, filters.teamIds.length, filters.managerId, filters.accounts.length, filters.issues.length, filters.statuses.join() !== DEFAULT_STATUSES.join()].filter(Boolean).length;
  const open = useCallback((id: string) => navigate(paths.employee(id)), [navigate]);
  // Desktop, Administration and Admin; Administration doesn't move themselves (spec 9.3).
  const canDrag = !phone && hr ? (e: ApiEmployee) => admin || e.id !== me : null;
  const onDrop = (id: string, target: DropTarget) => {
    const employee = employees.find((e) => e.id === id);
    if (!employee) return;
    if (employee.departmentId === target.departmentId && employee.teamId === target.teamId) return;
    setDialog({ kind: 'move', employee, target });
  };

  // ------------------------------------------------------------ filter options
  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name }));
  const teamOptions = teams
    .filter((t) => !filters.departmentIds.length || filters.departmentIds.includes(t.departmentId))
    .map((t) => ({ value: t.id, label: filters.departmentIds.length === 1 ? t.name : `${t.name} (${departments.find((d) => d.id === t.departmentId)?.name ?? '—'})` }));
  const managers = useMemo(() => {
    const byManager = reportsByManager(employees);
    return employees.filter((e) => e.status !== 'inactive' && (byManager.has(e.id) || e.id === filters.managerId));
  }, [employees, filters.managerId]);
  const statusChoices: ApiEmployeeStatus[] = hr ? ['active', 'leaving', 'inactive'] : ['active', 'leaving'];

  const setDepartments = (ids: string[]) => {
    // Teams only within the chosen departments (spec 5.2).
    const keep = filters.teamIds.filter((t) => !ids.length || ids.includes(teams.find((x) => x.id === t)?.departmentId ?? ''));
    update({ dept: ids.join(','), team: keep.join(',') });
  };

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
                  {m === 'department' ? 'By department' : 'Reporting lines'}
                </button>
              ))}
            </div>
          )}
          <span className="org-count-label" data-testid="org-count" aria-live="polite">
            {loaded ? employeesLabel(count) : loading ? 'Loading…' : ''}
          </span>
          <div className="org-actions">
            {/* Header buttons of the other lanes, by permission: "Add employee" (CD-140), "Import" (CD-141), "Departments & teams" (CD-138). */}
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
          <MultiSelect label="Department" testId="org-filter-department" options={departmentOptions} value={filters.departmentIds} onChange={setDepartments} empty="No departments yet" />
          <MultiSelect label="Team" testId="org-filter-team" options={teamOptions} value={filters.teamIds} onChange={(ids) => update({ team: ids.join(',') })} empty="No teams yet" />
          <div className="org-manager-filter">
            <EmployeePicker employees={managers} value={filters.managerId} onChange={(id) => update({ manager: id })} placeholder="Manager" testId="org-filter-manager" none="Any manager" />
            {me && isManagerOf(access) && filters.managerId !== me && (
              <button type="button" className="cal-pill" data-testid="org-filter-me" onClick={() => update({ manager: me })}>
                Me
              </button>
            )}
            {filters.managerId && (
              <span className="cal-pills" role="group" aria-label="Reports">
                <button type="button" aria-pressed={filters.managerScope === 'direct'} data-testid="org-scope-direct" className={'cal-pill' + (filters.managerScope === 'direct' ? ' on' : '')} onClick={() => update({ scope: null })}>
                  Direct reports only
                </button>
                <button type="button" aria-pressed={filters.managerScope === 'indirect'} data-testid="org-scope-indirect" className={'cal-pill' + (filters.managerScope === 'indirect' ? ' on' : '')} onClick={() => update({ scope: 'indirect' })}>
                  Including indirect
                </button>
              </span>
            )}
          </div>
          <span className="cal-pills" role="group" aria-label="Status">
            {statusChoices.map((st) => (
              <button
                key={st}
                type="button"
                aria-pressed={filters.statuses.includes(st)}
                data-testid={'org-status-' + st}
                className={'cal-pill' + (filters.statuses.includes(st) ? ' on' : '')}
                onClick={() => {
                  const next = toggle(filters.statuses, st);
                  update({ status: next.join(',') === DEFAULT_STATUSES.join(',') ? null : next.join(',') || 'none' });
                }}
              >
                {STATUS_LABEL[st]}
              </button>
            ))}
          </span>
          {admin && (
            <MultiSelect
              label="Account"
              testId="org-filter-account"
              options={(['linked', 'invited', 'none'] as const).map((a) => ({ value: a, label: ACCOUNT_LABEL[a] }))}
              value={filters.accounts}
              onChange={(v) => update({ account: v.join(',') })}
            />
          )}
          {hr && (
            <span className="cal-pills" role="group" aria-label="Data issues">
              {ISSUE_FILTERS.map((i) => (
                <button key={i.value} type="button" aria-pressed={filters.issues.includes(i.value)} data-testid={'org-issue-' + i.value} className={'cal-pill' + (filters.issues.includes(i.value) ? ' on' : '')} onClick={() => update({ issues: toggle(filters.issues, i.value).join(',') })}>
                  {i.label}
                </button>
              ))}
            </span>
          )}
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
            <button type="button" className="btn-plain" data-testid="org-bulk-org" onClick={() => setDialog({ kind: 'org' })}>
              Set department and team
            </button>
            <button type="button" className="btn-plain" data-testid="org-bulk-manager" onClick={() => setDialog({ kind: 'manager' })}>
              Set manager
            </button>
            <button type="button" className="btn-plain" data-testid="org-bulk-export" onClick={() => setDialog({ kind: 'export', selected: true })}>
              Export selected
            </button>
            {/* "Invite selected" (Admin, CD-140 lane B): only rows with a work email and no account; the confirmation says how many. */}
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
        ) : tab === 'list' ? (
          <EmployeeList rows={rows} columns={columns} sort={{ key: sortKey, dir: sortDir }} onSort={(k) => update({ sort: k === 'name' ? null : k, dir: k === sortKey && sortDir === 1 ? 'desc' : null })} onOpen={open} selection={selection} phone={phone} />
        ) : mode === 'department' ? (
          phone ? (
            <DepartmentList blocks={blocks} onOpen={open} hr={hr} />
          ) : (
            <DepartmentChart blocks={blocks} onOpen={open} hr={hr} canDrag={canDrag} onDrop={onDrop} />
          )
        ) : phone ? (
          <ReportingList roots={roots} view={view} />
        ) : (
          <ReportingChart roots={roots} view={view} focusKey={q} />
        )}
      </div>

      {dialog?.kind === 'org' && (
        <SetOrgDialog
          count={selectedRows.length}
          departments={departments}
          teams={teams}
          onClose={() => setDialog(null)}
          onSave={(departmentId, teamId) => actions.bulkUpdate({ employeeIds: selectedRows.map((r) => r.id), departmentId, teamId }, 'Department and team set for {n}')}
        />
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
      {dialog?.kind === 'move' && (
        <MoveDialog
          employee={dialog.employee}
          target={dialog.target.label}
          onClose={() => setDialog(null)}
          onSave={() =>
            actions.bulkUpdate(
              { employeeIds: [dialog.employee.id], departmentId: dialog.target.departmentId, teamId: dialog.target.teamId },
              `${dialog.employee.fullName} moved to ${dialog.target.label}`,
            )
          }
        />
      )}
    </Screen>
  );
}
