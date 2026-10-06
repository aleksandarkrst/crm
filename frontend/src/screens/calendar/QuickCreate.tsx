import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MeetingDialogSeed } from '../../store/meetings';
import { useStore } from '../../store/store';
import { MeetingForm } from '../meeting/MeetingForm';
import type { CalendarDraft } from './TimeGrid';

/**
 * The quick-create popover (CD-212, laid out like Google Calendar's in CD-221): next to the
 * placeholder of a meeting being made on the Calendar, the quick shape of the meeting form (title,
 * type, date and time, guests, location, agenda, organizer, company and deal). "Save" creates the
 * meeting; "More options" opens the New meeting page with everything filled in. Escape or a press
 * outside it (and outside the placeholder) discards the meeting. `seed` holds the Calendar's
 * filters (company, deal, type, salesperson), as the page gets them.
 */
export function QuickCreate({ draft, seed, onChange, onClose }: { draft: CalendarDraft; seed: MeetingDialogSeed; onChange: (d: CalendarDraft) => void; onClose: (outside?: boolean) => void }) {
  const { meetings } = useStore();
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Next to the placeholder: on its right, else its left, inside the window; it follows the placeholder.
  useLayoutEffect(() => {
    const place = () => {
      const anchor = document.querySelector(draft.anchor);
      const el = pop.current;
      if (!anchor || !el) return;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = r.right + 10;
      if (left + w > window.innerWidth - 8) left = r.left - w - 10;
      if (left < 8) left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
      const top = Math.max(8, Math.min(r.top, window.innerHeight - h - 8));
      setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // It grows with the guests and messages: still inside the window.
    const grow = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (pop.current) grow?.observe(pop.current);
    return () => {
      grow?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [draft.anchor, draft.start, draft.end]);

  // Escape, or a press outside (not on the placeholder, nor in a dialog opened from here), discards it.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || pop.current?.contains(t) || t.closest?.('[data-testid=cal-draft]') || t.closest?.('.overlay')) return;
      onClose(true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.overlay')) onClose();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const formSeed: MeetingDialogSeed = { ...seed, start: new Date(draft.start).toISOString(), end: new Date(draft.end).toISOString(), title: draft.title ?? null, type: draft.type ?? seed.type };
  const more = (picked: MeetingDialogSeed) => {
    meetings.openDialog({ ...picked, contactId: seed.contactId ?? null });
    onClose();
  };

  return (
    <div ref={pop} className="cal-quick" role="dialog" aria-label="New meeting" data-testid="quick-create" style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}>
      <MeetingForm
        variant="quick"
        seed={formSeed}
        time={{ start: draft.start, end: draft.end }}
        onDraft={(q) => onChange({ ...draft, ...q })}
        onDone={() => onClose()}
        onClose={() => onClose()}
        onMore={more}
      />
    </div>
  );
}
