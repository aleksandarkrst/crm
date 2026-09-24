import { useEffect, useRef, useState } from 'react';
import { useMatch } from 'react-router-dom';
import { useStore } from '../store/store';

/**
 * The header's "New" menu (CD-66): opens the same dialogs as the buttons on each screen, from any
 * screen (on a deal's screen, a new task or contact is for that deal). A company has no dialog:
 * like "Add company" on Companies, it is created and opened.
 */
export function NewMenu() {
  const { s, set, addCompany } = useStore();
  // On a deal's screen, a new task or contact starts out linked to that deal.
  const dealId = useMatch('/deals/:id')?.params.id;
  const onDeal = dealId && s.leads.some((l) => l.id === dealId) ? dealId : undefined;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const items: { key: string; label: string; hint: string; run: () => void }[] = [
    { key: 'deal', label: 'Deal', hint: 'Starts a funnel', run: () => set({ newLeadOpen: true }) },
    { key: 'contact', label: 'Contact', hint: 'Linked to a deal', run: () => set(onDeal ? { contactOpen: true, contactCompany: onDeal } : { contactOpen: true }) },
    { key: 'company', label: 'Company', hint: 'Opens the new record', run: addCompany },
    { key: 'task', label: 'Task', hint: 'Shows in Today', run: () => set(onDeal ? { taskOpen: true, taskLeadId: onDeal } : { taskOpen: true }) },
    { key: 'product', label: 'Product', hint: 'Adds to the catalog', run: () => set({ productOpen: true }) },
  ];

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
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
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
        className="btn btn-primary new-menu-btn"
        data-testid="new-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(0);
          setOpen(!open);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        New
      </button>
      {open && (
        <div className="menu-pop" role="menu" style={{ right: 0, width: 230 }}>
          <div className="caps-muted menu-label">Create new</div>
          {items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              data-testid={`new-${it.key}`}
              className={i === active ? 'menu-item active' : 'menu-item'}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span className="menu-item-title">{it.label}</span>
              <span className="menu-item-sub">{it.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
