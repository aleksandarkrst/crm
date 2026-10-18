import { useEffect, useMemo, useRef, useState } from 'react';
import { type ApiLoggable, type ApiTimesheetWeek, timesheetApi } from '../../lib/timesheetApi';
import { projectError } from '../../store/projects';
import { fold } from '../../store/search';

interface ProjectGroup {
  key: string;
  name: string;
  /** The project's own row ("No task", CD-350), when the workspace allows it. */
  own: ApiLoggable | null;
  items: ApiLoggable[];
}
interface ClientGroup {
  name: string;
  projects: ProjectGroup[];
}

/** Clients, then their projects, then each project's tasks and work orders (a work order without a project goes under "Work orders"). */
function groupsOf(items: ApiLoggable[]): ClientGroup[] {
  const clients = new Map<string, Map<string, ProjectGroup>>();
  for (const i of items) {
    const [client = '', project] = i.path.split(' › ');
    const projectName = project ?? 'Work orders';
    const projects = clients.get(client) ?? new Map<string, ProjectGroup>();
    const g = projects.get(projectName) ?? { key: `${client}›${projectName}`, name: projectName, own: null, items: [] };
    if (i.kind === 'project') g.own = i;
    else g.items.push(i);
    projects.set(projectName, g);
    clients.set(client, projects);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return [...clients.entries()]
    .map(([name, projects]) => ({ name, projects: [...projects.values()].map((p) => ({ ...p, items: p.items.sort((a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code, undefined, { numeric: true }) : a.kind === 'task' ? -1 : 1)) })).sort(byName) }))
    .sort(byName);
}

/**
 * "+ Task @Project" (CD-354, like Clockify): a searchable dropdown of what the person can log on,
 * by client; a project opens to its tasks and work orders, and picking the project itself adds
 * "No task" where the workspace allows it (CD-350). Opens below the button, closes on a pick, a
 * click outside or Escape. Not a modal: nothing stacks over it.
 */
export function TaskPicker({ week, employeeId, onAdd }: { week: ApiTimesheetWeek; employeeId?: string; onAdd: (item: ApiLoggable) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [items, setItems] = useState<ApiLoggable[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    timesheetApi.loggable(employeeId).then(
      (list) => alive && setItems(list),
      (err) => alive && setFailed(projectError(err)),
    );
    const off = (e: MouseEvent) => !pop.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const away = () => setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', away);
    return () => {
      alive = false;
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', away);
    };
  }, [open, employeeId]);

  const inWeek = useMemo(() => new Set(week.rows.map((r) => r.id)), [week.rows]);
  const query = fold(q.trim());
  const groups = useMemo(() => {
    const avail = (items ?? []).filter((i) => !inWeek.has(i.id) && (!query || fold(`${i.code} ${i.name} ${i.path}`).includes(query)));
    return groupsOf(avail);
  }, [items, inWeek, query]);

  const toggle = () => {
    if (!open && button.current) {
      const r = button.current.getBoundingClientRect();
      setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 400)) });
      setQ('');
      setExpanded(new Set());
    }
    setOpen(!open);
  };
  const pick = (item: ApiLoggable) => {
    setOpen(false);
    void onAdd(item);
  };
  const flip = (key: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const who = employeeId ? (week.employee?.name ?? 'They') : null;

  return (
    <>
      <button ref={button} type="button" className="ts-add ts-task-picker-btn" aria-expanded={open} onClick={toggle} data-testid="ts-add-row">
        <span className="ts-add-plus" aria-hidden>
          +
        </span>
        <span className="ts-label-main">Task @Project</span>
      </button>
      {open && at && (
        <div ref={pop} className="ts-picker-pop" style={{ top: at.top, left: at.left }} role="dialog" aria-label="Pick a task or project" data-testid="ts-picker">
          <input className="form-input" autoFocus placeholder="Search task @project or client" value={q} onChange={(e) => setQ(e.target.value)} data-testid="ts-picker-search" />
          <div className="ts-picker-list">
            {failed ? (
              <span className="emp-error">{failed}</span>
            ) : !items ? (
              <span className="emp-note">Loading</span>
            ) : !groups.length ? (
              <span className="emp-note" data-testid="ts-picker-empty">
                {query ? 'Nothing matches.' : !items.length ? (who ? `${who} is on no open task or work order yet.` : 'You are on no open task or work order yet.') : 'Everything you can log on is in this week already.'}
              </span>
            ) : (
              groups.map((c) => (
                <div key={c.name} className="ts-picker-client">
                  <span className="caps ts-picker-client-name">
                    {c.name}
                    <span className="emp-note">
                      {' '}
                      · {c.projects.length} {c.projects.length === 1 ? 'project' : 'projects'}
                    </span>
                  </span>
                  {c.projects.map((p) => {
                    const isOpen = !!query || expanded.has(p.key);
                    return (
                      <div key={p.key}>
                        <div className="ts-picker-project">
                          {p.own ? (
                            <button type="button" className="ts-picker-name" onClick={() => pick(p.own!)} title="Log time on the project, without a task" data-testid="ts-picker-project">
                              {p.name}
                            </button>
                          ) : (
                            <button type="button" className="ts-picker-name muted" onClick={() => flip(p.key)}>
                              {p.name}
                            </button>
                          )}
                          {p.items.length > 0 && (
                            <button type="button" className="ts-picker-count" aria-expanded={isOpen} onClick={() => flip(p.key)} data-testid="ts-picker-expand">
                              {p.items.length} {p.items.length === 1 ? 'task' : 'tasks'} {isOpen ? '▴' : '▾'}
                            </button>
                          )}
                        </div>
                        {isOpen &&
                          p.items.map((i) => (
                            <button key={i.id} type="button" className="ts-picker-task" onClick={() => pick(i)} data-testid="ts-picker-task" data-id={i.id}>
                              <span className="emp-note">{i.code}</span> {i.name}
                              {i.kind === 'work_order' ? <span className="emp-note"> · work order</span> : null}
                            </button>
                          ))}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
