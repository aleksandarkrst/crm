import { useState } from 'react';
import type { ApiEmployee } from '../../lib/api';
import type { UnitChart as UnitChartData, UnitNode } from '../../store/people';
import { ChartFrame } from './ChartFrame';
import { DRAG_TYPE, EmployeePicker, PersonBox } from './parts';

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

/** A person on the chart, draggable and a drop target for "make them the manager" (Admins, desktop). */
function Person({ e, props, badge }: { e: ApiEmployee; props: Props; badge?: string }) {
  const drag = !!props.canDrag?.(e);
  return <PersonBox e={e} onOpen={props.onOpen} hr={props.hr} badge={badge} draggable={drag} onDropPerson={props.canDrag ? (id) => props.onDropOnPerson(id, e.id) : undefined} />;
}

/** One unit: its name and level, the lead on top, the members, then the units inside it with connectors. */
function UnitBox({ node, props }: { node: UnitNode; props: Props }) {
  const drop = useDrop({ unitId: node.unit.id, label: node.unit.name }, props.onDrop, !!props.canDrag);
  return (
    <section className={'org-unit' + (drop.over ? ' is-over' : '')} data-testid="org-unit" data-unit={node.unit.id} aria-label={node.unit.name} {...drop.props}>
      <div className="org-unit-box">
        <header className="org-unit-head">
          <span className="org-unit-titles">
            <span className="org-unit-name">{node.unit.name}</span>
            {node.level && <span className="org-unit-level">{node.level.name}</span>}
          </span>
          <span className="org-count">{plural(node.count)}</span>
        </header>
        {node.lead && (
          <div className="org-unit-lead">
            <Person e={node.lead} props={props} badge="Lead" />
          </div>
        )}
        {node.members.map((e) => (
          <Person key={e.id} e={e} props={props} />
        ))}
        {!node.lead && !node.members.length && !node.children.length && <div className="org-empty-team">Nobody yet</div>}
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
          <span className="org-unit-name">No unit</span>
          <span className="org-count">{plural(people.length)}</span>
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
      <span className="org-company-name" data-testid="org-company-name">
        {company.name}
      </span>
      {ceo ? (
        <PersonBox e={ceo} onOpen={onOpen} hr={hr} badge="CEO" onDropPerson={onDropOnPerson ? (id) => onDropOnPerson(id, ceo.id) : undefined} />
      ) : (
        <span className="org-person-sub">No CEO set</span>
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
            {ceo ? 'Change' : 'Set CEO'}
          </button>
        ))}
    </div>
  );
}

/**
 * "By unit" (CD-226): the company node with the CEO on top, the units directly under the company
 * below it, each unit with its lead, members and the units inside it, nested with connector lines,
 * and "No unit" last; inside the zoomable card. Admins on desktop drag a person onto a unit (move
 * them) or onto a person (make that person their manager); the page confirms both.
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

/** A unit in the phones' outline: its lead and members, then the units inside it; folds. */
function OutlineUnit({ node, closed, toggle, onOpen, hr }: { node: UnitNode; closed: ReadonlySet<string>; toggle: (key: string) => void; onOpen: (id: string) => void; hr: boolean }) {
  const open = !closed.has(node.unit.id);
  return (
    <div className="org-outline-group" data-testid="org-unit" data-unit={node.unit.id}>
      <button type="button" className="org-outline-toggle" aria-expanded={open} onClick={() => toggle(node.unit.id)}>
        <span className="org-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="org-unit-name">{node.unit.name}</span>
        {node.level && <span className="org-unit-level">{node.level.name}</span>}
        <span className="org-count">{node.count}</span>
      </button>
      {open && (
        <div className="org-outline-children">
          {node.lead && <PersonBox e={node.lead} onOpen={onOpen} hr={hr} badge="Lead" />}
          {node.members.map((e) => (
            <PersonBox key={e.id} e={e} onOpen={onOpen} hr={hr} />
          ))}
          {node.children.map((c) => (
            <OutlineUnit key={c.unit.id} node={c} closed={closed} toggle={toggle} onOpen={onOpen} hr={hr} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Phones (spec 5.3): the company, then the units as an indented, foldable list with their people. */
export function UnitList({ company, chart, onOpen, hr }: Pick<Props, 'company' | 'chart' | 'onOpen' | 'hr'>) {
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
      <Company company={company} onOpen={onOpen} hr={hr} />
      {!chart.roots.length && !chart.noUnit.length && <div className="empty-state">Nobody matches these filters.</div>}
      {chart.roots.map((n) => (
        <OutlineUnit key={n.unit.id} node={n} closed={closed} toggle={toggle} onOpen={onOpen} hr={hr} />
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
              {chart.noUnit.map((e) => (
                <PersonBox key={e.id} e={e} onOpen={onOpen} hr={hr} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
