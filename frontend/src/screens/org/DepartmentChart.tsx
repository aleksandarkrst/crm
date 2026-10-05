import { useState } from 'react';
import type { ApiEmployee } from '../../lib/api';
import type { DepartmentBlock } from '../../store/people';
import { ChartFrame } from './ChartFrame';
import { PersonBox } from './parts';

/** Where a person was dropped on the chart (spec 6.3): a team, a department without a team, or "No department". */
export interface DropTarget {
  departmentId: string | null;
  teamId: string | null;
  label: string;
}

interface Props {
  blocks: DepartmentBlock[];
  onOpen: (id: string) => void;
  hr: boolean;
  /** Who may be dragged (desktop, Administration and Admin); null: dragging is off. */
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

/** "By department" (spec 5.3): a column per department on wide screens, inside the zoomable card. */
export function DepartmentChart(props: Props) {
  if (!props.blocks.length) return <div className="empty-state">Nobody matches these filters.</div>;
  return (
    <ChartFrame label="By department">
      <div className="org-depts" data-testid="org-chart-department">
        {props.blocks.map((b) => (
          <DepartmentColumn key={b.department?.id ?? 'none'} block={b} props={props} />
        ))}
      </div>
    </ChartFrame>
  );
}

/** Phones (spec 5.3): department → team → people as an indented list; departments and teams fold. */
export function DepartmentList({ blocks, onOpen, hr }: Pick<Props, 'blocks' | 'onOpen' | 'hr'>) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setClosed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  if (!blocks.length) return <div className="empty-state">Nobody matches these filters.</div>;
  return (
    <div className="org-outline card" data-testid="org-chart-department">
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
