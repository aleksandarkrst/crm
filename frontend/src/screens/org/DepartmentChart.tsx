import { useState } from 'react';
import type { ApiEmployee } from '../../lib/api';
import type { DepartmentBlock } from '../../store/people';
import { ChartFrame } from './ChartFrame';
import { EmployeePicker, PersonBox } from './parts';

/** Where a person was dropped on the chart (spec 6.3): a team, a department without a team, or "No department". */
export interface DropTarget {
  departmentId: string | null;
  teamId: string | null;
  label: string;
}

/** The company node on top of the departments (CD-225): the workspace's name and its CEO. */
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
  blocks: DepartmentBlock[];
  onOpen: (id: string) => void;
  hr: boolean;
  /** Who may be dragged (desktop, Admins); null: dragging is off. */
  canDrag: ((e: ApiEmployee) => boolean) | null;
  onDrop: (employeeId: string, target: DropTarget) => void;
}

const deptName = (b: DepartmentBlock) => b.department?.name ?? 'No department';
const plural = (n: number) => (n === 1 ? '1 person' : `${n} people`);

/** A drop zone for dragged people: highlights while something is over it. */
function useDrop(target: DropTarget, onDrop: Props['onDrop'], enabled: boolean) {
  const [over, setOver] = useState(false);
  if (!enabled) return { over: false, props: {} };
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('text/x-employee')) return;
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
        const id = e.dataTransfer.getData('text/x-employee');
        if (id) onDrop(id, target);
      },
    },
  };
}

function TeamBox({ block, team, props }: { block: DepartmentBlock; team: DepartmentBlock['teams'][number]; props: Props }) {
  const d = block.department;
  const target: DropTarget = team.team ? { departmentId: d?.id ?? null, teamId: team.team.id, label: `${team.team.name} (${deptName(block)})` } : { departmentId: d?.id ?? null, teamId: null, label: d ? `${d.name}, no team` : 'No department' };
  const drop = useDrop(target, props.onDrop, !!props.canDrag && !!team.team);
  return (
    <div className={'org-team' + (drop.over ? ' is-over' : '')} data-testid="org-team" data-team={team.team?.id ?? ''} {...drop.props}>
      <div className="org-team-head">
        <span className="org-team-name">{team.team?.name ?? 'No team'}</span>
        <span className="org-count">{team.people.length}</span>
      </div>
      {team.people.length === 0 && <div className="org-empty-team">Nobody yet</div>}
      {team.people.map((e) => (
        <PersonBox key={e.id} e={e} onOpen={props.onOpen} hr={props.hr} badge={e.id === team.leadId ? 'Lead' : undefined} draggable={!!props.canDrag?.(e)} />
      ))}
    </div>
  );
}

function DepartmentColumn({ block, props }: { block: DepartmentBlock; props: Props }) {
  const d = block.department;
  const target: DropTarget = { departmentId: d?.id ?? null, teamId: null, label: d ? d.name : 'No department' };
  const drop = useDrop(target, props.onDrop, !!props.canDrag);
  return (
    <section className={'org-dept' + (d ? '' : ' is-none') + (drop.over ? ' is-over' : '')} data-testid="org-dept" data-dept={d?.id ?? ''} aria-label={deptName(block)} {...drop.props}>
      <header className="org-dept-head">
        <span className="org-dept-name">{deptName(block)}</span>
        <span className="org-count">{plural(block.count)}</span>
      </header>
      {block.head && (
        <div className="org-dept-headperson">
          <PersonBox e={block.head} onOpen={props.onOpen} hr={props.hr} badge="Head" />
        </div>
      )}
      {block.teams.map((t) => (
        <TeamBox key={t.team?.id ?? 'none'} block={block} team={t} props={props} />
      ))}
      {block.teams.length === 0 && <div className="org-empty-team">Nobody yet</div>}
    </section>
  );
}

/** The workspace and its CEO; Admins set or change the CEO here (a workspace setting). */
function Company({ company, onOpen, hr }: { company: CompanyNode; onOpen: (id: string) => void; hr: boolean }) {
  const [picking, setPicking] = useState(false);
  const { ceo, setCeo } = company;
  return (
    <div className="org-company" data-testid="org-company">
      <span className="org-company-name" data-testid="org-company-name">
        {company.name}
      </span>
      {ceo ? <PersonBox e={ceo} onOpen={onOpen} hr={hr} badge="CEO" /> : <span className="org-person-sub">No CEO set</span>}
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
 * "By department" (spec 5.3): the company node with the CEO on top (CD-225), the departments
 * below it with connector lines (a column per department), inside the zoomable card.
 */
export function DepartmentChart(props: Props) {
  return (
    <ChartFrame label="By department">
      <div className="org-company-tree" data-testid="org-chart-department">
        <Company company={props.company} onOpen={props.onOpen} hr={props.hr} />
        {props.blocks.length ? (
          <div className="org-depts org-depts-tree">
            {props.blocks.map((b) => (
              <DepartmentColumn key={b.department?.id ?? 'none'} block={b} props={props} />
            ))}
          </div>
        ) : (
          <div className="empty-state">Nobody matches these filters.</div>
        )}
      </div>
    </ChartFrame>
  );
}

/** Phones (spec 5.3): the company, then department → team → people as an indented list; departments and teams fold. */
export function DepartmentList({ company, blocks, onOpen, hr }: Pick<Props, 'company' | 'blocks' | 'onOpen' | 'hr'>) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setClosed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <div className="org-outline card" data-testid="org-chart-department">
      <Company company={company} onOpen={onOpen} hr={hr} />
      {!blocks.length && <div className="empty-state">Nobody matches these filters.</div>}
      {blocks.map((b) => {
        const dk = b.department?.id ?? 'none';
        const open = !closed.has(dk);
        return (
          <div key={dk} className="org-outline-group" data-testid="org-dept">
            <button type="button" className="org-outline-toggle org-outline-dept" aria-expanded={open} onClick={() => toggle(dk)}>
              <span className="org-caret" aria-hidden>
                {open ? '▾' : '▸'}
              </span>
              <span className="org-dept-name">{deptName(b)}</span>
              <span className="org-count">{b.count}</span>
            </button>
            {open && (
              <div className="org-outline-children">
                {b.head && <PersonBox e={b.head} onOpen={onOpen} hr={hr} badge="Head" />}
                {b.teams.map((t) => {
                  const tk = dk + ':' + (t.team?.id ?? 'none');
                  const tOpen = !closed.has(tk);
                  return (
                    <div key={tk} className="org-outline-group" data-testid="org-team">
                      <button type="button" className="org-outline-toggle" aria-expanded={tOpen} onClick={() => toggle(tk)}>
                        <span className="org-caret" aria-hidden>
                          {tOpen ? '▾' : '▸'}
                        </span>
                        <span className="org-team-name">{t.team?.name ?? 'No team'}</span>
                        <span className="org-count">{t.people.length}</span>
                      </button>
                      {tOpen && (
                        <div className="org-outline-children">
                          {t.people.map((e) => (
                            <PersonBox key={e.id} e={e} onOpen={onOpen} hr={hr} badge={e.id === t.leadId ? 'Lead' : undefined} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
