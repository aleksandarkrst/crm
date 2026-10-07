import { Link, useNavigate } from 'react-router-dom';
import { Icon, IconRow } from '../../components/icons';
import { paths } from '../../lib/paths';
import type { ApiProject, ApiProjectHealth, ApiProjectStatus } from '../../lib/projectsApi';

export const PROJECT_STATUS_LABEL: Record<ApiProjectStatus, string> = { open: 'Open', completed: 'Completed', cancelled: 'Cancelled' };
const STATUS_BADGE: Record<ApiProjectStatus, string> = { open: 'badge badge-brand', completed: 'badge badge-neutral', cancelled: 'badge badge-danger' };

export function ProjectStatusBadge({ status }: { status: ApiProjectStatus }) {
  return <span className={STATUS_BADGE[status]}>{PROJECT_STATUS_LABEL[status]}</span>;
}

export const HEALTH_LABEL: Record<ApiProjectHealth, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
const HEALTH_BADGE: Record<ApiProjectHealth, string> = { on_track: 'badge badge-brand', at_risk: 'badge badge-warn', off_track: 'badge badge-danger' };

/** Design v2: On track (brand), At risk (warn), Off track (danger). */
export function HealthBadge({ health }: { health: ApiProjectHealth }) {
  return <span className={HEALTH_BADGE[health]}>{HEALTH_LABEL[health]}</span>;
}

/**
 * The won deal's project action (CD-275): **Create project** while no project links to the deal,
 * **Open project** (its newest) once one does.
 */
export function WonDealProjectAction({ projects, onCreate }: { projects: ApiProject[] | null; onCreate: () => void }) {
  const navigate = useNavigate();
  if (!projects) return null;
  const latest = projects[0];
  return latest ? (
    <button type="button" className="btn btn-outline" data-testid="open-project" onClick={() => navigate(paths.project(latest.id))} style={{ fontSize: 13, padding: '9px 14px' }}>
      Open project
    </button>
  ) : (
    <button type="button" className="btn btn-primary" data-testid="create-project" onClick={onCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <Icon name="projects" size={15} />
      Create project
    </button>
  );
}

/** The Summary's "Project" row: each project of the deal with its status (CD-275). Nothing when there are none. */
export function DealProjectsRow({ projects }: { projects: ApiProject[] | null }) {
  if (!projects?.length) return null;
  return (
    <IconRow icon="projects" label={projects.length === 1 ? 'Project' : 'Projects'}>
      <span data-testid="deal-projects" style={{ padding: '6px 9px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        {projects.map((p) => (
          <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Link to={paths.project(p.id)} className="crumb-link" style={{ fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name}
            </Link>
            <ProjectStatusBadge status={p.status} />
          </span>
        ))}
      </span>
    </IconRow>
  );
}
