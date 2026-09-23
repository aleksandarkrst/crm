import { useState } from 'react';
import { RemoveButton } from '../components/ui';
import { Screen } from '../components/Layout';
import { ROADMAP_STATUSES } from '../store/seed';
import { useStore } from '../store/store';

export function Roadmap() {
  const { s, set } = useStore();
  const [draft, setDraft] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const commit = (status: string) => {
    const title = draftText.trim();
    if (title) set((x) => ({ roadmapItems: [...x.roadmapItems, { id: 'rm' + Date.now(), title, status }] }));
    setDraft(null);
    setDraftText('');
  };
  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  };

  return (
    <Screen title="Roadmap">
      <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
        {ROADMAP_STATUSES.map((st) => {
          const items = s.roadmapItems.filter((i) => i.status === st.id);
          const active = over === st.id;
          return (
            <div
              key={st.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (over !== st.id) setOver(st.id);
              }}
              onDragLeave={() => over === st.id && setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || dragId;
                if (id) set((x) => ({ roadmapItems: x.roadmapItems.map((i) => (i.id === id ? { ...i, status: st.id } : i)) }));
                setDragId(null);
                setOver(null);
              }}
              style={{ minWidth: 0, background: active ? '#E7F2EE' : '#F1F3F6', border: `1px solid ${active ? '#14503C' : '#E4E7EC'}`, borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 220 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{st.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{items.length + (items.length === 1 ? ' item' : ' items')}</span>
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} />

              {items.map((i) => (
                <div
                  key={i.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', i.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(i.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-tile)', padding: '10px 11px', cursor: 'grab', opacity: dragId === i.id ? 0.45 : 1, display: 'flex', alignItems: 'flex-start', gap: 8 }}
                >
                  <textarea
                    rows={1}
                    ref={autoGrow}
                    className="ghost"
                    value={i.title}
                    onChange={(e) => {
                      autoGrow(e.target);
                      const v = e.target.value;
                      set((x) => ({ roadmapItems: x.roadmapItems.map((r) => (r.id === i.id ? { ...r, title: v } : r)) }));
                    }}
                    style={{ display: 'block', resize: 'none', overflow: 'hidden', fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, borderRadius: 6, padding: '3px 5px', margin: '-3px -5px' }}
                  />
                  <RemoveButton title="Remove item" box={22} size={14} stroke={1.8} style={{ flex: '0 0 auto' }} onClick={() => set((x) => ({ roadmapItems: x.roadmapItems.filter((r) => r.id !== i.id) }))} />
                </div>
              ))}

              {draft === st.id && (
                <div style={{ background: 'var(--white)', border: '1px solid var(--brand)', boxShadow: 'var(--ring)', borderRadius: 10, padding: '10px 11px', animation: 'dcFade .14s ease-out both' }}>
                  <input
                    autoFocus
                    placeholder="Type a name…"
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(st.id);
                      if (e.key === 'Escape') {
                        setDraft(null);
                        setDraftText('');
                      }
                    }}
                    onBlur={() => commit(st.id)}
                    style={{ width: '100%', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', background: 'transparent', border: 0, outline: 'none', padding: 0 }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Enter to add · Esc to cancel</div>
                </div>
              )}

              <button
                type="button"
                className="roadmap-add"
                onClick={() => {
                  setDraft(st.id);
                  setDraftText('');
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
                <span>Add a new item</span>
              </button>
            </div>
          );
        })}
      </div>
    </Screen>
  );
}
