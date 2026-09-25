import { useEffect, useRef, useState } from 'react';
import { ICONS, useCommands } from './commands';

/**
 * The header's "+" menu (CD-66, CD-80): creates a deal, contact, company, task or product from any
 * screen (on a deal's screen, a new task or contact is for that deal). While it is open, the
 * letter next to an item runs it.
 */
export function NewMenu() {
  const items = useCommands().filter((c) => c.group === 'Create');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);

  const pick = (i: number) => {
    setOpen(false);
    items[i]!.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(0);
        setOpen(true);
      }
      return;
    }
    const byKey = items.findIndex((it) => it.key && it.key.toLowerCase() === e.key.toLowerCase());
    if (byKey >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      pick(byKey);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="new-menu" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="round-btn new-menu-btn"
        data-testid="new-menu"
        aria-label="Create new"
        title="Create new"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(0);
          setOpen(!open);
        }}
      >
        {open ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
      </button>
      {open && (
        <div className="menu-pop new-menu-pop" role="menu">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              data-testid={it.id}
              className={i === active ? 'menu-item active' : 'menu-item'}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--text-2)' }}>
                <path d={ICONS[it.icon]} />
              </svg>
              <span className="menu-item-title">{it.label}</span>
              <kbd className="kbd" style={{ marginLeft: 'auto' }} aria-label={`Shortcut ${it.key}`}>
                {it.key}
              </kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
