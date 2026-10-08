import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiHistoryEntry, HistoryEntity } from '../lib/api';
import { type Cur, money } from '../store/selectors';
import { useStore } from '../store/store';

/** Field names as the screens call them. */
const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  funnelId: 'Funnel',
  stageId: 'Stage',
  companyId: 'Company',
  primaryContactId: 'Primary contact',
  ownerUserId: 'Owner',
  source: 'Source',
  amount: 'Value',
  currency: 'Currency',
  taxMode: 'Amounts are',
  discounts: 'Discounts',
  installments: 'Installments',
  closeDate: 'Closing date',
  fitScore: 'Fit score',
  headline: 'Headline',
  need: 'Need',
  constraint: 'Constraint',
  decisionMaker: 'Decision maker',
  discoveryDate: 'Discovery date',
  lostNote: 'Lost note',
  name: 'Name',
  industry: 'Industry',
  hq: 'HQ',
  teamSize: 'Team size',
  domain: 'Domain',
  notes: 'Notes',
  fullName: 'Name',
  jobTitle: 'Job title',
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  buyerRole: 'Buyer role',
  // Meetings (CD-130)
  type: 'Type',
  startsAt: 'Start',
  endsAt: 'End',
  location: 'Location',
  agenda: 'Agenda',
  dealId: 'Deal',
  organizerUserId: 'Organizer',
  status: 'Status',
  cancelReason: 'Cancellation reason',
  participants: 'Participants',
  // Internal minutes (CD-132)
  summary: 'Minutes summary',
  agreements: 'Agreements',
  nextSteps: 'Next steps',
  // Visit plans (CD-134)
  salespersonUserId: 'Salesperson',
  periodType: 'Period type',
  periodStart: 'Period starts',
  note: 'Note',
  // Projects (CD-233)
  projectTypeId: 'Project type',
  leadUserId: 'Lead',
  code: 'Code',
  health: 'Health',
  endDate: 'End date',
  budgetHours: 'Budget (h)',
  value: 'Value',
  // Tasks (CD-146)
  projectId: 'Project',
  onHoldReason: 'On hold reason',
  description: 'Description',
  dueDate: 'Due',
  estimateHours: 'Estimate (h)',
  assignees: 'Assignees',
  waitsForTaskId: 'Waits for',
};
const MEETING_TEXT: Record<string, string> = {
  visit: 'Customer visit',
  online: 'Online meeting',
  office: 'Meeting at our office',
  phone: 'Phone call',
  planned: 'Planned',
  held: 'Held',
  cancelled: 'Cancelled',
  // Projects' status and health (CD-233)
  open: 'Open',
  completed: 'Completed',
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  // Tasks' status (CD-146)
  todo: 'To do',
  in_progress: 'In progress',
  on_hold: 'On hold',
  done: 'Done',
};
const MOMENT_FIELDS = new Set(['startsAt', 'endsAt', 'heldAt', 'cancelledAt']);
const LINE_LABELS: Record<string, string> = {
  productId: 'product',
  quantity: 'quantity',
  unitPrice: 'unit price',
  vatRate: 'tax',
  description: 'description',
  discountKind: 'discount type',
  discountValue: 'discount',
  billingFrequency: 'billing frequency',
  billingCycles: 'billing cycles',
  startDate: 'billing start date',
};
const FREQUENCY_TEXT: Record<string, string> = { one_time: 'One time', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually' };
const TAX_TEXT: Record<string, string> = { exclusive: 'Tax exclusive', inclusive: 'Tax inclusive', none: 'No tax' };
const DATE_FIELDS = new Set(['closeDate', 'discoveryDate', 'startDate', 'endDate', 'periodStart', 'dueDate']);
const PERIOD_TEXT: Record<string, string> = { month: 'Month', quarter: 'Quarter' };
const NOUN: Record<HistoryEntity, string> = { deal: 'deal', company: 'company', contact: 'contact', meeting: 'meeting', visit_plan: 'visit plan', project: 'project', task: 'task' };
const PAGE = 30;

const empty = <span style={{ color: 'var(--muted)' }}>empty</span>;
const dateText = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const clip = (t: string) => (t.length > 90 ? t.slice(0, 88) + '…' : t);

/**
 * Change history of a deal, company, contact or visit plan (CD-69, CD-134): who changed which field, when, from what
 * to what, newest first, a page at a time. It re-reads when the record changes, here or elsewhere
 * (a live update, CD-20).
 */
export function ChangeHistory({ entity, id, cur, rev }: { entity: HistoryEntity; id: string; cur: Cur; rev: string }) {
  const { s, loadChanges } = useStore();
  const [entries, setEntries] = useState<ApiHistoryEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const shown = useRef(PAGE);
  const tz = s.workspace.timezone;
  const touched = s.changedAt[id] ?? 0;

  const load = useCallback(
    (count: number) =>
      loadChanges(entity, id, 0)
        .then(async (first) => {
          // "Show older" pages are kept when the list is read again.
          let all = first.entries;
          let hasMore = first.more;
          while (hasMore && all.length < count) {
            const next = await loadChanges(entity, id, all.length);
            all = [...all, ...next.entries];
            hasMore = next.more;
          }
          setEntries(all);
          setMore(hasMore);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [entity, id, loadChanges],
  );
  // On open, after a live update, and shortly after this tab's own edits (they are saved after a pause).
  useEffect(() => {
    const t = setTimeout(() => void load(shown.current), entries === null ? 0 : 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entries` only picks the delay
  }, [load, touched, rev]);

  const when = (at: string) => {
    try {
      return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz || undefined }).format(new Date(at));
    } catch {
      return new Date(at).toLocaleString('en-GB');
    }
  };
  const value = (field: string, v: unknown, label: string | null) => {
    if (label) return label;
    if (v === null || v === undefined || v === '') return empty;
    if (field === 'amount' || field === 'unitPrice') return money(Number(v), cur);
    if (field === 'vatRate') return `${Number(v)}%`;
    if (DATE_FIELDS.has(field) && typeof v === 'string') return dateText(v);
    if (MOMENT_FIELDS.has(field) && typeof v === 'string') return when(v);
    if ((((field === 'type' || field === 'status') && entity === 'meeting') || ((field === 'status' || field === 'health') && (entity === 'project' || entity === 'task'))) && typeof v === 'string') return MEETING_TEXT[v] ?? v;
    if (field === 'billingFrequency' && typeof v === 'string') return FREQUENCY_TEXT[v] ?? v;
    if (field === 'taxMode' && typeof v === 'string') return TAX_TEXT[v] ?? v;
    if (field === 'periodType' && typeof v === 'string') return PERIOD_TEXT[v] ?? v;
    if (field === 'discountKind') return v === 'percent' ? 'percent' : 'amount';
    if (field === 'discounts' && Array.isArray(v)) return `${v.length} discount${v.length === 1 ? '' : 's'}`;
    if (field === 'installments' && Array.isArray(v)) return `${v.length} installment${v.length === 1 ? '' : 's'}`;
    // The steps themselves (CD-222), so a change reads as what changed, not "1 step → 1 step".
    if (field === 'nextSteps' && Array.isArray(v))
      return v.length ? clip((v as { text?: string; dueDate?: string | null }[]).map((st) => `“${st.text || '…'}”${st.dueDate ? ` by ${dateText(st.dueDate)}` : ''}`).join(', ')) : empty;
    if (typeof v === 'string') return `“${clip(v)}”`;
    return String(v);
  };
  const arrow = (field: string, e: { oldValue: unknown; newValue: unknown; oldLabel: string | null; newLabel: string | null }) => (
    <>
      {value(field, e.oldValue, e.oldLabel)} → {value(field, e.newValue, e.newLabel)}
    </>
  );
  /** A visit plan's line (CD-134): the company (its name at the time) and the planned visits. */
  const visits = (v: Record<string, unknown> | null) => {
    const n = Number(v?.plannedVisits);
    return n === 1 ? '1 visit' : `${n} visits`;
  };
  const line = (v: Record<string, unknown> | null, product: string | null) => {
    if (!v) return product ?? 'a product';
    const name = product ?? (v.productName as string | null) ?? 'No product';
    return `${name} · ${Number(v.quantity)} × ${money(Number(v.unitPrice), cur)}`;
  };

  /** A meeting participant (CD-130): "Ana Kovač (internal)". */
  const person = (e: ApiHistoryEntry) => {
    const v = ((e.action === 'participant_added' ? e.newValue : e.oldValue) ?? {}) as { kind?: string; name?: string };
    const name = e.label ?? v.name ?? 'someone';
    // A task's assignees (CD-146) are people of the company: no internal/external.
    if (entity === 'task') return name;
    return `${name} (${v.kind === 'external' ? 'external' : 'internal'})`;
  };
  /** One change in words; null for a row folded into another (the note of a loss). */
  const describe = (e: ApiHistoryEntry, all: ApiHistoryEntry[]) => {
    if (entity === 'visit_plan') {
      const company = e.label ?? 'a company';
      switch (e.action) {
        case 'created':
          return <>Created the visit plan</>;
        case 'line_added':
          return <>Added {company}: {visits(e.newValue as Record<string, unknown>)}</>;
        case 'line_removed':
          return <>Removed {company} ({visits(e.oldValue as Record<string, unknown>)})</>;
        case 'line_changed':
          return <>Planned visits at {company}: {visits(e.oldValue as Record<string, unknown>)} → {visits(e.newValue as Record<string, unknown>)}</>;
      }
    }
    switch (e.action) {
      case 'created':
        return <>Created the {NOUN[entity]}{e.label ? <> “{clip(e.label)}”</> : null}</>;
      case 'deleted':
        return <>Deleted the {NOUN[entity]}</>;
      case 'line_added':
        return <>Added a product line: {line(e.newValue as Record<string, unknown>, e.label)}</>;
      case 'line_removed':
        return <>Removed a product line: {line(e.oldValue as Record<string, unknown>, e.label)}</>;
      case 'participant_added':
      case 'participant_removed':
        return <>{e.action === 'participant_added' ? 'Added' : 'Removed'} {person(e)}</>;
      case 'line_changed': {
        const before = (e.oldValue ?? {}) as Record<string, unknown>;
        const after = (e.newValue ?? {}) as Record<string, unknown>;
        const parts = Object.keys(after).map((k) => (
          <span key={k}>
            {LINE_LABELS[k] ?? k}{' '}
            {k === 'productId'
              ? arrow(k, { oldValue: before.productName, newValue: after.productName, oldLabel: null, newLabel: null })
              : arrow(k, { oldValue: before[k], newValue: after[k], oldLabel: null, newLabel: null })}
          </span>
        ));
        return (
          <>
            Changed the product line {e.label ?? ''}:{' '}
            {parts.map((p, i) => (
              <span key={i}>
                {i > 0 ? '; ' : ''}
                {p}
              </span>
            ))}
          </>
        );
      }
    }
    const field = e.field ?? '';
    const sameMoment = (f: string) => all.find((x) => x.field === f && x.changedAt === e.changedAt);
    // A person's hour limit on a task (CD-147), labelled with the person.
    if (field === 'hourLimit') {
      const h = (v: unknown) => (v == null ? 'no limit' : `${Number(v)} h`);
      return (
        <>
          Hour limit for {e.label ?? 'someone'}: {h(e.oldValue)} → {h(e.newValue)}
        </>
      );
    }
    if (field === 'lostReason') {
      const note = sameMoment('lostNote');
      if (e.newValue) return <>Marked as lost: {String(e.newValue)}{note?.newValue ? <> · “{clip(String(note.newValue))}”</> : null}</>;
      return <>Reopened (was lost: {String(e.oldValue)})</>;
    }
    if (field === 'lostNote' && sameMoment('lostReason')) return null;
    return (
      <>
        {FIELD_LABELS[field] ?? field}: {arrow(field, e)}
      </>
    );
  };

  if (failed && !entries) return <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '12px 0' }}>Couldn't load the changes. They'll load when the connection is back.</div>;
  if (!entries) return <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '12px 0' }}>Loading changes…</div>;

  const rows = entries.map((e) => ({ e, text: describe(e, entries) })).filter((r) => r.text !== null);
  return (
    <div data-testid="change-history" style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map(({ e, text }) => (
        <div key={e.id} data-testid="change-row" style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 14, padding: '10px 0', borderTop: '1px solid var(--divider)', alignItems: 'start' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{when(e.changedAt)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{e.actor?.name ?? 'System'}</span>
            <span style={{ fontSize: 12.5, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{text}</span>
          </div>
        </div>
      ))}
      {rows.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '12px 0' }}>No changes recorded yet. Changes are recorded from now on.</div>}
      {more && (
        <button
          type="button"
          className="btn-plain"
          style={{ alignSelf: 'flex-start', marginTop: 8 }}
          onClick={() => {
            shown.current = entries.length + PAGE;
            void load(shown.current);
          }}
        >
          Show older changes
        </button>
      )}
    </div>
  );
}
