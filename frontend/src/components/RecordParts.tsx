import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { HistoryEntity } from '../lib/api';
import { activityChannelLabel } from '../store/seed';
import { type Cur, isOverdue, isoLabel, memberLabels, memberName, stageOf, todayIso, valueTotal } from '../store/selectors';
import { useStore } from '../store/store';
import type { Lead, LogEntry } from '../store/types';
import { ChangeHistory } from './ChangeHistory';
import { Icon } from './icons';

/**
 * The parts company and contact pages share with the deal page (CD-80): a header card with the
 * name, owner, "+ Deal" and a menu, cards with a title, the record's deals, its open tasks and its
 * history.
 */

/** A card with a title and an optional action on the right. */
export function Section({ title, action, children, testId }: { title: string; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="card card-pad" data-testid={testId}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        {action}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>{children}</div>
    </div>
  );
}

/** A small "+" button for a section's title row. */
export function AddButton({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className="icon-round" aria-label={label} title={label} data-testid={testId} onClick={onClick} style={{ width: 28, height: 28, flex: '0 0 28px' }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

/**
 * The top of a company or contact page: its picture, editable name, owner, "+ Deal" and a menu
 * with Delete (owners and admins).
 */
export function RecordHeader({
  kind,
  initials,
  name,
  onName,
  ownerId,
  ownerName,
  onOwner,
  onNewDeal,
  onDelete,
  deleteLabel,
}: {
  kind: 'company' | 'contact';
  initials: string;
  name: string;
  onName: (v: string) => void;
  ownerId: string | null | undefined;
  ownerName?: string | null;
  onOwner?: (id: string) => void;
  onNewDeal: () => void;
  onDelete?: () => void;
  deleteLabel: string;
}) {
  const { s } = useStore();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);
  const ownerOptions = [...memberLabels(s)].map(([value, label]) => ({ value, label }));
  if (ownerId && !ownerOptions.some((o) => o.value === ownerId)) ownerOptions.push({ value: ownerId, label: memberName(s, ownerId, ownerName) });

  return (
    <div className="card deal-header" style={{ padding: '16px 20px' }}>
      <div className="deal-header-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 280px', minWidth: 0 }}>
          <span className="avatar" style={{ width: 44, height: 44, flex: '0 0 44px', fontSize: 15, fontWeight: 600, borderRadius: kind === 'company' ? 10 : '50%' }}>
            {kind === 'company' ? <Icon name="company" size={22} /> : initials}
          </span>
          <input className="ghost deal-title" aria-label={kind === 'company' ? 'Company name' : 'Contact name'} data-testid="record-name" value={name} onChange={(e) => onName(e.target.value)} />
        </div>
        <div className="deal-actions">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-2)' }} title="Owner">
            <Icon name="owner" title="Owner" />
            {onOwner ? (
              <select className="form-input" aria-label="Owner" value={ownerId ?? ''} onChange={(e) => onOwner(e.target.value)} style={{ padding: '7px 9px' }}>
                {!ownerId && <option value="">No owner</option>}
                {ownerOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>{memberName(s, ownerId, ownerName)}</span>
            )}
          </label>
          <button type="button" className="btn btn-won" data-testid="record-new-deal" onClick={onNewDeal}>
            + Deal
          </button>
          {onDelete && (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button type="button" className="btn btn-secondary" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)} style={{ padding: '10px 12px' }}>
                ⋯
              </button>
              {menu && (
                <div className="deal-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      onDelete();
                    }}
                  >
                    {deleteLabel}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The record's deals: open ones listed, won and lost counted with their value (per currency). */
export function DealsSection({ leads, onAdd }: { leads: Lead[]; onAdd: () => void }) {
  const { s, openLead } = useStore();
  const open = leads.filter((l) => l.outcome === 'open');
  const won = leads.filter((l) => l.outcome === 'won');
  const lost = leads.filter((l) => l.outcome === 'lost');
  const closed = won.length + lost.length;
  const pct = (n: number) => (closed ? Math.round((n / closed) * 100) : 0);
  const row = (l: Lead) => (
    <button key={l.id} type="button" data-testid="record-deal" onClick={() => openLead(l.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', border: 0, borderTop: '1px solid var(--divider)', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%', font: 'inherit' }}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--brand)' }}>{l.title || l.company}</span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {s.funnels[l.segment]?.label ?? 'Funnel'} · {l.outcome === 'open' ? stageOf(s, l).name : l.outcome === 'won' ? 'Won' : 'Lost'}
        </span>
      </span>
      <span style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{l.value}</span>
    </button>
  );
  return (
    <Section title="Deals" testId="record-deals" action={<AddButton label="Add a deal" onClick={onAdd} />}>
      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Open deals ({open.length})</span>
      {open.map(row)}
      {closed > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--chip)' }} aria-hidden>
            <span style={{ width: pct(won.length) + '%', background: '#14503C' }} />
            <span style={{ width: pct(lost.length) + '%', background: 'var(--danger)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: '4px 12px', fontSize: 12.5 }}>
            <span style={{ color: '#14503C' }}>Won</span>
            <span>{won.length}</span>
            <span>{pct(won.length)}%</span>
            <span style={{ textAlign: 'right' }}>{valueTotal(s, won)}</span>
            <span style={{ color: 'var(--danger)' }}>Lost</span>
            <span>{lost.length}</span>
            <span>{pct(lost.length)}%</span>
            <span style={{ textAlign: 'right' }}>{valueTotal(s, lost)}</span>
          </div>
          {[...won, ...lost].map(row)}
        </div>
      )}
      {leads.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>No deals yet.</span>}
    </Section>
  );
}

/** Open tasks on the record's deals, soonest first ("Focus"). */
export function FocusTasks({ leadIds }: { leadIds: string[] }) {
  const { s, set, openLead } = useStore();
  const today = todayIso(s.workspace.timezone);
  const ids = new Set(leadIds);
  const tasks = s.leadTasks.filter((t) => !t.done && ids.has(t.leadId)).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  return (
    <div className="card card-pad" data-testid="record-focus">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div className="card-title">Focus</div>
        {leadIds[0] && (
          <button type="button" className="btn-plain" onClick={() => set({ taskOpen: true, taskLeadId: leadIds[0]!, taskEditId: null })}>
            + Task
          </button>
        )}
      </div>
      {tasks.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No open tasks.</div>}
      {tasks.map((t) => {
        const lead = s.leads.find((l) => l.id === t.leadId);
        const late = isOverdue(t, today);
        return (
          <button key={t.id} type="button" onClick={() => openLead(t.leadId)} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '9px 0', border: 0, borderTop: '1px solid var(--divider)', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%', font: 'inherit' }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.title}</span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--text-2)' }}>
              {late && <span className="badge badge-danger">Overdue</span>}
              <span>{t.due ? isoLabel(t.due) : 'No due date'}</span>
              <span>· {memberName(s, t.ownerId || null, t.ownerName)}</span>
              <span>· {lead?.title || lead?.company}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Activity on the record's deals, and who changed which field of the record (CD-69). */
export function RecordHistory({ entries, entity, id, cur, rev }: { entries: LogEntry[]; entity: HistoryEntity; id: string | undefined; cur: Cur; rev: string }) {
  const [view, setView] = useState<'activity' | 'changes'>('activity');
  const tab = (k: typeof view, label: string) => (
    <button type="button" data-testid={'history-' + k} aria-pressed={view === k} onClick={() => setView(k)} style={{ border: 0, cursor: 'pointer', background: view === k ? '#E7F2EE' : 'transparent', color: view === k ? '#14503C' : '#475750', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 6 }}>
      {label}
    </button>
  );
  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div className="card-title">History</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {tab('activity', 'Activity')}
          {id && tab('changes', 'Changes')}
        </div>
      </div>
      {view === 'changes' && id ? (
        <ChangeHistory entity={entity} id={id} cur={cur} rev={rev} />
      ) : (
        <>
          {entries.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '12px 0' }}>Nothing here yet.</div>}
          {entries.map((e, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '62px 1fr auto', gap: 14, padding: '11px 0', borderTop: '1px solid var(--divider)', alignItems: 'start' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.date}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{e.title}</span>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45, whiteSpace: 'pre-line' }}>{e.detail}</div>
              </div>
              <span className="badge badge-neutral">{activityChannelLabel(e.channel)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
