import { useState } from 'react';
import { FilterBar } from '../components/ui';
import { DataActions } from '../components/DataActions';
import { Screen } from '../components/Layout';
import { dealsCsv } from '../store/exportCsv';
import { DEFAULT_FILTERS, INDUSTRIES, LOST_VIEWS, VALUE_BANDS, valueBandLabel } from '../store/seed';
import { bandOf, champTotal, curOf, currencySymbol, funnelOptions, needsNextStep, salesPeople, stageOf, valueTotal } from '../store/selectors';
import { useStore } from '../store/store';

export function Pipeline() {
  const store = useStore();
  const { s, set } = store;
  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const seg = s.segment;
  const stages = s.funnels[seg].stages;
  const f = s.filters;
  const q = query.toLowerCase().trim();
  // Lost deals are hidden from the board unless the "lost" chip says otherwise (CD-60).
  const inView = s.leads
    .filter((l) => l.segment === seg)
    .filter((l) => !q || l.company.toLowerCase().includes(q) || String(l.contact).toLowerCase().includes(q))
    .filter((l) => f.owner === 'Salesperson' || l.ownerId === f.owner)
    .filter((l) => f.stalled === 'Status' || (f.stalled === 'Stalled only' ? l.stall >= 3 : l.stall < 3))
    .filter((l) => !f.industry || f.industry === 'Industry' || l.industry === f.industry)
    .filter((l) => f.band === 'Value' || bandOf(l.value) === f.band);
  const segLeads = inView.filter((l) => (f.lost === LOST_VIEWS[1] ? true : f.lost === LOST_VIEWS[2] ? l.outcome === 'lost' : l.outcome !== 'lost'));
  const lostHidden = f.lost === LOST_VIEWS[0] ? inView.filter((l) => l.outcome === 'lost').length : 0;
  const visible = f.stage === 'Stage' || !stages.some((x) => x.name === f.stage) ? stages : stages.filter((x) => x.name === f.stage);

  const pipelineValue = valueTotal(s, segLeads.filter((l) => l.outcome !== 'lost'));
  const setFilter = (k: keyof typeof f) => (v: string) => set((x) => ({ filters: { ...x.filters, [k]: v } }));
  const dirty = (['owner', 'industry', 'band', 'lost'] as const).some((k) => f[k] !== DEFAULT_FILTERS[k]);

  return (
    <Screen title="Pipeline">
      <FilterBar
        search={{ value: query, onChange: setQuery, placeholder: 'Search deals' }}
        chips={[
          {
            keepFirst: true,
            value: seg,
            options: funnelOptions(s),
            onChange: (k) => set((x) => ({ segment: k, filters: { ...x.filters, audience: k } })),
          },
          { value: f.owner, options: ['Salesperson', ...salesPeople(s)], onChange: setFilter('owner') },
          { value: f.industry, options: ['Industry', ...INDUSTRIES], onChange: setFilter('industry') },
          { value: f.band, options: VALUE_BANDS.map((v) => ({ value: v, label: valueBandLabel(v, currencySymbol(curOf(s))) })), onChange: setFilter('band') },
          { value: f.lost, options: [...LOST_VIEWS], onChange: setFilter('lost'), keepFirst: true },
        ]}
        dirty={dirty}
        onClear={() => set((x) => ({ filters: { ...x.filters, ...DEFAULT_FILTERS } }))}
        meta={`${segLeads.length} ${segLeads.length === 1 ? 'lead' : 'leads'} · ${pipelineValue} open${lostHidden ? ` · ${lostHidden} lost hidden` : ''}`}
        extra={<DataActions type="deals" count={segLeads.length} exportCsv={() => dealsCsv(s, segLeads)} />}
        action={{ label: 'New deal', onClick: () => set({ newLeadOpen: true }) }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '0 -30px -44px', padding: '0 30px', minHeight: 'calc(100vh - 118px)' }}>
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', alignItems: 'stretch', flex: 1, minHeight: 520 }}>
          {visible.map((st, ci) => {
            const cards = segLeads.filter((l) => l.stage === st.id);
            const short = valueTotal(s, cards.filter((l) => l.outcome !== 'lost'), true);
            const active = dragOver === st.id;
            const first = ci === 0;
            const last = ci === visible.length - 1;
            return (
              <div
                key={st.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOver !== st.id) setDragOver(st.id);
                }}
                onDragLeave={() => dragOver === st.id && setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain') || dragId;
                  setDragId(null);
                  setDragOver(null);
                  if (id) store.moveLead(id, st.id);
                }}
                style={{ flex: '0 0 268px', width: 268, border: `1px solid ${active ? '#14503C' : 'transparent'}`, borderRadius: '6px 6px 0 0', display: 'flex', flexDirection: 'column' }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: last ? 268 : 282,
                    background: active ? '#D7E9E1' : '#F4F4F5',
                    clipPath: first
                      ? 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%)'
                      : last
                        ? 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 16px 50%)'
                        : 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%, 16px 50%)',
                    padding: first ? '12px 30px 12px 12px' : last ? '12px 12px 12px 26px' : '12px 30px 12px 26px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 7,
                    borderRadius: last ? '6px 6px 0 0' : '6px 0 0 0',
                    height: 57,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{st.name}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
                      {short} · {cards.length}
                    </span>
                  </div>
                </div>

                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, background: active ? '#E7F2EE' : '#F4F4F5' }}>
                  {cards.map((l) => {
                    const score = champTotal(s, l);
                    const lost = l.outcome === 'lost';
                    return (
                      <div
                        key={l.id}
                        data-lost={lost || undefined}
                        draggable={!lost}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', l.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDragId(l.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOver(null);
                        }}
                        onClick={() => store.openLead(l.id)}
                        style={{ background: lost ? 'var(--panel)' : 'var(--white)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-tile)', padding: '11px 12px', cursor: lost ? 'pointer' : 'grab', display: 'flex', flexDirection: 'column', gap: 8, opacity: dragId === l.id ? 0.45 : 1 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25 }}>{l.company}</span>
                          <span style={{ fontSize: 11, color: 'var(--brand)', whiteSpace: 'nowrap' }}>{l.value}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                          {l.contact} · {l.role}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontSize: 10,
                              padding: '3px 5px',
                              borderRadius: 4,
                              background: score >= 80 ? '#E7F2EE' : score >= 65 ? '#FDF0E4' : '#F1F3F6',
                              color: score >= 80 ? '#14503C' : score >= 65 ? '#B4531B' : '#475467',
                            }}
                          >
                            fit {score}
                          </span>
                          <span style={{ fontSize: 11.5, color: l.stall >= 4 ? '#B42318' : '#475467' }}>{l.stall === 0 ? 'active today' : l.stall + 'd since contact'}</span>
                        </div>
                        {lost ? (
                          <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 7 }}>
                            <span className="badge badge-danger">Lost · {l.lostReason}</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11.5, color: 'var(--text-2)', borderTop: '1px dashed var(--border)', paddingTop: 7, lineHeight: 1.35 }}>
                            Next: {stageOf(s, l).activity}
                            {needsNextStep(s, l) && (
                              <div style={{ marginTop: 6 }}>
                                <span className="badge badge-warn" data-testid="no-next-step" title="No dated open task on this deal. Stage to-dos are not scheduled next steps.">
                                  No next step
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {cards.length === 0 && <div className="empty-dashed">Drop a deal here</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}
