import { useState } from 'react';
import { activityChannelLabel, SYSTEM_CHANNEL } from '../../store/seed';
import { timelineFor } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

// WhatsApp, LinkedIn and Calls are hidden until their integrations ship (CD-318).
const FILTERS = [
  { k: 'all', label: 'All' },
  { k: 'EM', label: 'Emails' },
  { k: 'MT', label: 'Meetings' },
  { k: 'NT', label: 'Notes' },
  { k: 'RS', label: 'Tasks' },
];

/** The deal's activity timeline (CD-318): every entry with who did it; the field-level Changes view went. */
export function History({ lead }: { lead: Lead }) {
  const { s } = useStore();
  const [filter, setFilter] = useState('all');
  const all = timelineFor(s, lead.id);
  const entries = filter === 'all' ? all : all.filter((e) => e.channel === filter);

  return (
    <div className="card card-pad" data-testid="deal-activity">
      <div className="card-title" style={{ marginBottom: 12 }}>
        Activity
      </div>
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
          <div key={i} data-testid="activity-entry" style={{ display: 'grid', gridTemplateColumns: '62px 1fr auto', gap: 14, padding: '11px 0', borderBottom: '1px solid var(--divider)', alignItems: 'start' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.date}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{e.title}</span>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45, whiteSpace: 'pre-line' }}>{e.detail}</div>
            </div>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span className="pt-main" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', maxWidth: 140 }} data-testid="activity-actor">
                {e.actor ?? 'System'}
              </span>
              {e.channel !== SYSTEM_CHANNEL && <span className="badge badge-neutral">{activityChannelLabel(e.channel)}</span>}
            </span>
          </div>
        ))}
        {entries.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '16px 0' }}>Nothing here yet.</div>}
      </div>
    </div>
  );
}
