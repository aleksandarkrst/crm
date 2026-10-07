import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, IconRow } from '../../components/icons';
import { Modal, ModalHeader } from '../../components/ui';
import { paths } from '../../lib/paths';
import { type ApiProject, type ApiProjectStatus, projectsApi } from '../../lib/projectsApi';
import { projectError, useProjectTypes } from '../../store/projects';
import { memberLabels } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

export const PROJECT_STATUS_LABEL: Record<ApiProjectStatus, string> = { open: 'Open', completed: 'Completed', cancelled: 'Cancelled' };
const STATUS_BADGE: Record<ApiProjectStatus, string> = { open: 'badge badge-brand', completed: 'badge badge-neutral', cancelled: 'badge badge-danger' };

export function ProjectStatusBadge({ status }: { status: ApiProjectStatus }) {
  return <span className={STATUS_BADGE[status]}>{PROJECT_STATUS_LABEL[status]}</span>;
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

/**
 * "New project from deal" (CD-275, design v2 §11): the deal's company and the deal are linked; the
 * name starts as the deal's title, the type as the first one, the lead as the person creating it.
 * Creating opens the project. "Add starter tasks from the products" comes with project tasks (CD-146).
 */
export function NewProjectFromDealDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { s, session, flash } = useStore();
  const navigate = useNavigate();
  const { data: types, error } = useProjectTypes();
  const [name, setName] = useState(lead.title || lead.company);
  const [typeId, setTypeId] = useState('');
  const [leadUserId, setLeadUserId] = useState(session.userId);
  const [saving, setSaving] = useState(false);
  const type = types?.find((t) => t.id === typeId) ?? types?.[0];
  const leads = [...memberLabels(s)].map(([value, label]) => ({ value, label }));
  const dealName = lead.title || lead.company;
  const blocked = !lead.companyId ? 'Add a company to the deal first: a project always belongs to a company.' : !name.trim() ? 'Give the project a name.' : null;

  const create = async () => {
    if (blocked || !type || saving) return;
    setSaving(true);
    try {
      const project = await projectsApi.createProject({ name: name.trim(), projectTypeId: type.id, companyId: lead.companyId!, dealId: lead.id, leadUserId });
      flash(`Project created from ${dealName}`);
      onClose();
      navigate(paths.project(project.id));
    } catch (err) {
      flash(projectError(err));
      setSaving(false);
    }
  };

  return (
    <Modal maxWidth={600} onBackdrop={onClose}>
      <ModalHeader title="New project from deal" sub="The company, contact, emails and files from the deal are linked to the project." />
      <div className="hint-box" data-testid="project-deal-summary" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{lead.company}</span>
        <span>·</span>
        <span>{dealName}</span>
        <span>·</span>
        <span style={{ color: 'var(--brand)' }}>{lead.value}</span>
      </div>
      <label className="form-label">
        Project name
        <input className="form-input" data-testid="project-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label className="form-label">
          Project type
          <select className="form-input" data-testid="project-type" value={type?.id ?? ''} onChange={(e) => setTypeId(e.target.value)} disabled={!types}>
            {(types ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Project lead
          <select className="form-input" data-testid="project-lead" value={leadUserId} onChange={(e) => setLeadUserId(e.target.value)}>
            {leads.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caps">Stages</span>
        <span data-testid="project-stages" style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {error ? `Couldn't load project types: ${error}` : type ? type.stages.map((st) => st.name).join(' → ') : 'Loading'}
        </span>
      </div>
      {!lead.companyId && <div className="hint-box">{blocked}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={blocked || !type || saving ? 'btn btn-disabled' : 'btn btn-primary'} disabled={!!blocked || !type || saving} data-testid="create-project-submit" onClick={() => void create()}>
          {saving ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </Modal>
  );
}
