import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { paths } from '../lib/paths';
import { searchEmployees } from '../store/people';
import { useProjects } from '../store/projects';
import { taskId } from '../lib/tasksApi';
import { useTasks } from '../store/tasks';
import { fold, searchWorkspace } from '../store/search';
import { useStore } from '../store/store';
import { type Command, ICONS, useCommands } from './commands';
import { currentModule } from './modules';
import { Avatar } from './ui';
import '../styles/header.css';
import { useTerms } from '../store/terms';
import { workOrderId, workOrderStatusLabel } from '../lib/workOrdersApi';
import { useWorkOrders } from '../store/workOrders';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

type Row = { kind: 'command'; command: Command } | { kind: 'record'; record: 'deal' | 'company' | 'contact' | 'employee' | 'project' | 'task' | 'work_order'; id: string; title: string; subtitle: string; initials: string };
interface Section {
  label: string;
  rows: Row[];
}

/** How well a command matches the query words: every word must be found; 0 = no match. */
function commandScore(c: Command, words: string[]): number {
  const label = fold(c.label);
  const all = fold(`${c.label} ${c.group} ${c.hint} ${c.keywords ?? ''}`);
  if (!words.every((w) => all.includes(w))) return 0;
  return words.reduce((a, w) => a + (label.startsWith(w) ? 3 : label.includes(w) ? 2 : 1), 0);
}

/**
 * The command palette (CD-80): Ctrl K / ⌘K from anywhere, or the header search. It finds deals,
 * companies and contacts (by name, email or phone), projects (by code, name or company, CD-234), tasks (by "T-12", name or project, CD-283), employees (by name, job title or email,
 * CD-137; their card opens) and the app's actions: create a record, go to a screen or a setting.
 * Arrows move, Enter runs, Escape closes.
 */
export function CommandPalette() {
  const { s, set, openLead, openCompany, openContact, people, session } = useStore();
  const navigate = useNavigate();
  const commands = useCommands();
  const terms = useTerms();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = () => set({ paletteOpen: false });

  useEffect(() => input.current?.focus(), []);
  // The directory isn't part of the workspace load: read it once for the Employees group.
  const ensurePeople = people.ensure;
  useEffect(() => ensurePeople(), [ensurePeople]);
  // Projects (CD-234) aren't part of the workspace load either: read them while the palette is open.
  const { data: projects } = useProjects();
  // And the tasks the caller can see (CD-283): "T-12 · Task · Project".
  const { data: tasks } = useTasks();
  // And work orders (CD-263, design v2 "Ctrl K"): "WO-1044 · Work order · Company · Status".
  const { data: workOrders } = useWorkOrders();
  // In the Projects module its own actions and records come first (CD-229).
  const { pathname } = useLocation();
  const inProjects = currentModule(pathname, session.userId).id === 'projects';

  const sections = useMemo<Section[]>(() => {
    const q = query.trim();
    if (!q) {
      return (['Create', 'Go to', 'Settings'] as const).map((g) => ({
        label: g,
        rows: commands
          .filter((c) => c.group === g)
          .sort((a, b) => Number(!(inProjects && a.module === 'projects')) - Number(!(inProjects && b.module === 'projects')))
          .map((command) => ({ kind: 'command' as const, command })),
      }));
    }
    const words = fold(q).split(/\s+/).filter(Boolean);
    const records: Section[] = searchWorkspace(s, q).map((g) => ({
      label: g.label,
      rows: g.hits.map((h) => ({ kind: 'record' as const, record: h.kind, id: h.id, title: h.title, subtitle: h.subtitle, initials: h.initials })),
    }));
    const actions = commands
      .map((c) => ({ c, score: commandScore(c, words) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ c }) => ({ kind: 'command' as const, command: c }));
    const projectHits = (projects ?? [])
      .filter((p) => {
        const hay = fold(`${p.code ?? ''} ${p.name} ${p.companyName}`);
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 6)
      .map((p) => ({ kind: 'record' as const, record: 'project' as const, id: p.id, title: p.code ? `${p.code} · ${p.name}` : p.name, subtitle: `${p.companyName} · ${p.stageName}`, initials: p.name.slice(0, 2).toUpperCase() }));
    const employees = searchEmployees(s.people.employees, q).map((h) => ({ kind: 'record' as const, record: 'employee' as const, id: h.id, title: h.title, subtitle: h.subtitle, initials: h.initials }));
    const taskHits = (tasks ?? [])
      .filter((t) => {
        const hay = fold(`${taskId(t)} ${t.name} ${t.projectName}`);
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 4)
      .map((t) => ({ kind: 'record' as const, record: 'task' as const, id: t.id, title: `${taskId(t)} · ${t.name}`, subtitle: `${terms.Task} · ${t.projectName}`, initials: 'T' }));
    const orderHits = (workOrders ?? [])
      .filter((w) => {
        const hay = fold(`${workOrderId(w)} ${w.title} ${w.companyName}`);
        return words.every((x) => hay.includes(x));
      })
      .slice(0, 4)
      .map((w) => ({ kind: 'record' as const, record: 'work_order' as const, id: w.id, title: `${workOrderId(w)} · ${w.title}`, subtitle: `${w.companyName} · ${workOrderStatusLabel(w.status)}`, initials: 'WO' }));
    const projectSection = [
      ...(projectHits.length ? [{ label: terms.Projects, rows: projectHits }] : []),
      ...(taskHits.length ? [{ label: terms.Tasks, rows: taskHits }] : []),
      ...(orderHits.length ? [{ label: 'Work orders', rows: orderHits }] : []),
    ];
    return [
      ...(inProjects ? projectSection : []),
      ...records,
      ...(inProjects ? [] : projectSection),
      ...(employees.length ? [{ label: 'Employees', rows: employees }] : []),
      ...(actions.length ? [{ label: 'Actions', rows: actions }] : []),
    ];
  }, [query, s, commands, projects, tasks, workOrders, inProjects, terms]);
  const flat = sections.flatMap((x) => x.rows);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const run = (row: Row) => {
    close();
    if (row.kind === 'command') row.command.run();
    else if (row.record === 'deal') openLead(row.id);
    else if (row.record === 'company') openCompany(row.id);
    else if (row.record === 'employee') navigate(paths.employee(row.id));
    else if (row.record === 'project') navigate(paths.project(row.id));
    else if (row.record === 'task') navigate(paths.task(row.id));
    else if (row.record === 'work_order') navigate(paths.workOrder(row.id));
    else openContact(row.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) setActive((current + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = flat[current];
      if (row) run(row);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  let index = -1;
  return (
    <div className="overlay palette-overlay" onMouseDown={close}>
      <div className="palette" role="dialog" aria-label="Search and commands" data-testid="palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" />
          </svg>
          <input
            ref={input}
            data-testid="palette-input"
            type="search"
            placeholder="Search deals, companies, contacts, people and actions…"
            aria-label="Search deals, companies, contacts, people and actions"
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            aria-activedescendant={flat[current] ? `palette-row-${current}` : undefined}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="palette-list" id="palette-results" role="listbox" ref={list} data-testid="search-results">
          {flat.length === 0 && <div className="search-empty">Nothing matches “{query.trim()}”.</div>}
          {sections.map((sec) => (
            <div key={sec.label} className="search-group" data-group={sec.label}>
              <div className="caps-muted search-group-label">{sec.label}</div>
              {sec.rows.map((row) => {
                const i = ++index;
                const on = i === current;
                return (
                  <div
                    key={row.kind === 'command' ? row.command.id : row.record + row.id}
                    id={`palette-row-${i}`}
                    data-index={i}
                    data-kind={row.kind === 'command' ? 'command' : row.record}
                    role="option"
                    aria-selected={on}
                    className={on ? 'search-item active' : 'search-item'}
                    onMouseMove={() => active !== i && setActive(i)}
                    onClick={() => run(row)}
                  >
                    {row.kind === 'command' ? (
                      <span className="palette-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d={ICONS[row.command.icon]} />
                        </svg>
                      </span>
                    ) : (
                      <Avatar initials={row.initials} size={24} font={9.5} square={row.record !== 'contact' && row.record !== 'employee'} />
                    )}
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="search-item-title">{row.kind === 'command' ? (row.command.group === 'Create' ? 'Create ' + row.command.label.toLowerCase() : row.command.label) : row.title}</span>
                      <span className="search-item-sub">{row.kind === 'command' ? row.command.hint : row.subtitle}</span>
                    </span>
                    {on && <span className="search-enter">↵</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to navigate
          </span>
          <span>
            <kbd className="kbd">↵</kbd> to select
          </span>
          <span>
            <kbd className="kbd">{SEARCH_SHORTCUT}</kbd> to open from anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
