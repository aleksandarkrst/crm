import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Screen } from '../../components/Layout';
import { paths } from '../../lib/paths';
import { champTotal, leadById, momentLabel, needsNextStep, stageOf, stagesFor } from '../../store/selectors';
import { useStore } from '../../store/store';
import { Composer } from './Composer';
import { Discovery } from './Discovery';
import { History } from './History';
import { Summary } from './Summary';
import { Todos } from './Todos';

/** The deal ("lead") record: stage tracker, summary, next best action, to-dos and history. */
export function LeadScreen() {
  const { s, set, patchLead, ensureLog, reopenLead } = useStore();
  const { id = '' } = useParams();
  const lead = leadById(s, id);
  useEffect(() => {
    if (id) ensureLog([id]);
  }, [id, ensureLog]);
  if (!lead) return <Navigate to={paths.pipeline} replace />;

  const stages = stagesFor(s, lead.segment);
  const idx = stages.indexOf(stageOf(s, lead));
  const total = champTotal(s, lead);
  const totalFg = total >= 80 ? '#14503C' : total >= 55 ? '#B4531B' : '#B42318';
  const lost = lead.outcome === 'lost';

  return (
    <Screen title={lead.title || lead.company || 'Lead'} onTitleChange={(v) => patchLead(lead.id, { title: v })} crumb={{ label: 'Pipeline', to: paths.pipeline }}>
      <div key={lead.id} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {stages.map((st, i) => (
              <div key={st.id} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: 14 }}>
                  <span style={{ flex: 1, height: 2, background: i === 0 ? 'transparent' : i <= idx ? '#14503C' : '#E4E7EC' }} />
                  <span
                    style={{
                      width: i === idx ? 14 : 10,
                      height: i === idx ? 14 : 10,
                      borderRadius: '50%',
                      background: i < idx ? '#14503C' : i === idx ? '#101828' : '#FFFFFF',
                      border: `1.5px solid ${i <= idx ? 'transparent' : '#D0D5DD'}`,
                      boxShadow: i === idx ? '0 0 0 4px #E7F2EE' : 'none',
                      flex: '0 0 auto',
                    }}
                  />
                  <span style={{ flex: 1, height: 2, background: i === stages.length - 1 ? 'transparent' : i < idx ? '#14503C' : '#E4E7EC' }} />
                </div>
                <span style={{ fontSize: 11.5, fontWeight: i === idx ? 600 : 500, color: i === idx ? '#101828' : '#475467', textAlign: 'center', lineHeight: 1.3 }}>{st.name}</span>
              </div>
            ))}
          </div>
          {/* Outcome: won is the won stage; lost keeps the stage it was lost in. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--divider)' }}>
            {lost ? (
              <div data-testid="lost-state" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
                <span className="badge badge-danger" style={{ fontSize: 12 }}>
                  Lost · {lead.lostReason}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  {lead.lostAt ? 'on ' + momentLabel(lead.lostAt, s.workspace.timezone) + ' · ' : ''}in {stageOf(s, lead).name}
                  {lead.lostNote ? ' · ' + lead.lostNote : ''}
                </span>
              </div>
            ) : (
              <span style={{ fontSize: 12.5, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {lead.outcome === 'won' ? 'Won · in the won stage' : 'Open · ' + stageOf(s, lead).name}
                {needsNextStep(s, lead) && (
                  <button type="button" className="badge badge-warn" data-testid="no-next-step" title="No open task on this deal. Add one to plan what happens next." onClick={() => set({ taskOpen: true, taskLeadId: lead.id, taskEditId: null })} style={{ border: 0, cursor: 'pointer' }}>
                    No next step
                  </button>
                )}
              </span>
            )}
            {lost ? (
              <button type="button" className="btn-plain" onClick={() => reopenLead(lead.id)}>
                Reopen
              </button>
            ) : (
              lead.outcome === 'open' && (
                <button type="button" className="btn-plain" onClick={() => set({ lostLeadId: lead.id })}>
                  Mark as lost
                </button>
              )
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 400px', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <Summary lead={lead} />
            <Discovery lead={lead} />
            <div className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <div className="card-title">Fit score</div>
                <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 26, lineHeight: 1, color: totalFg }}>{total}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                Scored with CHAMP inside the qualification to-do. {total >= 80 ? 'Qualified.' : total >= 55 ? 'Nurture — gaps remain.' : 'Below the floor.'}
              </div>
            </div>
          </div>

          <div style={{ flex: '999 1 480px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <Composer lead={lead} />
            <Todos lead={lead} />
            <History lead={lead} />
          </div>
        </div>
      </div>
    </Screen>
  );
}
