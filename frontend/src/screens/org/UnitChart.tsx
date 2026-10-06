import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/ui';
import type { ApiEmployee, ApiOrgLevel } from '../../lib/api';
import type { ApiDirectoryRow } from '../../lib/orgApi';
import type { UnitChart as UnitChartData, UnitNode } from '../../store/people';
import { ChartFrame } from './ChartFrame';
import { DRAG_TYPE, EmployeePicker, PersonBox } from './parts';
import type { UnitAction } from './UnitDialogs';

/** Where a person was dropped on the chart (spec 6.3, CD-226): a unit, or "No unit". */
export interface DropTarget {
  unitId: string | null;
  label: string;
}

/** The company node on top of the units (CD-225): the workspace's name and its CEO. */
export interface CompanyNode {
  name: string;
  ceo: ApiEmployee | null;
  /** Admins pick the CEO ("Set CEO" / "Change"); null: read-only. */
  setCeo: ((employeeId: string | null) => void) | null;
  /** Who can be picked: active employees. */
  employees: readonly ApiEmployee[];
  /** "4 units · 9 people", under the name. */
  summary: string;
}

/** Admins set the units up on the chart (CD-228): the lead, "Add person" and the unit's menu. */
export interface UnitManage {
  /** The levels, for "Add <the level below>". */
  levels: readonly ApiOrgLevel[];
  /** Who can lead a unit: active employees. */
  employees: readonly ApiDirectoryRow[];
  act: (action: UnitAction) => void;
}

interface Props {
  company: CompanyNode;
  chart: UnitChartData;
  onOpen: (id: string) => void;
  hr: boolean;
  /** Who may be dragged (desktop, Admins); null: dragging is off. */
  canDrag: ((e: ApiEmployee) => boolean) | null;
  /** A person dropped on a unit box. */
  onDrop: (employeeId: string, target: DropTarget) => void;
  /** A person dropped on a person: make the second one the first one's manager (CD-226). */
  onDropOnPerson: (employeeId: string, managerId: string) => void;
  /** People someone reports to: marked "Manager" on the chart (CD-228). */
  managers: ReadonlySet<string>;
  /** Admins: change the units right on the chart. Null: read-only. */
  manage: UnitManage | null;
}

const plural = (n: number) => (n === 1 ? '1 person' : `${n} people`);

/** A drop zone for dragged people: highlights while something is over it. */
function useDrop(target: DropTarget, onDrop: Props['onDrop'], enabled: boolean) {
  const [over, setOver] = useState(false);
  if (!enabled) return { over: false, props: {} };
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (id) onDrop(id, target);
      },
    },
  };
}

/** "Lead", "Manager" (someone reports to them) or nothing (an employee), CD-228. */
function roleOf(e: ApiEmployee, managers: ReadonlySet<string>, lead?: boolean): { badge?: string; tone?: 'lead' | 'manager' } {
  if (lead) return { badge: 'Lead', tone: 'lead' };
  return managers.has(e.id) ? { badge: 'Manager', tone: 'manager' } : {};
}

/** A person on the chart, draggable and a drop target for "make them the manager" (Admins, desktop). */
function Person({ e, props, lead }: { e: ApiEmployee; props: Props; lead?: boolean }) {
  const drag = !!props.canDrag?.(e);
  const role = roleOf(e, props.managers, lead);
  return <PersonBox e={e} onOpen={props.onOpen} hr={props.hr} badge={role.badge} tone={role.tone} draggable={drag} onDropPerson={props.canDrag ? (id) => props.onDropOnPerson(id, e.id) : undefined} />;
}

/** The "⋯" on a unit (Admins): add a unit of the level below, rename, move, delete. */
function UnitMenu({ node, manage }: { node: UnitNode; manage: UnitManage }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const unit = node.unit;
  const own = node.level?.position;
  const below = own === undefined ? undefined : [...manage.levels].sort((a, b) => a.position - b.position).find((l) => l.position > own);
  const items: { label: string; action: UnitAction; danger?: boolean }[] = [
    ...(below ? [{ label: `Add ${below.name.toLowerCase()}`, action: { kind: 'create', level: below, parentId: unit.id } as UnitAction }] : []),
    { label: 'Rename', action: { kind: 'rename', unit } },
    { label: 'Move', action: { kind: 'move', unit } },
    { label: 'Delete', action: { kind: 'delete', unit }, danger: true },
  ];
  return (
    <div className="org-unit-menu" ref={ref}>
      <button type="button" className="org-unit-menu-btn" aria-label={`${unit.name}: more`} title="More" aria-haspopup="menu" aria-expanded={open} data-testid="unit-menu" onClick={() => setOpen(!open)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <div className="menu-pop org-unit-menu-pop" role="menu">
          {items.map(({ label, action, danger }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid={'unit-menu-' + action.kind}
              onClick={() => {
                setOpen(false);
                manage.act(action);
              }}
            >
              <span className="menu-item-title" style={danger ? { color: 'var(--danger)' } : undefined}>
                {label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The lead of a unit: a picker for Admins (it opens the lead dialog, which shows what changes), else the name. */
function LeadPicker({ node, manage }: { node: UnitNode; manage: UnitManage | null }) {
  const unit = node.unit;
  return (
    <div className="org-unit-lead-row">
      <span className="org-unit-lead-label">Lead</span>
      {manage ? (
        <select
          className="org-unit-lead-select"
          aria-label={`Lead of ${unit.name}`}
          data-testid="unit-lead-select"
          value={unit.leadEmployeeId ?? ''}
          onChange={(e) => manage.act({ kind: 'lead', unit, leadId: e.target.value || null })}
        >
          <option value="">No lead yet</option>
          {manage.employees.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </select>
      ) : (
        <span className={'org-unit-lead-name' + (unit.leadName ? '' : ' is-none')}>{unit.leadName ?? 'No lead yet'}</span>
      )}
    </div>
  );
}

/**
 * One unit (CD-228, after the design's org chart): a column with the header card (name, level,
 * people, lead), the lead on top, the unit's people hanging below the lead, "Add person" for
 * Admins, then the units inside it with connectors.
 */
function UnitBox({ node, props }: { node: UnitNode; props: Props }) {
  const drop = useDrop({ unitId: node.unit.id, label: node.unit.name }, props.onDrop, !!props.canDrag);
  const { manage } = props;
  return (
    <section className={'org-unit' + (drop.over ? ' is-over' : '')} data-testid="org-unit" data-unit={node.unit.id} aria-label={node.unit.name} {...drop.props}>
      <div className="org-unit-box">
        <header className="org-unit-head">
          <div className="org-unit-head-top">
            <span className="org-unit-titles">
              <span className="org-unit-name">{node.unit.name}</span>
              {node.level && <span className="org-unit-level">{node.level.name}</span>}
            </span>
            <span className="org-count">{plural(node.count)}</span>
            {manage && <UnitMenu node={node} manage={manage} />}
          </div>
          <LeadPicker node={node} manage={manage} />
        </header>
        {node.lead && (
          <div className="org-unit-lead">
            <Person e={node.lead} props={props} lead />
          </div>
        )}
        {node.members.length > 0 && (
          <div className="org-unit-members">
            {node.members.map((e) => (
              <div key={e.id} className="org-unit-member">
                <Person e={e} props={props} />
              </div>
            ))}
          </div>
        )}
        {!node.lead && !node.members.length && !node.children.length && !manage && <div className="org-empty-team">Nobody yet</div>}
        {manage && (
          <button type="button" className="btn-dashed org-unit-add" data-testid="unit-add-person" onClick={() => manage.act({ kind: 'addPeople', unit: node.unit })}>
            Add person
          </button>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="org-unit-children">
          {node.children.map((c) => (
            <UnitBox key={c.unit.id} node={c} props={props} />
          ))}
        </div>
      )}
    </section>
  );
}

/** People without a unit, hanging off the company node. */
function NoUnit({ people, props }: { people: ApiEmployee[]; props: Props }) {
  const drop = useDrop({ unitId: null, label: 'No unit' }, props.onDrop, !!props.canDrag);
  return (
    <section className={'org-unit is-none' + (drop.over ? ' is-over' : '')} data-testid="org-unit" data-unit="" aria-label="No unit" {...drop.props}>
      <div className="org-unit-box">
        <header className="org-unit-head">
          <div className="org-unit-head-top">
            <span className="org-unit-titles">
              <span className="org-unit-name">No unit</span>
            </span>
            <span className="org-count">{plural(people.length)}</span>
          </div>
        </header>
        {people.map((e) => (
          <Person key={e.id} e={e} props={props} />
        ))}
      </div>
    </section>
  );
}

/** The workspace and its CEO; Admins set or change the CEO here (a workspace setting). */
function Company({ company, onOpen, hr, onDropOnPerson }: { company: CompanyNode; onOpen: (id: string) => void; hr: boolean; onDropOnPerson?: (id: string, managerId: string) => void }) {
  const [picking, setPicking] = useState(false);
  const { ceo, setCeo } = company;
  return (
    <div className="org-company" data-testid="org-company">
      <div className="org-company-head">
        <Avatar initials={(company.name.trim()[0] ?? '?').toUpperCase()} size={40} font={15} square style={{ background: 'var(--brand)', color: 'var(--white)' }} />
        <span className="org-company-text">
          <span className="org-company-name" data-testid="org-company-name">
            {company.name}
          </span>
          <span className="org-person-sub">{company.summary}</span>
        </span>
      </div>
      {ceo ? (
        <PersonBox e={ceo} onOpen={onOpen} hr={hr} badge="CEO" tone="lead" onDropPerson={onDropOnPerson ? (id) => onDropOnPerson(id, ceo.id) : undefined} />
      ) : (
        <span className="org-person-sub org-company-noceo">No CEO set</span>
      )}
      {setCeo &&
        (picking ? (
          <EmployeePicker
            employees={company.employees}
            value={ceo?.id ?? null}
            onChange={(id) => {
              setPicking(false);
              setCeo(id);
            }}
            placeholder="Pick the CEO"
            testId="org-ceo-picker"
            none={ceo ? 'No CEO' : undefined}
            autoFocus
            inline
          />
        ) : (
          <button type="button" className="btn-plain org-company-set" data-testid="org-set-ceo" onClick={() => setPicking(true)}>
            {ceo ? 'Change CEO' : 'Set CEO'}
          </button>
        ))}
    </div>
  );
}

/**
 * "By unit" (CD-226, CD-228): the company node with the CEO on top, the units directly under the
 * company below it, each a column with its lead, people and the units inside it, nested with
 * connector lines, and "No unit" last; inside the zoomable card. Admins set the units up right
 * here (lead, Add person, the unit's menu), and on desktop drag a person onto a unit (move them) or
 * onto a person (make that person their manager); the page confirms both.
 */
export function UnitChart(props: Props) {
  const { chart } = props;
  const empty = !chart.roots.length && !chart.noUnit.length;
  return (
    <ChartFrame label="By unit">
      <div className="org-company-tree" data-testid="org-chart-units">
        <Company company={props.company} onOpen={props.onOpen} hr={props.hr} onDropOnPerson={props.canDrag ? props.onDropOnPerson : undefined} />
        {empty ? (
          <div className="empty-state">Nobody matches these filters.</div>
        ) : (
          <div className="org-unit-children org-units-top">
            {chart.roots.map((n) => (
              <UnitBox key={n.unit.id} node={n} props={props} />
            ))}
            {chart.noUnit.length > 0 && <NoUnit people={chart.noUnit} props={props} />}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

type OutlineProps = Pick<Props, 'onOpen' | 'hr' | 'managers' | 'manage'>;

/** A unit in the phones' outline: its lead and members, then the units inside it; folds. */
function OutlineUnit({ node, closed, toggle, props }: { node: UnitNode; closed: ReadonlySet<string>; toggle: (key: string) => void; props: OutlineProps }) {
  const open = !closed.has(node.unit.id);
  const { onOpen, hr, managers, manage } = props;
  return (
    <div className="org-outline-group" data-testid="org-unit" data-unit={node.unit.id}>
      <div className="org-outline-head">
        <button type="button" className="org-outline-toggle" aria-expanded={open} onClick={() => toggle(node.unit.id)}>
          <span className="org-caret" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          <span className="org-unit-name">{node.unit.name}</span>
          {node.level && <span className="org-unit-level">{node.level.name}</span>}
          <span className="org-count">{node.count}</span>
        </button>
        {manage && <UnitMenu node={node} manage={manage} />}
      </div>
      {open && (
        <div className="org-outline-children">
          {manage && <LeadPicker node={node} manage={manage} />}
          {node.lead && <PersonBox e={node.lead} onOpen={onOpen} hr={hr} badge="Lead" tone="lead" />}
          {node.members.map((e) => {
            const role = roleOf(e, managers);
            return <PersonBox key={e.id} e={e} onOpen={onOpen} hr={hr} badge={role.badge} tone={role.tone} />;
          })}
          {manage && (
            <button type="button" className="btn-dashed org-unit-add" data-testid="unit-add-person" onClick={() => manage.act({ kind: 'addPeople', unit: node.unit })}>
              Add person
            </button>
          )}
          {node.children.map((c) => (
            <OutlineUnit key={c.unit.id} node={c} closed={closed} toggle={toggle} props={props} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Phones (spec 5.3): the company, then the units as an indented, foldable list with their people. */
export function UnitList({ company, chart, ...props }: Pick<Props, 'company' | 'chart'> & OutlineProps) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setClosed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const noUnitOpen = !closed.has('none');
  return (
    <div className="org-outline card" data-testid="org-chart-units">
      <Company company={company} onOpen={props.onOpen} hr={props.hr} />
      {!chart.roots.length && !chart.noUnit.length && <div className="empty-state">Nobody matches these filters.</div>}
      {chart.roots.map((n) => (
        <OutlineUnit key={n.unit.id} node={n} closed={closed} toggle={toggle} props={props} />
      ))}
      {chart.noUnit.length > 0 && (
        <div className="org-outline-group" data-testid="org-unit" data-unit="">
          <button type="button" className="org-outline-toggle" aria-expanded={noUnitOpen} onClick={() => toggle('none')}>
            <span className="org-caret" aria-hidden>
              {noUnitOpen ? '▾' : '▸'}
            </span>
            <span className="org-unit-name">No unit</span>
            <span className="org-count">{chart.noUnit.length}</span>
          </button>
          {noUnitOpen && (
            <div className="org-outline-children">
              {chart.noUnit.map((e) => {
                const role = roleOf(e, props.managers);
                return <PersonBox key={e.id} e={e} onOpen={props.onOpen} hr={props.hr} badge={role.badge} tone={role.tone} />;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
