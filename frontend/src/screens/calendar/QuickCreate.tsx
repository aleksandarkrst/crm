import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { XIcon } from '../../components/ui';
import type { MeetingType } from '../../lib/api';
import { MEETING_TYPES, type MeetingDialogSeed } from '../../store/meetings';
import { companyLabels, companyRecords } from '../../store/selectors';
import { useStore } from '../../store/store';
import { instantToZoned, zonedToInstant } from '../../store/time';
import type { CalendarDraft } from './TimeGrid';

const hqOf = (hq: string | undefined) => (hq && hq !== '—' ? hq : '');

/**
 * The quick-create popover (CD-212, like Google Calendar's): next to the placeholder of a meeting
 * being made on the Calendar, with the title, type, company, deal (required, CD-213) and time.
 * "Save" creates the meeting; "More options" opens the full New meeting dialog with what is filled
 * in. Escape or a press outside it (and outside the placeholder) discards the meeting. `seed` holds
 * the Calendar's filters (company, deal, type, salesperson), as the dialog gets them.
 */
export function QuickCreate({ draft, seed, onChange, onClose }: { draft: CalendarDraft; seed: MeetingDialogSeed; onChange: (d: CalendarDraft) => void; onClose: (outside?: boolean) => void }) {
  const { s, set, session, meetings, flash } = useStore();
  const tz = s.workspace.timezone;
  const records = useMemo(() => companyRecords(s), [s]);
  const companies = useMemo(() => {
    const labels = companyLabels(records);
    return records.map((c) => ({ value: c.id, label: labels.get(c.id) ?? c.name })).sort((a, b) => a.label.localeCompare(b.label));
  }, [records]);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const seedDeal = seed.dealId ? s.leads.find((l) => l.id === seed.dealId) : undefined;
  const [companyId, setCompanyId] = useState(() => seed.companyId || seedDeal?.companyId || '');
  const pickDeal = (company: string) => {
    if (seedDeal && seedDeal.companyId === company) return seedDeal.id;
    const open = s.leads.filter((l) => l.companyId === company && l.outcome === 'open');
    return open.length === 1 ? open[0]!.id : '';
  };
  const [dealId, setDealId] = useState(() => pickDeal(companyId));
  const [title, setTitle] = useState(draft.title ?? '');
  const [type, setType] = useState<MeetingType>(draft.type ?? seed.type ?? 'visit');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  const company = records.find((c) => c.id === companyId);
  const deals = s.leads.filter((l) => l.companyId === companyId).sort((a, b) => Number(b.outcome === 'open') - Number(a.outcome === 'open'));
  const a = instantToZoned(draft.start, tz);
  const b = instantToZoned(draft.end, tz);

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
    return () => {
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

  // The placeholder shows the title and the type's color as they are typed.
  const show = (patch: Partial<CalendarDraft>) => onChange({ ...draft, title, type, ...patch });

  // "+ New deal" (CD-213): the New deal dialog for this company; the deal made there is picked here.
  const made = s.newLeadMade;
  useEffect(() => {
    if (!made) return;
    if (made.companyId === companyId) setDealId(made.dealId);
    set({ newLeadMade: null });
  }, [made, companyId, set]);
  const newDeal = () => set({ newLeadOpen: true, newLeadCompanyId: companyId, newLeadContactId: null, newLeadForMeeting: true, newLeadMade: null });

  const setStart = (date: string, time: string) => {
    if (!date || !time) return;
    const start = zonedToInstant(date, time, tz);
    if (Number.isFinite(start)) show({ start, end: start + (draft.end - draft.start) });
  };
  const setEnd = (time: string) => {
    if (!time) return;
    let end = zonedToInstant(a.date, time, tz);
    // 23:00–01:00: the end is on the next day.
    if (end <= draft.start) end = zonedToInstant(instantToZoned(draft.start + 86_400_000, tz).date, time, tz);
    if (Number.isFinite(end)) show({ end });
  };

  const errors: string[] = [];
  if (title.trim().length > 200) errors.push('The title can be at most 200 characters.');
  if (!companyId) errors.push('Pick the customer company.');
  else if (!dealId) errors.push(deals.length ? 'Pick the deal this meeting is for.' : 'This company has no deals yet. Add one with + New deal.');
  if (draft.end <= draft.start) errors.push('The end must be after the start.');

  const save = async () => {
    setTried(true);
    if (errors.length || !company) return;
    setBusy(true);
    setFailure('');
    try {
      const saved = await meetings.create({
        title: title.trim() || `Meeting with ${company.name}`,
        type,
        startsAt: new Date(draft.start).toISOString(),
        endsAt: new Date(draft.end).toISOString(),
        location: type === 'visit' ? hqOf(company.hq) || null : null,
        companyId,
        dealId,
        organizerUserId: seed.organizerUserId || session.userId,
      });
      flash(`${saved.title} scheduled`);
      onClose();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  const moreOptions = () => {
    meetings.openDialog({
      start: new Date(draft.start).toISOString(),
      end: new Date(draft.end).toISOString(),
      title: title.trim() || null,
      type,
      companyId: companyId || null,
      dealId: dealId || null,
      contactId: seed.contactId ?? null,
      organizerUserId: seed.organizerUserId ?? null,
    });
    onClose();
  };

  return (
    <div
      ref={pop}
      className="cal-quick"
      role="dialog"
      aria-label="New meeting"
      data-testid="quick-create"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && void save()}
    >
      <div className="cal-quick-head">
        <input
          className="cal-quick-title"
          data-testid="quick-title"
          autoFocus
          maxLength={220}
          placeholder={company ? `Meeting with ${company.name}` : 'Add title'}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            show({ title: e.target.value });
          }}
        />
        <button type="button" className="icon-round" aria-label="Discard" data-testid="quick-close" onClick={() => onClose()} style={{ width: 28, height: 28, flex: '0 0 28px' }}>
          <XIcon size={13} />
        </button>
      </div>
      <div className="cal-quick-types" role="group" aria-label="Type">
        {MEETING_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={'cal-pill' + (type === t.value ? ' on' : '')}
            aria-pressed={type === t.value}
            data-testid={'quick-type-' + t.value}
            title={t.label}
            onClick={() => {
              setType(t.value);
              show({ type: t.value });
            }}
          >
            <span className={`mt-dot mt-${t.value}`} aria-hidden />
            {t.short}
          </button>
        ))}
      </div>
      <div className="cal-quick-when">
        <input type="date" className="form-input" aria-label="Date" data-testid="quick-date" value={a.date} onChange={(e) => setStart(e.target.value, a.time)} />
        <input type="time" className="form-input" aria-label="Starts" data-testid="quick-start" step={300} value={a.time} onChange={(e) => setStart(a.date, e.target.value)} />
        <span aria-hidden>–</span>
        <input type="time" className="form-input" aria-label="Ends" data-testid="quick-end" step={300} value={b.time} onChange={(e) => setEnd(e.target.value)} />
        {b.date !== a.date && <span className="meeting-muted">next day</span>}
      </div>
      <select
        className="form-input"
        aria-label="Company"
        data-testid="quick-company"
        value={companyId}
        onChange={(e) => {
          setCompanyId(e.target.value);
          setDealId(pickDeal(e.target.value));
        }}
      >
        <option value="" disabled>
          Pick a company…
        </option>
        {companies.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {companyId && deals.length === 0 ? (
        <span className="meeting-no-deals" data-testid="quick-no-deals">
          <span className="meeting-muted">This company has no deals yet</span>
          <button type="button" className="btn-plain" data-testid="quick-new-deal" onClick={newDeal}>
            + New deal
          </button>
        </span>
      ) : (
        <select className="form-input" aria-label="Deal" data-testid="quick-deal" value={dealId} disabled={!companyId} onChange={(e) => setDealId(e.target.value)}>
          <option value="" disabled>
            {companyId ? 'Pick a deal…' : 'Pick a company first'}
          </option>
          {deals.map((l) => (
            <option key={l.id} value={l.id}>
              {(l.title || l.company) + (l.outcome === 'open' ? '' : l.outcome === 'won' ? ' · won' : ' · lost')}
            </option>
          ))}
        </select>
      )}
      {tried && errors.length > 0 && (
        <div className="meeting-error-box" data-testid="quick-errors">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      {failure && (
        <div className="meeting-error-box" data-testid="quick-failure">
          Not saved: {failure}
        </div>
      )}
      <div className="cal-quick-actions">
        <button type="button" className="btn-plain" data-testid="quick-more" onClick={moreOptions}>
          More options
        </button>
        <button type="button" className="btn btn-primary" data-testid="quick-save" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
