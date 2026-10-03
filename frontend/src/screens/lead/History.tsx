import { useState } from 'react';
import { ChangeHistory } from '../../components/ChangeHistory';
import { CHANNEL_LABELS } from '../../store/seed';
import { curOf, timelineFor } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

const FILTERS = [
  { k: 'all', label: 'All' },
  { k: 'EM', label: 'Emails' },
  { k: 'WA', label: 'WhatsApp' },
  { k: 'LI', label: 'LinkedIn' },
  { k: 'MT', label: 'Meetings' },
  { k: 'PH', label: 'Calls' },
  { k: 'NT', label: 'Notes' },
  { k: 'RS', label: 'Tasks' },
];

export function History({ lead }: { lead: Lead }) {
  const { s } = useStore();
  const [filter, setFilter] = useState('all');
  // Activity (the timeline) or Changes (who changed which field, CD-69).
  const [view, setView] = useState<'activity' | 'changes'>('activity');
  const all = timelineFor(s, lead.id);
  const entries = filter === 'all' ? all : all.filter((e) => e.channel === filter);
  const tab = (k: typeof view, label: string) => (
    <button type="button" data-testid={'history-' + k} aria-pressed={view === k} onClick={() => setView(k)} style={{ border: 0, cursor: 'pointer', background: view === k ? '#E7F2EE' : 'transparent', color: view === k ? '#14503C' : '#475750', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 6 }}>
      {label}
    </button>
  );

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div className="card-title">History</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {tab('activity', 'Activity')}
          {tab('changes', 'Changes')}
        </div>
      </div>
      {view === 'changes' ? (
        <ChangeHistory entity="deal" id={lead.id} cur={curOf(s, lead)} rev={JSON.stringify([lead, s.dealLines[lead.id]])} />
      ) : (
      <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {FILTERS.map((d) => {
          const n = d.k === 'all' ? all.length : all.filter((e) => e.channel === d.k).length;
          const on = d.k === filter;
          return (
            <button key={d.k} type="button" onClick={() => setFilter(d.k)} style={{ border: 0, cursor: 'pointer', background: on ? '#E7F2EE' : 'transparent', color: on ? '#14503C' : '#475750', fontSize: 12, fontWeight: 500, padding: '6px 10px', borderRadius: 6 }}>
              {d.label} ({n})
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {entries.map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '62px 1fr auto', gap: 14, padding: '11px 0', borderBottom: '1px solid var(--divider)', alignItems: 'start' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.date}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{e.title}</span>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45, whiteSpace: 'pre-line' }}>{e.detail}</div>
            </div>
            <span className="badge badge-neutral">{CHANNEL_LABELS[e.channel] || e.channel}</span>
          </div>
        ))}
        {entries.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '16px 0' }}>Nothing here yet.</div>}
      </div>
      </>
      )}
    </div>
  );
}
