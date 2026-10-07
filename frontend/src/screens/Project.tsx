import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChangeHistory } from '../components/ChangeHistory';
import { askConfirm } from '../components/ConfirmDialog';
import { Screen } from '../components/Layout';
import { Modal, ModalHeader } from '../components/ui';
import { paths } from '../lib/paths';
import { type ApiProject, type ApiProjectCancelReason, type ApiProjectHealth, PROJECT_CANCEL_REASONS, type ProjectPatch, projectsApi } from '../lib/projectsApi';
import { projectError, useProject, useProjectTypes } from '../store/projects';
import { companyLabels, companyRecords, curOf, memberLabels } from '../store/selectors';
import { useStore } from '../store/store';
import { HEALTH_LABEL, ProjectStatusBadge } from './lead/DealProjects';

/**
 * A project's page (CD-234, design v2 §2), until the Projects module brings tasks, plan, team and
 * documents:
 * - header: crumb "Projects → company", the name (inline), Complete / Cancel project (reason
 *   dialog) or Reopen, "⋯ → Delete project" for owners and admins, and the type's stage bar;
 * - Details (code, type, lead, health, start, end, description) and Linked (company, deal; a lost
 *   deal says so), all inline; another company clears the deal, after a confirmation;
 * - History (who changed what).
 * The lead, owners and admins change it; everyone else sees it read-only (the API agrees).
 */
export function Project() {
  const { id = '' } = useParams();
  const { s, session, flash } = useStore();
  const navigate = useNavigate();
  const { data: project, error, set } = useProject(id);
  const { data: types } = useProjectTypes();
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);

  if (!project) {
    return (
      <Screen title="Project" parent={{ label: 'Projects', to: paths.projects }}>
        <div className="hint-box">{error ? `Couldn't load this project: ${error}` : 'Loading the project'}</div>
      </Screen>
    );
  }

  const isAdmin = session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const canEdit = project.leadUserId === session.userId || isAdmin;
  const stages = types?.find((t) => t.id === project.projectTypeId)?.stages ?? [];
  const idx = stages.findIndex((st) => st.id === project.stageId);
  const closed = project.status !== 'open';

  const update = async (patch: ProjectPatch, done?: (p: ApiProject) => string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      const next = await projectsApi.updateProject(project.id, patch);
      set(next);
      if (done) flash(done(next));
      return true;
    } catch (err) {
      flash(projectError(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setMenu(false);
    const yes = await askConfirm({ title: `Delete ${project.name}?`, message: 'The project and its history are deleted. The company and the deal are kept.', confirmLabel: 'Delete project', danger: true });
    if (!yes) return;
    try {
      await projectsApi.deleteProject(project.id);
      flash(`${project.name} deleted`);
      navigate(paths.projects);
    } catch (err) {
      flash(projectError(err));
    }
  };

  return (
    <Screen title="Project" parent={{ label: 'Projects', to: paths.projects }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-testid="project-page">
        <div className="card deal-header" style={{ padding: '16px 20px' }}>
          <div className="deal-crumb">
            <Link to={paths.projects} className="crumb-link">
              Projects
            </Link>
            <span aria-hidden>→</span>
            <Link to={paths.company(project.companyId)} className="crumb-link" style={{ color: 'var(--ink)' }}>
              {project.companyName}
            </Link>
          </div>
          <div className="deal-header-top">
            <TextField
              className="ghost deal-title"
              testId="project-title"
              label="Project name"
              value={project.name}
              disabled={!canEdit}
              required
              onSave={(name) => update({ name })}
            />
            <div className="deal-actions">
              <ProjectStatusBadge status={project.status} />
              {project.status === 'cancelled' && project.cancelReason && <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{project.cancelReason}</span>}
              {canEdit &&
                (closed ? (
                  <button type="button" className="btn btn-secondary" data-testid="reopen-project" disabled={busy} onClick={() => void update({ status: 'open' }, () => 'Project reopened')}>
                    Reopen
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-primary" data-testid="complete-project" disabled={busy} onClick={() => void update({ status: 'completed' }, () => 'Project completed')}>
                      Complete
                    </button>
                    <button type="button" className="btn btn-outline" data-testid="cancel-project" disabled={busy} onClick={() => setCancelling(true)} style={{ fontSize: 13, padding: '9px 14px' }}>
                      Cancel project
                    </button>
                  </>
                ))}
              {isAdmin && (
                <div ref={menuRef} style={{ position: 'relative' }}>
                  <button type="button" className="btn btn-secondary" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)} style={{ padding: '10px 12px' }}>
                    ⋯
                  </button>
                  {menu && (
                    <div className="deal-menu" role="menu">
                      <button type="button" role="menuitem" data-testid="delete-project" onClick={() => void remove()}>
                        Delete project
                      </button>
                    </div>
                  )}
                </div>
              )}
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
          <div style={{ flex: '1 1 360px', maxWidth: 540, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card card-pad">
              <span style={{ fontSize: 15, fontWeight: 600 }}>Details</span>
              <div className="project-fields" data-testid="project-details">
                <Row label="Code">
                  <TextField className="ghost ghost-sm" label="Code" value={project.code ?? ''} disabled={!canEdit} placeholder="None" maxLength={20} onSave={(v) => update({ code: v || null })} />
                </Row>
                <Row label="Project type">
                  <select
                    className="ghost ghost-sm"
                    aria-label="Project type"
                    data-testid="project-type-field"
                    value={project.projectTypeId}
                    disabled={!canEdit || busy}
                    onChange={(e) => void update({ projectTypeId: e.target.value }, (p) => `${p.name} is now a ${p.projectTypeName} project, in ${p.stageName}`)}
                  >
                    {(types ?? [{ id: project.projectTypeId, name: project.projectTypeName }]).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Lead">
                  <select className="ghost ghost-sm" aria-label="Lead" data-testid="project-lead-field" value={project.leadUserId ?? ''} disabled={!canEdit || busy} onChange={(e) => void update({ leadUserId: e.target.value }, (p) => `${p.leadName ?? 'Someone'} leads ${p.name} now`)}>
                    {!project.leadUserId && <option value="">No lead</option>}
                    {[...memberLabels(s)].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                    {project.leadUserId && !memberLabels(s).has(project.leadUserId) && <option value={project.leadUserId}>{project.leadName ?? 'Former member'}</option>}
                  </select>
                </Row>
                <Row label="Health">
                  <select className="ghost ghost-sm" aria-label="Health" data-testid="project-health" value={project.health} disabled={!canEdit || busy} onChange={(e) => void update({ health: e.target.value as ApiProjectHealth })}>
                    {Object.entries(HEALTH_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Start">
                  <input className="ghost ghost-sm" type="date" aria-label="Start" value={project.startDate ?? ''} disabled={!canEdit || busy} onChange={(e) => void update({ startDate: e.target.value || null })} />
                </Row>
                <Row label="End">
                  <input className="ghost ghost-sm" type="date" aria-label="End" value={project.endDate ?? ''} disabled={!canEdit || busy} onChange={(e) => void update({ endDate: e.target.value || null })} />
                </Row>
                <Row label="Description">
                  <TextField multiline className="ghost ghost-sm" label="Description" value={project.description ?? ''} disabled={!canEdit} placeholder="What the project delivers" maxLength={5000} onSave={(v) => update({ description: v || null })} />
                </Row>
              </div>
            </div>
            <LinkedCard project={project} canEdit={canEdit} busy={busy} update={update} />
          </div>
          <div style={{ flex: '999 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card card-pad">
              <span style={{ fontSize: 15, fontWeight: 600 }}>Plan</span>
              <div className="hint-box" style={{ marginTop: 12 }}>
                Tasks, the team, documents and the report come with the rest of the Projects module.
              </div>
            </div>
            <div className="card card-pad">
              <span style={{ fontSize: 15, fontWeight: 600 }}>History</span>
              <div style={{ marginTop: 12 }}>
                <ChangeHistory entity="project" id={project.id} cur={curOf(s)} rev={project.version} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {cancelling && (
        <CancelDialog
          name={project.name}
          onClose={() => setCancelling(false)}
          onCancel={async (reason) => {
            if (await update({ status: 'cancelled', cancelReason: reason }, () => 'Project cancelled')) setCancelling(false);
          }}
        />
      )}
    </Screen>
  );
}

/** The company and the deal (spec 3.2): the deal is one of the company's, won first; lost ones aren't offered. */
function LinkedCard({ project, canEdit, busy, update }: { project: ApiProject; canEdit: boolean; busy: boolean; update: (patch: ProjectPatch, done?: (p: ApiProject) => string) => Promise<boolean> }) {
  const { s } = useStore();
  const records = companyRecords(s);
  const labels = companyLabels(records);
  const deals = s.leads
    .filter((l) => l.companyId === project.companyId && (l.outcome !== 'lost' || l.id === project.dealId))
    .sort((a, b) => Number(b.outcome === 'won') - Number(a.outcome === 'won'));

  const moveCompany = async (companyId: string) => {
    if (companyId === project.companyId) return;
    const name = records.find((r) => r.id === companyId)?.name ?? 'the other company';
    if (project.dealId) {
      const yes = await askConfirm({ title: `Move ${project.name} to ${name}?`, message: `The link to the deal ${project.dealTitle ?? ''} is removed: a project's deal is always one of its company's.`, confirmLabel: 'Move project' });
      if (!yes) return;
    }
    await update({ companyId }, (p) => `${p.name} moved to ${p.companyName}`);
  };

  return (
    <div className="card card-pad" data-testid="project-linked">
      <span style={{ fontSize: 15, fontWeight: 600 }}>Linked</span>
      <div className="project-fields">
        <Row label="Company">
          {canEdit ? (
            <select className="ghost ghost-sm" aria-label="Company" data-testid="project-company-field" value={project.companyId} disabled={busy} onChange={(e) => void moveCompany(e.target.value)}>
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {labels.get(r.id) ?? r.name}
                </option>
              ))}
              {!records.some((r) => r.id === project.companyId) && <option value={project.companyId}>{project.companyName}</option>}
            </select>
          ) : (
            <Link to={paths.company(project.companyId)} className="crumb-link">
              {project.companyName}
            </Link>
          )}
        </Row>
        <Row label="Deal">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            {canEdit ? (
              <select className="ghost ghost-sm" aria-label="Deal" data-testid="project-deal-field" value={project.dealId ?? ''} disabled={busy} onChange={(e) => void update({ dealId: e.target.value || null })} style={{ flex: 1, minWidth: 0 }}>
                <option value="">No deal</option>
                {deals.map((l) => (
                  <option key={l.id} value={l.id}>
                    {(l.title || l.company) + (l.outcome === 'open' ? ' · Open' : l.outcome === 'lost' ? ' · Lost' : '')}
                  </option>
                ))}
              </select>
            ) : project.dealId ? (
              <span>{project.dealTitle}</span>
            ) : (
              <span style={{ color: 'var(--text-2)' }}>No deal</span>
            )}
            {project.dealId && (
              <Link to={paths.lead(project.dealId)} className="crumb-link" data-testid="project-deal-link" style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>
                Open deal
              </Link>
            )}
            {project.dealLost && <span className="badge badge-danger">Deal lost</span>}
          </span>
        </Row>
      </div>
    </div>
  );
}

/** Design v2 §2: "Cancel this project?" with the reason pills. */
function CancelDialog({ name, onClose, onCancel }: { name: string; onClose: () => void; onCancel: (reason: ApiProjectCancelReason) => Promise<void> }) {
  const [reason, setReason] = useState<ApiProjectCancelReason | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Modal maxWidth={480} onBackdrop={onClose}>
      <ModalHeader title="Cancel this project?" sub={`Open tasks stay as they are and ${name} leaves the workload. You can reopen it later.`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="caps">Reason</span>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }} data-testid="cancel-reasons">
          {PROJECT_CANCEL_REASONS.map((r) => (
            <button key={r} type="button" className={'reason-pill' + (reason === r ? ' on' : '')} aria-pressed={reason === r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Keep project
        </button>
        <button
          type="button"
          className={reason && !saving ? 'btn btn-primary' : 'btn btn-disabled'}
          disabled={!reason || saving}
          data-testid="confirm-cancel-project"
          onClick={async () => {
            if (!reason) return;
            setSaving(true);
            await onCancel(reason);
            setSaving(false);
          }}
        >
          Cancel project
        </button>
      </div>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

/** Text that saves when it loses focus (Enter too, unless multi-line); Escape puts the saved value back. */
function TextField({
  value,
  onSave,
  label,
  className,
  testId,
  disabled,
  placeholder,
  maxLength,
  multiline,
  required,
}: {
  value: string;
  onSave: (v: string) => Promise<boolean>;
  label: string;
  className: string;
  testId?: string;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  required?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async () => {
    const next = draft.trim();
    if (next === value.trim()) return setDraft(value);
    if (required && !next) return setDraft(value);
    if (!(await onSave(next))) setDraft(value);
  };
  const common = {
    className,
    'aria-label': label,
    'data-testid': testId,
    value: draft,
    disabled,
    placeholder,
    maxLength,
    onBlur: () => void commit(),
  };
  return multiline ? (
    <textarea {...common} rows={3} style={{ resize: 'vertical', lineHeight: 1.5, flex: 1 }} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setDraft(value)} />
  ) : (
    <input
      {...common}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}
