import { useEffect, useMemo, useRef, useState } from 'react';
import { searchWorkspace, type SearchHit } from '../store/search';
import { useStore } from '../store/store';
import { Avatar } from './ui';
import '../styles/header.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

/**
 * The header search (CD-63): deals, companies and contacts by name, email or phone, grouped by
 * type. Ctrl+K / ⌘K focuses it from anywhere; arrows move, Enter opens, Escape closes.
 */
export function GlobalSearch() {
  const { s, openLead, openCompany, openContact } = useStore();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = useMemo(() => (query.trim() ? searchWorkspace(s, query) : []), [s, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  const current = Math.min(active, Math.max(flat.length - 1, 0));
  const open = focused && query.trim() !== '';

  const go = (hit: SearchHit) => {
    setQuery('');
    setActive(0);
    input.current?.blur();
    if (hit.kind === 'deal') openLead(hit.id);
    else if (hit.kind === 'company') openCompany(hit.id);
    else openContact(hit.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      const hit = flat[current];
      if (hit) {
        e.preventDefault();
        go(hit);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
      input.current?.blur();
    }
  };

  let index = -1;
  return (
    <div className="search" role="search">
      <div className={focused ? 'search-box focused' : 'search-box'}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </svg>
        <input
          ref={input}
          data-testid="global-search"
          type="search"
          placeholder="Search deals, companies, contacts"
          aria-label="Search deals, companies and contacts"
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
          aria-activedescendant={open && flat[current] ? `search-hit-${current}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
        {!focused && !query && <kbd className="kbd">{SEARCH_SHORTCUT}</kbd>}
      </div>
      {open && (
        <div className="search-pop" id="global-search-results" role="listbox" data-testid="search-results" onMouseDown={(e) => e.preventDefault()}>
          {groups.length === 0 && <div className="search-empty">No deals, companies or contacts match “{query.trim()}”.</div>}
          {groups.map((g) => (
            <div key={g.kind} className="search-group" data-group={g.kind}>
              <div className="caps-muted search-group-label">{g.label}</div>
              {g.hits.map((hit) => {
                const i = ++index;
                return (
                  <div
                    key={hit.kind + hit.id}
                    id={`search-hit-${i}`}
                    role="option"
                    aria-selected={i === current}
                    className={i === current ? 'search-item active' : 'search-item'}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(hit)}
                  >
                    <Avatar initials={hit.initials} size={24} font={9.5} square={hit.kind !== 'contact'} />
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span className="search-item-title">{hit.title}</span>
                      {hit.subtitle && <span className="search-item-sub">{hit.subtitle}</span>}
                    </span>
                    {i === current && <span className="search-enter">↵</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
