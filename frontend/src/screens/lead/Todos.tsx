import { useState } from 'react';
import { CHAMP, CHAMP_LEVELS, CHANNEL_LABELS, GATE_STAGE_ADVANCE, SCRIPTS } from '../../store/seed';
import { champFor, champTotal, script, stageDone, stageOf, stagesFor, taskOf, todoItemsFor } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

const OUTCOMES = ['Sent', 'Replied', 'No answer', 'Rescheduled'];

/** Stage to-dos: every stage so far, the current one gates the "Advance" button. */
export function Todos({ lead }: { lead: Lead }) {
  const store = useStore();
  const { s } = store;
  const [openTask, setOpenTask] = useState<string | null>(null);

  const stages = stagesFor(s, lead.segment);
  const current = stageOf(s, lead);
  const idx = stages.indexOf(current);
  let open = 0;
  let done = 0;

  const groups = stages.slice(0, idx + 1).map((st, gi) => {
    const isCurrent = st.id === current.id;
    const items = todoItemsFor(s, lead, st.id).map((item, i) => {
      const t = taskOf(s, lead.id, st.id, i);
      if (t.done) done++;
      else open++;
      return { item, i, t };
    });
    const complete = items.every(({ t }) => t.done);
    return { st, gi, isCurrent, complete, items };
  });

  const canAdvance = (!GATE_STAGE_ADVANCE || stageDone(s, lead, current.id)) && idx < stages.length - 1;
  const next = stages[Math.min(idx + 1, stages.length - 1)]!;
  const advanceLabel = idx >= stages.length - 1 ? 'Final stage' : canAdvance ? 'Advance to ' + next.name : 'Locked — finish the to-do';

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div className="card-title">To-Do</div>
          <div className="card-sub" style={{ marginTop: 3 }}>
            {GATE_STAGE_ADVANCE
              ? `Everything done for this lead, stage by stage. All of ${current.name} must be closed to advance.`
              : 'Everything done for this lead, stage by stage. Advancing is not blocked.'}
          </div>
        </div>
        <span className="tag" style={{ fontSize: 10.5, color: 'var(--text-2)', padding: 0 }}>
          {open} open · {done} done
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 18 }}>
        {groups.map((g) => (
          <div key={g.st.id} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{String(g.gi + 1).padStart(2, '0')}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: g.isCurrent ? '#101828' : '#475467' }}>{g.st.name}</span>
              <span className="tag" style={{ background: g.isCurrent ? '#101828' : g.complete ? '#E7F2EE' : '#FDF0E4', color: g.isCurrent ? '#F5F6F8' : g.complete ? '#14503C' : '#B4531B' }}>
                {g.isCurrent ? 'current stage' : g.complete ? 'completed' : 'left open'}
              </span>
              <span style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
            </div>

            {g.items.map(({ item, i, t }) => {
              const key = g.st.id + ':' + i;
              const expanded = openTask === key;
              const isChamp = /fit score|qualif/i.test(item.label);
              const toggleOpen = () => setOpenTask((cur) => (cur === key ? null : key));
              const complete = () => {
                store.completeTask(lead, g.st.id, i, item.label);
                if (!t.done) setOpenTask(null);
              };
              const channelLabel = CHANNEL_LABELS[g.st.channel] || g.st.channel;
              return (
                <div key={i} style={{ border: `1px solid ${expanded ? '#14503C' : '#EEF0F4'}`, borderRadius: 9, background: expanded ? '#FAFBFC' : '#FFFFFF' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px' }}>
                    <button
                      type="button"
                      title="Mark done"
                      onClick={complete}
                      style={{ flex: '0 0 19px', width: 19, height: 19, borderRadius: 6, border: `1px solid ${t.done ? '#14503C' : '#D0D5DD'}`, background: t.done ? '#14503C' : '#FFFFFF', color: '#FFFFFF', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    >
                      {t.done ? '✓' : ''}
                    </button>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {item.offPlaybook ? (
                        <input
                          value={item.label}
                          placeholder="Name this to-do"
                          onChange={(e) => store.renameExtra(lead.id, g.st.id, item.extraIdx!, e.target.value)}
                          style={{ border: 0, outline: 0, background: 'transparent', padding: 0, fontSize: 13.5, color: t.done ? '#98A2B3' : '#101828', textDecoration: t.done ? 'line-through' : 'none', width: '100%' }}
                        />
                      ) : (
                        <button type="button" onClick={toggleOpen} style={{ textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer', padding: 0, fontSize: 13.5, color: t.done ? '#98A2B3' : '#101828', textDecoration: t.done ? 'line-through' : 'none' }}>
                          {item.label}
                        </button>
                      )}
                      <button type="button" onClick={toggleOpen} style={{ textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer', padding: 0, fontSize: 11.5, color: 'var(--muted)' }}>
                        {t.done ? `Done ${t.at} by ${t.by}${t.outcome ? ' · ' + t.outcome : ''}` : g.isCurrent ? 'Open · due today' : 'Open · carried from ' + g.st.name}
                      </button>
                    </div>
                    {item.offPlaybook && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <span className="tag" style={{ background: 'var(--chip)', color: 'var(--text-2)' }}>
                          off-playbook
                        </span>
                        <button
                          type="button"
                          className="pill-x"
                          title="Delete this to-do"
                          onClick={() => {
                            store.removeExtra(lead.id, g.st.id, item.extraIdx!, i);
                            setOpenTask(null);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    )}
                    <span className="badge badge-neutral" style={{ padding: '4px 9px', borderRadius: 6 }}>
                      {channelLabel}
                    </span>
                    <button type="button" onClick={toggleOpen} style={{ border: 0, background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: '2px 4px' }}>
                      {expanded ? '−' : '+'}
                    </button>
                  </div>

                  {expanded && (
                    <div style={{ borderTop: '1px solid var(--divider)', padding: '15px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {isChamp && <ChampPanel lead={lead} />}
                      {!isChamp && !!SCRIPTS[g.st.activity] && (
                        <div style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                          <span className="caps">Script · {channelLabel}</span>
                          <span style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{script(g.st.activity, lead)}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <span className="caps">Outcome</span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {OUTCOMES.map((o) => (
                            <button
                              key={o}
                              type="button"
                              onClick={() => store.patchTask(lead.id, g.st.id, i, { outcome: o })}
                              style={{ border: `1px solid ${t.outcome === o ? '#101828' : '#E4E7EC'}`, background: t.outcome === o ? '#101828' : '#FFFFFF', color: t.outcome === o ? '#F5F6F8' : '#475467', cursor: 'pointer', fontSize: 12, padding: '7px 12px', borderRadius: 20 }}
                            >
                              {o}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <span className="caps">What happened</span>
                        <textarea
                          rows={2}
                          value={t.note || ''}
                          placeholder="One line. This becomes the timeline entry."
                          onChange={(e) => store.patchTask(lead.id, g.st.id, i, { note: e.target.value })}
                          style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 11px', fontSize: 13, color: 'var(--ink)', resize: 'vertical' }}
                        />
                      </label>
                      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                        <button type="button" className="btn" onClick={complete} style={{ border: 0, fontWeight: 500, background: t.done ? '#F1F3F6' : '#14503C', color: t.done ? '#475467' : '#F5F6F8' }}>
                          {t.done ? 'Reopen' : 'Mark done'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            store.patchTask(lead.id, g.st.id, i, { done: true, at: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), by: 'Mila', outcome: 'Skipped' });
                            store.flash('Skipped · reason logged to the timeline');
                          }}
                        >
                          Skip with reason
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {g.isCurrent && (
              <>
                <button type="button" className="btn-dashed" style={{ alignSelf: 'flex-start' }} onClick={() => store.addTodo(lead.id, g.st.id)}>
                  + Add a to-do for this lead
                </button>
                <button
                  type="button"
                  onClick={() => store.advanceStage(lead.id)}
                  style={{ alignSelf: 'flex-start', marginTop: 4, border: 0, cursor: canAdvance ? 'pointer' : 'not-allowed', background: canAdvance ? '#14503C' : '#F1F3F6', color: canAdvance ? '#F5F6F8' : '#98A2B3', fontSize: 13.5, fontWeight: 500, padding: '12px 18px', borderRadius: 8 }}
                >
                  {advanceLabel}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChampPanel({ lead }: { lead: Lead }) {
  const store = useStore();
  const vals = champFor(store.s, lead);
  const total = champTotal(store.s, lead);
  const fg = total >= 80 ? '#14503C' : total >= 55 ? '#B4531B' : '#B42318';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Qualify with CHAMP</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 3 }}>25 points each. The total becomes the fit score.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 28, lineHeight: 1, color: fg }}>{total}</span>
          <span className="tag" style={{ padding: 0, color: fg }}>
            {total >= 80 ? 'pursue' : total >= 55 ? 'nurture' : 'disqualify'}
          </span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 14 }}>
        {CHAMP.map((c) => (
          <div key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 7, height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{vals[c.key] || 0}/25</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.4, flex: 1 }}>{c.prompt}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5 }}>
              {CHAMP_LEVELS.map((l) => {
                const on = (vals[c.key] || 0) === l.v;
                return (
                  <button
                    key={l.label}
                    type="button"
                    onClick={() => store.setChamp(lead.id, c.key, l.v)}
                    style={{ border: `1px solid ${on ? '#101828' : '#E4E7EC'}`, background: on ? '#101828' : '#FFFFFF', color: on ? '#F5F6F8' : '#475467', cursor: 'pointer', fontSize: 11, padding: '6px 4px', borderRadius: 6 }}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
        {total >= 80 ? 'Qualified. The funnel will keep pushing this one.' : total >= 55 ? 'Missing pieces. Fill the gaps before the proposal stage.' : 'Below the floor. Park it rather than spend a proposal on it.'}
      </div>
    </div>
  );
}
