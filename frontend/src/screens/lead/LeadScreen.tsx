import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/icons';
import { Screen } from '../../components/Layout';
import { MeetingsCard } from '../../components/MeetingsCard';
import { paths } from '../../lib/paths';
import type { ApiProject } from '../../lib/projectsApi';
import { useDealProjects } from '../../store/projects';
import { champTotal, leadById, memberLabels, memberName, momentLabel, stageOf, stagesFor } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';
import { CompanySection } from './CompanySection';
import { Composer } from './Composer';
import { DealProjectsRow, NewProjectFromDealDialog, WonDealProjectAction } from './DealProjects';
import { DealProducts } from './DealProducts';
import { Discovery } from './Discovery';
import { History } from './History';
import { Summary } from './Summary';
import { Todos } from './Todos';

const DAY = 86_400_000;

/** The deal ("lead") record: header with stage bar, summary and sections, next best action, to-dos and history. */
export function LeadScreen() {
  const { s, ensureLog } = useStore();
  const { id = '' } = useParams();
  const lead = leadById(s, id);
  // The deal's projects (CD-275): the won header's Create / Open project and the Summary's row.
  const { data: projects } = useDealProjects(id || undefined);
  useEffect(() => {
    if (id) ensureLog([id]);
  }, [id, ensureLog]);
  if (!lead) return <Navigate to={paths.pipeline} replace />;

  const total = champTotal(s, lead);
  const totalFg = total >= 80 ? '#14503C' : total >= 55 ? '#B4531B' : '#B42318';

  return (
    <Screen title="Deal" parent={{ label: 'Pipeline', to: paths.pipeline }}>
      <div key={lead.id} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <DealHeader lead={lead} projects={projects} />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <div className="lead-side" style={{ flex: '1 1 400px', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <Summary lead={lead} projects={<DealProjectsRow projects={projects} />} />
            <CompanySection lead={lead} />
            <MeetingsCard record={{ dealId: lead.id }} seed={{ dealId: lead.id, companyId: lead.companyId, contactId: lead.contactId }} />
            <DealProducts lead={lead} />
            <Discovery lead={lead} />
            <div className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <div className="card-title">Fit score</div>
                <span className="display" style={{ fontSize: 24, lineHeight: 1, color: totalFg }}>{total}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                Scored with CHAMP inside the qualification to-do. {total >= 80 ? 'Qualified.' : total >= 55 ? 'Nurture — gaps remain.' : 'Below the floor.'}
              </div>
            </div>
          </div>

          <div className="lead-main" style={{ flex: '999 1 480px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <Composer lead={lead} />
            <Todos lead={lead} />
            <History lead={lead} />
          </div>
        </div>
      </div>
    </Screen>
  );
}

/**
 * The deal's name, owner, Won and Lost, and the stage bar (CD-83). Won moves the deal to its
 * funnel's won stage; a stage of the bar moves it there.
 */
function DealHeader({ lead, projects }: { lead: Lead; projects: ApiProject[] | null }) {
  const { s, set, patchLead, moveLead, reopenLead, canDelete, deleteDeal } = useStore();
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);

  const stages = stagesFor(s, lead.segment);
  const stage = stageOf(s, lead);
  const idx = stages.indexOf(stage);
  const wonStage = stages.find((st) => st.won);
  const lost = lead.outcome === 'lost';
  const days = lead.stageSince ? Math.max(0, Math.floor((Date.now() - Date.parse(lead.stageSince)) / DAY)) : null;
  const funnel = s.funnels[lead.segment];

  const ownerOptions = [...memberLabels(s)].map(([value, label]) => ({ value, label }));
  if (lead.ownerId && !ownerOptions.some((o) => o.value === lead.ownerId)) ownerOptions.push({ value: lead.ownerId, label: memberName(s, lead.ownerId, lead.owner) });

  const onDelete = () => {
    setMenu(false);
    const name = lead.title || lead.company;
    if (window.confirm(`Delete the deal "${name}"? Its products, to-dos and activity history are deleted too. The company and contacts are kept. This can't be undone.`)) void deleteDeal(lead.id);
  };

  return (
    <div className="card deal-header" style={{ padding: '16px 20px' }}>
      <div className="deal-crumb" data-testid="deal-crumb">
        <Link to={paths.pipeline} className="crumb-link">
          {funnel?.label ?? 'Pipeline'}
        </Link>
        <span aria-hidden>→</span>
        <span style={{ color: 'var(--ink)' }}>{stage.name}</span>
      </div>
      <div className="deal-header-top">
        <input className="ghost deal-title" aria-label="Deal name" data-testid="deal-title" value={lead.title ?? ''} placeholder={lead.company} onChange={(e) => patchLead(lead.id, { title: e.target.value })} />
        <div className="deal-actions">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-2)' }} title="Owner">
            <Icon name="owner" title="Owner" />
            <select className="form-input" aria-label="Owner" value={lead.ownerId ?? ''} onChange={(e) => patchLead(lead.id, { ownerId: e.target.value })} style={{ padding: '7px 9px' }}>
              {!lead.ownerId && <option value="">No owner</option>}
              {ownerOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {lost ? (
            <>
              <span data-testid="lost-state" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <span className="badge badge-danger" style={{ fontSize: 12 }}>
                  Lost · {lead.lostReason}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  {[lead.lostAt ? 'on ' + momentLabel(lead.lostAt, s.workspace.timezone) : '', lead.lostNote].filter(Boolean).join(' · ')}
                </span>
              </span>
              <button type="button" className="btn btn-secondary" onClick={() => reopenLead(lead.id)}>
                Reopen
              </button>
            </>
          ) : lead.outcome === 'won' ? (
            <>
              <span className="badge badge-brand" data-testid="won-state" style={{ fontSize: 12 }}>
                Won
              </span>
              <WonDealProjectAction projects={projects} onCreate={() => setCreating(true)} />
            </>
          ) : (
            <>
              {wonStage && (
                <button type="button" className="btn btn-won" data-testid="mark-won" onClick={() => moveLead(lead.id, wonStage.id)}>
                  Won
                </button>
              )}
              <button type="button" className="btn btn-lost" data-testid="mark-lost" onClick={() => set({ lostLeadId: lead.id })}>
                Lost
              </button>
            </>
          )}
          {canDelete && (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button type="button" className="btn btn-secondary" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)} style={{ padding: '10px 12px' }}>
                ⋯
              </button>
              {menu && (
                <div className="deal-menu" role="menu">
                  <button type="button" role="menuitem" onClick={onDelete}>
                    Delete deal
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="stage-bar" data-testid="stage-bar">
        {stages.map((st, i) => {
          const current = i === idx;
          const label = current && days !== null ? `${days} ${days === 1 ? 'day' : 'days'} · ${st.name}` : st.name;
          return (
            <button
              key={st.id}
              type="button"
              className={'stage-chev' + (current ? ' current' : i < idx ? ' done' : '') + (lost ? ' lost' : '')}
              title={current ? `${label} (current stage)` : `Move to ${st.name}`}
              aria-current={current ? 'step' : undefined}
              disabled={current || lost}
              onClick={() => moveLead(lead.id, st.id)}
            >
              {label}
            </button>
          );
        })}
      </div>
      {creating && <NewProjectFromDealDialog lead={lead} onClose={() => setCreating(false)} />}
    </div>
  );
}
