import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { type ApiProject, projectsApi } from '../lib/projectsApi';
import { projectError, useProject, useProjectTypes } from '../store/projects';
import { useStore } from '../store/store';
import { PROJECT_STATUS_LABEL, ProjectStatusBadge } from './lead/DealProjects';

/**
 * A project's page (CD-275), until the Projects module (CD-229) brings its board, plan, team and
 * documents: the header with the type's stage bar (click a stage to move the project there),
 * Complete or Reopen, and the details with links to the company and the deal. The lead, owners and
 * admins change it (the API refuses others); everyone else sees it read-only.
 */
export function Project() {
  const { id = '' } = useParams();
  const { session, flash } = useStore();
  const { data: project, error, set } = useProject(id);
  const { data: types } = useProjectTypes();
  const [busy, setBusy] = useState(false);

  if (!project) {
    return (
      <Screen title="Project">
        <div className="hint-box">{error ? `Couldn't load this project: ${error}` : 'Loading the project'}</div>
      </Screen>
    );
  }

  const canEdit = project.leadUserId === session.userId || session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const stages = types?.find((t) => t.id === project.projectTypeId)?.stages ?? [];
  const idx = stages.findIndex((st) => st.id === project.stageId);
  const closed = project.status !== 'open';

  const update = async (patch: Parameters<typeof projectsApi.updateProject>[1], done: (p: ApiProject) => string) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await projectsApi.updateProject(project.id, patch);
      set(next);
      flash(done(next));
    } catch (err) {
      flash(projectError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Project" parent={{ label: project.companyName, to: paths.company(project.companyId) }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-testid="project-page">
        <div className="card deal-header" style={{ padding: '16px 20px' }}>
          <div className="deal-crumb">
            <Link to={paths.company(project.companyId)} className="crumb-link">
              {project.companyName}
            </Link>
            <span aria-hidden>→</span>
            <span style={{ color: 'var(--ink)' }}>{project.stageName}</span>
          </div>
          <div className="deal-header-top">
            <span className="deal-title" data-testid="project-title" style={{ padding: '3px 0', marginLeft: 0 }}>
              {project.name}
            </span>
            <div className="deal-actions">
              <ProjectStatusBadge status={project.status} />
              {canEdit &&
                (closed ? (
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void update({ status: 'open' }, () => 'Project reopened')}>
                    Reopen
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" data-testid="complete-project" disabled={busy} onClick={() => void update({ status: 'completed' }, () => 'Project completed')}>
                    Complete
                  </button>
                ))}
            </div>
          </div>
          {stages.length > 0 && (
            <div className="stage-bar" data-testid="project-stage-bar">
              {stages.map((st, i) => {
                const current = i === idx;
                return (
                  <button
                    key={st.id}
                    type="button"
                    className={'stage-chev' + (current ? ' current' : i < idx ? ' done' : '')}
                    title={current ? `${st.name} (current stage)` : `Move to ${st.name}`}
                    aria-current={current ? 'step' : undefined}
                    disabled={current || closed || !canEdit || busy}
                    onClick={() => void update({ stageId: st.id }, (p) => `Moved to ${p.stageName}`)}
                  >
                    {st.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <div className="card card-pad" style={{ flex: '1 1 360px', maxWidth: 540, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Details</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--divider)', fontSize: 13.5 }} data-testid="project-details">
              <Detail label="Project type">{project.projectTypeName}</Detail>
              <Detail label="Stage">{project.stageName}</Detail>
              <Detail label="Status">{PROJECT_STATUS_LABEL[project.status]}</Detail>
              <Detail label="Lead">{project.leadName ?? 'No lead'}</Detail>
              <Detail label="Company">
                <Link to={paths.company(project.companyId)} className="crumb-link">
                  {project.companyName}
                </Link>
              </Detail>
              <Detail label="Deal">
                {project.dealId ? (
                  <Link to={paths.lead(project.dealId)} className="crumb-link" data-testid="project-deal-link">
                    {project.dealTitle}
                  </Link>
                ) : (
                  'No deal'
                )}
              </Detail>
            </div>
          </div>
          <div className="card card-pad" style={{ flex: '999 1 420px', minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Plan</span>
            <div className="hint-box" style={{ marginTop: 12 }}>
              Tasks, the team, documents and the report come with the Projects module. For now the project keeps its stage, status and links to the company and the deal.
            </div>
          </div>
        </div>
      </div>
    </Screen>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 120px', color: 'var(--text-2)' }}>{label}</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
