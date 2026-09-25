import { useEffect, useMemo, useRef, useState } from 'react';
import { fold, searchWorkspace } from '../store/search';
import { useStore } from '../store/store';
import { type Command, ICONS, useCommands } from './commands';
import { Avatar } from './ui';
import '../styles/header.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

type Row = { kind: 'command'; command: Command } | { kind: 'record'; record: 'deal' | 'company' | 'contact'; id: string; title: string; subtitle: string; initials: string };
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
 * companies and contacts (by name, email or phone) and the app's actions: create a record, go to
 * a screen or a setting. Arrows move, Enter runs, Escape closes.
 */
export function CommandPalette() {
  const { s, set, openLead, openCompany, openContact } = useStore();
  const commands = useCommands();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = () => set({ paletteOpen: false });

  useEffect(() => input.current?.focus(), []);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim();
    if (!q) {
      return (['Create', 'Go to', 'Settings'] as const).map((g) => ({ label: g, rows: commands.filter((c) => c.group === g).map((command) => ({ kind: 'command' as const, command })) }));
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
    return [...records, ...(actions.length ? [{ label: 'Actions', rows: actions }] : [])];
  }, [query, s, commands]);
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
            placeholder="Search deals, companies, contacts and actions…"
            aria-label="Search deals, companies, contacts and actions"
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
                      <Avatar initials={row.initials} size={24} font={9.5} square={row.record !== 'contact'} />
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
