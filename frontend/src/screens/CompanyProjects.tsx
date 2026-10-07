import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AddButton, Section } from '../components/RecordParts';
import { paths } from '../lib/paths';
import type { ApiProject } from '../lib/projectsApi';
import { useCompanyProjects } from '../store/projects';
import { useStore } from '../store/store';
import { HealthBadge, ProjectStatusBadge } from './lead/DealProjects';

/**
 * The company page's Projects card (CD-234, spec 5): its open projects with stage, lead and health;
 * completed and cancelled ones under "Show closed (N)"; "+" starts a project for this company. Every
 * member sees it; it updates live (live hint `project`). Hours come with time entries (milestone 15).
 */
export function CompanyProjects({ companyId }: { companyId: string }) {
  const { set } = useStore();
  const navigate = useNavigate();
  const { data: projects, error } = useCompanyProjects(companyId);
  const [showClosed, setShowClosed] = useState(false);
  const open = (projects ?? []).filter((p) => p.status === 'open');
  const closed = (projects ?? []).filter((p) => p.status !== 'open');

  const row = (p: ApiProject) => (
    <button
      key={p.id}
      type="button"
      data-testid="company-project"
      onClick={() => navigate(paths.project(p.id))}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', border: 0, borderTop: '1px solid var(--divider)', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%', font: 'inherit' }}
    >
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--brand)' }}>{p.code ? `${p.code} · ${p.name}` : p.name}</span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {p.stageName} · {p.leadName ?? 'No lead'}
        </span>
      </span>
      {p.status === 'open' ? <HealthBadge health={p.health} /> : <ProjectStatusBadge status={p.status} />}
    </button>
  );

  return (
    <Section title="Projects" testId="company-projects" action={<AddButton label="Add a project" testId="company-add-project" onClick={() => set({ newProject: { companyId } })} />}>
      {!projects ? (
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{error ? `Couldn't load projects: ${error}` : 'Loading projects'}</span>
      ) : projects.length === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>No projects for this company yet.</span>
      ) : (
        <>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Open projects ({open.length})</span>
          {open.map(row)}
          {closed.length > 0 && (
            <>
              <button type="button" className="btn-link" data-testid="company-projects-closed" onClick={() => setShowClosed((v) => !v)} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: '8px 0 0', cursor: 'pointer', color: 'var(--brand)', fontSize: 12.5 }}>
                {showClosed ? 'Hide closed projects' : `Show closed (${closed.length})`}
              </button>
              {showClosed && closed.map(row)}
            </>
          )}
        </>
      )}
    </Section>
  );
}
