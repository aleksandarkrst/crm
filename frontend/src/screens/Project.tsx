import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChangeHistory } from '../components/ChangeHistory';
import { askConfirm } from '../components/ConfirmDialog';
import { Screen } from '../components/Layout';
import { Modal, ModalHeader } from '../components/ui';
import { paths } from '../lib/paths';
import { type ApiProject, type ApiProjectCancelReason, type ApiProjectHealth, PROJECT_CANCEL_REASONS, type ProjectPatch, projectsApi } from '../lib/projectsApi';
import { projectError, useDealDocuments, useProject, useProjectFiles, useProjectMembers, useProjectTypes } from '../store/projects';
import { companyLabels, companyRecords, curOf, memberLabels, timelineFor } from '../store/selectors';
import { useStore } from '../store/store';
import { useTasks } from '../store/tasks';
import { HEALTH_LABEL, ProjectStatusBadge, projectValue } from './lead/DealProjects';
import { dealEmails, ProjectCommunication } from './project/ProjectCommunication';
import { DropZone, ProjectDocuments, useFileUpload } from './project/ProjectDocuments';
import { ComingUp, ProjectPlan } from './project/ProjectPlan';
import { ProjectWorkOrders } from './project/ProjectWorkOrders';
import { NumberField, Row, TextField } from './project/fields';
import { ProjectTeam } from './project/ProjectTeam';
import { useTerms } from '../store/terms';

/**
 * A project's page (CD-234, design v2 §2), until the Projects module brings tasks, plan, team and
 * documents:
 * - header: crumb "Projects → company", the name (inline), Complete / Cancel project (reason
 *   dialog) or Reopen, "⋯ → Delete project" for owners and admins, and the type's stage bar;
 * - Details (code, type, lead, health, start, end, budget in hours, value, description) and Linked
 *   (company, deal, the deal's contact; a lost deal says so), all inline; another company clears the
 *   deal, after a confirmation;
 * - the Overview tab with the History (who changed what). Plan, Team, Communication, Documents and
 *   Report come with the screens that fill them (CD-263); "Coming up" and the file drop need tasks
 *   and project documents.
 * The lead, owners and admins change it; everyone else sees it read-only (the API agrees).
 */
export function Project() {
  const { id = '' } = useParams();
  const { s, session, flash, ensureLog } = useStore();
  const t = useTerms();
  const navigate = useNavigate();
  const { data: project, error, set } = useProject(id);
  const { data: types } = useProjectTypes();
  const { data: team, set: setTeam } = useProjectMembers(id);
  const { data: files, set: setFiles } = useProjectFiles(id);
  const { data: dealDocs } = useDealDocuments(project?.dealId);
  const { data: tasks, set: setTasks } = useTasks({ projectId: id }, !!id);
  const [tab, setTab] = useState<'overview' | 'plan' | 'team' | 'communication' | 'documents'>('overview');
  // The deal's timeline holds its emails (the Communication tab and its count).
  const dealId = project?.dealId;
  useEffect(() => {
    if (dealId) ensureLog([dealId]);
  }, [dealId, ensureLog]);
  const overviewUpload = useFileUpload(id, (f) => setFiles([f, ...(files ?? [])]));
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
      <Screen title={t.Project} parent={{ label: t.Projects, to: paths.projects }}>
        <div className="hint-box">{error ? `Couldn't load this ${t.project}: ${error}` : `Loading the ${t.project}`}</div>
      </Screen>
    );
  }

  const isAdmin = session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const canEdit = project.leadUserId === session.userId || isAdmin;
  const stages = types?.find((t) => t.id === project.projectTypeId)?.stages ?? [];
  const idx = stages.findIndex((st) => st.id === project.stageId);
  const closed = project.status !== 'open';
  // The team, the lead, owners and admins add tasks (CD-146), while the project is open.
  const me = s.team.find((m) => m.id === session.userId)?.employeeId ?? null;
  const canAddTasks = !closed && (canEdit || !!team?.some((m) => m.employeeId === me));

  // Field edits run side by side (each saves its own field); `busy` only disables the buttons, so a
  // quick second edit isn't dropped while the first one saves.
  const update = async (patch: ProjectPatch, done?: (p: ApiProject) => string): Promise<boolean> => {
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
    const yes = await askConfirm({ title: `Delete ${project.name}?`, message: `The ${t.project} and its history are deleted. The company and the deal are kept.`, confirmLabel: `Delete ${t.project}`, danger: true });
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
    <Screen title={t.Project} parent={{ label: t.Projects, to: paths.projects }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-testid="project-page">
        <div className="card deal-header" style={{ padding: '16px 20px' }}>
          <div className="deal-crumb">
            <Link to={paths.projects} className="crumb-link">
              {t.Projects}
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
              label={`${t.Project} name`}
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
                  <button type="button" className="btn btn-secondary" data-testid="reopen-project" disabled={busy} onClick={() => void update({ status: 'open' }, () => `${t.Project} reopened`)}>
                    Reopen
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-primary" data-testid="complete-project" disabled={busy} onClick={() => void update({ status: 'completed' }, () => `${t.Project} completed`)}>
                      Complete
                    </button>
                    <button type="button" className="btn btn-outline" data-testid="cancel-project" disabled={busy} onClick={() => setCancelling(true)} style={{ fontSize: 13, padding: '9px 14px' }}>
                      Cancel {t.project}
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
                        Delete {t.project}
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
                <Row label={`${t.Project} type`}>
                  <select
                    className="ghost ghost-sm"
                    aria-label={`${t.Project} type`}
                    data-testid="project-type-field"
                    value={project.projectTypeId}
                    disabled={!canEdit || busy}
                    onChange={(e) => void update({ projectTypeId: e.target.value }, (p) => `${p.name} is now a ${p.projectTypeName} ${t.project}, in ${p.stageName}`)}
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
                <Row label="Budget (h)">
                  <NumberField label="Budget in hours" testId="project-budget" value={project.budgetHours} disabled={!canEdit} step={0.5} placeholder="Not set" onSave={(budgetHours) => update({ budgetHours })} />
                </Row>
                <Row label="Value">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <NumberField label="Value" testId="project-value" value={project.value} disabled={!canEdit} step={1} placeholder="Not set" onSave={(value) => update({ value })} />
                    <span style={{ fontSize: 12.5, color: 'var(--text-2)', whiteSpace: 'nowrap' }} data-testid="project-value-text">
                      {projectValue(s, project) ?? project.currency ?? curOf(s).currency}
                    </span>
                  </span>
                </Row>
                <Row label="Description">
                  <TextField multiline className="ghost ghost-sm" label="Description" value={project.description ?? ''} disabled={!canEdit} placeholder={`What the ${t.project} delivers`} maxLength={5000} onSave={(v) => update({ description: v || null })} />
                </Row>
              </div>
            </div>
            <LinkedCard project={project} canEdit={canEdit} busy={busy} update={update} />
            <div className="card card-pad" data-testid="project-team-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Team · {team?.length ?? 0}</span>
                <button type="button" className="crumb-link" onClick={() => setTab('team')} style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontSize: 12.5 }}>
                  Manage
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
                {team?.length ? (
                  team.map((m) => (
                    <span key={m.employeeId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                      <span style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{m.role ?? `${m.hoursPerWeek} h / week`}</span>
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>No one is on this {t.project} yet.</span>
                )}
              </div>
            </div>
          </div>
          <div style={{ flex: '999 1 420px', minWidth: 0 }}>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }} data-testid="project-overview">
              <div style={{ display: 'flex', gap: 2, overflowX: 'auto', borderBottom: '1px solid var(--divider)', padding: '0 8px' }} role="tablist">
                {(
                  [
                    ['overview', 'Overview'],
                    ['plan', `Plan · ${tasks?.length ?? 0}`],
                    ['team', `Team · ${team?.length ?? 0}`],
                    ['communication', `Communication · ${project.dealId ? dealEmails(timelineFor(s, project.dealId)).length : 0}`],
                    ['documents', `Documents · ${(files?.length ?? 0) + (dealDocs ?? []).filter((d) => d.status === 'ready').length}`],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    data-testid={`project-tab-${k}`}
                    className="composer-tab"
                    onClick={() => setTab(k)}
                    style={{ borderBottom: `2px solid ${tab === k ? '#14503C' : 'transparent'}`, fontWeight: tab === k ? 600 : 500, color: tab === k ? '#14503C' : '#475750' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {tab === 'overview' ? (
                  <>
                    <ComingUp tasks={tasks} />
                    <DropZone testId="overview-drop" text="Drop a file here, or" button="Choose file" busy={overviewUpload.busy} onFiles={(fs) => void overviewUpload.add(fs, 'Client material')} />
                    <span className="caps">History</span>
                    <ChangeHistory entity="project" id={project.id} cur={curOf(s)} rev={project.version} />
                  </>
                ) : tab === 'plan' ? (
                  <>
                    <ProjectPlan projectId={project.id} tasks={tasks} stages={stages} canAdd={canAddTasks} onChange={setTasks} />
                    <ProjectWorkOrders projectId={project.id} canAdd={project.status === 'open'} />
                  </>
                ) : tab === 'team' ? (
                  <ProjectTeam projectId={project.id} team={team} canEdit={canEdit} onChange={setTeam} />
                ) : tab === 'communication' ? (
                  <ProjectCommunication project={project} />
                ) : (
                  <ProjectDocuments
                    projectId={project.id}
                    dealTitle={project.dealTitle}
                    files={files}
                    dealDocs={dealDocs ?? []}
                    canManage={(f) => canEdit || f.addedByUserId === session.userId}
                    onChange={setFiles}
                  />
                )}
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
            if (await update({ status: 'cancelled', cancelReason: reason }, () => `${t.Project} cancelled`)) setCancelling(false);
          }}
        />
      )}
    </Screen>
  );
}

/** The company and the deal (spec 3.2): the deal is one of the company's, won first; lost ones aren't offered. */
function LinkedCard({ project, canEdit, busy, update }: { project: ApiProject; canEdit: boolean; busy: boolean; update: (patch: ProjectPatch, done?: (p: ApiProject) => string) => Promise<boolean> }) {
  const { s } = useStore();
  const t = useTerms();
  const records = companyRecords(s);
  const labels = companyLabels(records);
  const deals = s.leads
    .filter((l) => l.companyId === project.companyId && (l.outcome !== 'lost' || l.id === project.dealId))
    .sort((a, b) => Number(b.outcome === 'won') - Number(a.outcome === 'won'));

  const moveCompany = async (companyId: string) => {
    if (companyId === project.companyId) return;
    const name = records.find((r) => r.id === companyId)?.name ?? 'the other company';
    if (project.dealId) {
      const yes = await askConfirm({ title: `Move ${project.name} to ${name}?`, message: `The link to the deal ${project.dealTitle ?? ''} is removed: a ${t.project}'s deal is always one of its company's.`, confirmLabel: `Move ${t.project}` });
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
        <Row label="Contact">
          {project.contactId ? (
            <Link to={paths.contact(project.contactId)} className="crumb-link" data-testid="project-contact">
              {project.contactName}
            </Link>
          ) : (
            <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{project.dealId ? 'The deal has no contact' : 'Comes with the deal'}</span>
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
  const t = useTerms();
  const [reason, setReason] = useState<ApiProjectCancelReason | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Modal maxWidth={480} onBackdrop={onClose}>
      <ModalHeader title={`Cancel this ${t.project}?`} sub={`Open ${t.tasks} stay as they are and ${name} leaves the workload. You can reopen it later.`} />
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
          Keep {t.project}
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
          Cancel {t.project}
        </button>
      </div>
    </Modal>
  );
}
