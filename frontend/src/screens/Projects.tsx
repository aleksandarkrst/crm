import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DataActions } from '../components/DataActions';
import { Screen } from '../components/Layout';
import { FilterBar } from '../components/ui';
import { paths } from '../lib/paths';
import { type ApiProject, type ApiProjectHealth, type ApiProjectStatus, projectsApi } from '../lib/projectsApi';
import { projectsCsv } from '../store/exportCsv';
import { projectError, useProjects, useProjectTypes } from '../store/projects';
import { memberLabels, moneyTotal } from '../store/selectors';
import { useStore } from '../store/store';
import { useTerms } from '../store/terms';
import { HealthBadge, ProjectStatusBadge, projectValue } from './lead/DealProjects';
import { AvatarStack } from './task/parts';
import { type ApiTask, TASK_STATUSES } from '../lib/tasksApi';
import { useTasks } from '../store/tasks';
import { DueLabel } from './task/parts';

type View = 'board' | 'list';
const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'board', label: 'Board', icon: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v7h-4z' },
  { id: 'list', label: 'List', icon: 'M4 6h16M4 12h16M4 18h16' },
];
const viewKey = (userId: string, tenantId: string) => `crm.projectsView.${userId}.${tenantId}`;

const STATUS_FILTER: { value: ApiProjectStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const HEALTH_FILTER: { value: ApiProjectHealth; label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'off_track', label: 'Off track' },
];

const shortDate = (iso: string | null) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Projects (CD-234, design v2 §1): a board of the selected project type (its stages are the columns;
 * drag a card to move the project) and a list of every project. Filters: lead, health and status
 * (Open by default). Won deals without a project get a hint with "New project". The view is
 * remembered per person and workspace in this browser.
 */
export function Projects() {
  const { s, set, session, flash } = useStore();
  const t = useTerms();
  const navigate = useNavigate();
  const { data: projects, error, set: setProjects } = useProjects();
  const { data: types } = useProjectTypes();
  // The tasks the caller can see (CD-263): each card's progress and next open tasks.
  const { data: tasks } = useTasks();
  const work = useMemo(() => workByProject(tasks ?? []), [tasks]);
  const [params, setParams] = useSearchParams();
  const [view, setViewState] = useState<View>(() => {
    try {
      return localStorage.getItem(viewKey(session.userId, session.tenant.id)) === 'list' ? 'list' : 'board';
    } catch {
      return 'board';
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(viewKey(session.userId, session.tenant.id), v);
    } catch {
      // No storage: the choice lasts until the page is left.
    }
  };
  const [lead, setLead] = useState('Lead');
  const [health, setHealth] = useState('Health');
  const [status, setStatus] = useState<ApiProjectStatus>('open');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const type = types?.find((t) => t.id === params.get('type')) ?? types?.[0];
  const leads = [...memberLabels(s)].map(([value, label]) => ({ value, label }));
  const shown = (projects ?? [])
    .filter((p) => p.status === status)
    .filter((p) => lead === 'Lead' || p.leadUserId === lead)
    .filter((p) => health === 'Health' || p.health === health);
  const onBoard = shown.filter((p) => p.projectTypeId === type?.id);
  // "Export filter results" (CD-278): the projects the current view shows.
  const exported = view === 'board' ? onBoard : shown;
  const dirty = lead !== 'Lead' || health !== 'Health' || status !== 'open';
  const linked = new Set((projects ?? []).map((p) => p.dealId).filter(Boolean));
  const unlinkedWon = s.leads.filter((l) => l.outcome === 'won' && l.companyId && !linked.has(l.id));
  const canEdit = (p: ApiProject) => p.leadUserId === session.userId || session.tenant.role === 'owner' || session.tenant.role === 'admin';

  const moveTo = async (p: ApiProject, stageId: string) => {
    if (p.stageId === stageId) return;
    if (!canEdit(p)) return flash(`Only the ${t.project} lead, owners and admins can move this ${t.project}`);
    const before = projects ?? [];
    const stage = type?.stages.find((st) => st.id === stageId);
    setProjects(before.map((x) => (x.id === p.id ? { ...x, stageId, stageName: stage?.name ?? x.stageName } : x)));
    try {
      const saved = await projectsApi.updateProject(p.id, { stageId });
      setProjects(before.map((x) => (x.id === p.id ? saved : x)));
      flash(`${p.name} moved to ${saved.stageName}`);
    } catch (err) {
      setProjects(before);
      flash(projectError(err));
    }
  };

  return (
    <Screen title={t.Projects}>
      <FilterBar
        lead={
          <>
            <div className="view-toggle" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" title={v.label} aria-label={v.label} aria-pressed={view === v.id} data-testid={`projects-view-${v.id}`} onClick={() => setView(v.id)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={v.icon} />
                  </svg>
                </button>
              ))}
            </div>
            {view === 'board' && (
              <div className="funnel-select">
                <select aria-label={`${t.Project} type`} data-testid="projects-type" value={type?.id ?? ''} onChange={(e) => setParams({ type: e.target.value }, { replace: true })}>
                  {(types ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button type="button" title={`Edit ${t.project} type`} aria-label={`Edit ${t.project} type`} data-testid="projects-edit-type" onClick={() => navigate(paths.settings('project-types') + (type ? `?type=${type.id}` : ''))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
                  </svg>
                </button>
              </div>
            )}
          </>
        }
        chips={[
          { value: lead, options: ['Lead', ...leads], onChange: setLead },
          { value: health, options: ['Health', ...HEALTH_FILTER], onChange: setHealth },
          { value: status, options: STATUS_FILTER, onChange: (v) => setStatus(v as ApiProjectStatus), keepFirst: true },
        ]}
        dirty={dirty}
        onClear={() => {
          setLead('Lead');
          setHealth('Health');
          setStatus('open');
        }}
        meta={projects ? `${plural(view === 'board' ? onBoard.length : shown.length, `${STATUS_FILTER.find((x) => x.value === status)!.label.toLowerCase()} ${t.project}`, `${STATUS_FILTER.find((x) => x.value === status)!.label.toLowerCase()} ${t.projects}`)}` : undefined}
        action={{ label: `New ${t.project}`, onClick: () => set({ newProject: {} }) }}
        extra={projects ? <DataActions type="projects" count={exported.length} exportCsv={() => projectsCsv(exported)} /> : undefined}
      />

      {unlinkedWon.length > 0 && (
        <div className="hint-box" data-testid="won-without-project" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ flex: '1 1 300px' }}>
            {unlinkedWon.length === 1 ? `1 won deal has no ${t.project} yet: ` : `${unlinkedWon.length} won deals have no ${t.project} yet, for example `}
            <b style={{ color: 'var(--ink)' }}>
              {unlinkedWon[0]!.company} · {unlinkedWon[0]!.title || unlinkedWon[0]!.company}
            </b>
          </span>
          <button type="button" className="btn btn-outline" onClick={() => set({ newProject: { dealId: unlinkedWon[0]!.id } })}>
            New {t.project}
          </button>
        </div>
      )}

      {!projects ? (
        <div className="hint-box">{error ? `Couldn't load ${t.projects}: ${error}` : `Loading ${t.projects}`}</div>
      ) : view === 'list' ? (
        <ProjectsList projects={shown} work={tasks ? work : null} onOpen={(id) => navigate(paths.project(id))} />
      ) : (
        <div className="pipeline-board" style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '0 -30px -44px', padding: '0 30px', minHeight: 'calc(100vh - 118px)' }}>
          <div className="pipeline-columns" data-testid="projects-board" style={{ display: 'flex', gap: 14, overflowX: 'auto', alignItems: 'stretch', flex: 1, minHeight: 420 }}>
            {(type?.stages ?? []).map((st, ci, all) => {
              const cards = onBoard.filter((p) => p.stageId === st.id);
              const active = dragOver === st.id;
              const first = ci === 0;
              const last = ci === all.length - 1;
              return (
                <div
                  key={st.id}
                  data-testid="projects-column"
                  data-stage={st.name}
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
                    const p = onBoard.find((x) => x.id === id);
                    if (p) void moveTo(p, st.id);
                  }}
                  style={{ flex: '0 0 268px', width: 268, border: `1px solid ${active ? '#14503C' : 'transparent'}`, borderRadius: '6px 6px 0 0', display: 'flex', flexDirection: 'column' }}
                >
                  <div
                    style={{
                      width: last ? 268 : 282,
                      background: active ? '#D7E9E1' : '#F4F4F5',
                      clipPath: first
                        ? 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%)'
                        : last
                          ? 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 16px 50%)'
                          : 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%, 16px 50%)',
                      padding: first ? '12px 30px 12px 12px' : last ? '12px 12px 12px 26px' : '12px 30px 12px 26px',
                      borderRadius: last ? '6px 6px 0 0' : '6px 0 0 0',
                      height: 57,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{st.name}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
                      {plural(cards.length, t.project, t.projects)}
                      {cards.some((p) => p.value != null) && ` · ${moneyTotal(s, cards.filter((p) => p.value != null).map((p) => ({ currency: p.currency ?? undefined, amount: Number(p.value) })), true)}`}
                    </span>
                  </div>
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, background: active ? '#E7F2EE' : '#F4F4F5' }}>
                    {cards.map((p) => (
                      <div
                        key={p.id}
                        data-testid="project-card"
                        draggable={p.status === 'open'}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', p.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDragId(p.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOver(null);
                        }}
                        onClick={() => navigate(paths.project(p.id))}
                        style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-tile)', padding: '11px 12px', cursor: p.status === 'open' ? 'grab' : 'pointer', display: 'flex', flexDirection: 'column', gap: 8, opacity: dragId === p.id ? 0.45 : 1 }}
                      >
                        <span style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25 }}>
                            {p.code && <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{p.code} · </span>}
                            {p.name}
                          </span>
                          {p.value != null && <span style={{ fontSize: 11, color: 'var(--brand)', whiteSpace: 'nowrap' }}>{projectValue(s, p)}</span>}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.companyName} · {p.leadName ?? 'No lead'}
                          </span>
                          {p.team.length > 0 && <AvatarStack names={p.team.map((m) => m.name)} size={20} />}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {p.status === 'open' ? <HealthBadge health={p.health} /> : <ProjectStatusBadge status={p.status} />}
                          {p.dealLost && <span className="badge badge-danger">Deal lost</span>}
                          {tasks && <Progress work={work.get(p.id)} />}
                        </span>
                        {(work.get(p.id)?.next.length ?? 0) > 0 && (
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 5, borderTop: '1px dashed var(--border)', paddingTop: 7 }} data-testid="project-card-next">
                            {work.get(p.id)!.next.map((t) => (
                              <span key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, minWidth: 0 }}>
                                <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, flex: 'none', background: TASK_STATUSES.find((x) => x.id === t.status)!.dot }} />
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                                {t.dueDate && <DueLabel task={t} />}
                              </span>
                            ))}
                          </span>
                        )}
                        {(tasks || p.endDate) && (
                          <span style={{ fontSize: 11.5, color: 'var(--text-2)' }} data-testid="project-card-foot">
                            {[tasks ? plural(work.get(p.id)?.open ?? 0, 'open task') : null, p.endDate ? `finish ${shortDate(p.endDate)}` : null].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                    ))}
                    {cards.length === 0 && <div className="empty-dashed">No {t.projects}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Screen>
  );
}

/** The list view (design v2 §1): every project the filters show, all types. Rows open the project. */
function ProjectsList({ projects, work, onOpen }: { projects: ApiProject[]; work: Map<string, ProjectWork> | null; onOpen: (id: string) => void }) {
  const t = useTerms();
  return (
    <div className="pipeline-table" data-testid="projects-list">
      <div className="projects-table-inner">
        <div className="table-head caps">
          <span>{t.Project}</span>
          <span>Lead</span>
          <span>{t.Project} type</span>
          <span>Stage</span>
          <span>Health</span>
          <span>Progress</span>
          <span>Tasks</span>
          <span>Status</span>
          <span>Finish</span>
        </div>
        {projects.length === 0 && <div className="pipeline-table-empty">No {t.projects} match these filters.</div>}
        {projects.map((p) => (
          <div key={p.id} className="table-row clickable" data-testid="projects-row" onClick={() => onOpen(p.id)}>
            <span className="pt-cell">
              <span className="pt-main" style={{ fontWeight: 600 }}>
                {p.code ? `${p.code} · ${p.name}` : p.name}
              </span>
              <span className="pt-sub">{p.companyName}</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span className="pt-main">{p.leadName ?? 'No lead'}</span>
              {p.team.length > 0 && <AvatarStack names={p.team.map((m) => m.name)} size={20} />}
            </span>
            <span className="pt-main" style={{ color: 'var(--text-2)' }}>
              {p.projectTypeName}
            </span>
            <span className="pt-main">{p.stageName}</span>
            <span>
              <HealthBadge health={p.health} />
            </span>
            <span>{work ? <Progress work={work.get(p.id)} /> : null}</span>
            <span style={{ color: 'var(--text-2)' }}>{work ? `${work.get(p.id)?.open ?? 0} open` : ''}</span>
            <span>
              <ProjectStatusBadge status={p.status} />
            </span>
            <span style={{ color: 'var(--text-2)' }}>{shortDate(p.endDate)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A project's tasks as its card and row show them (CD-263): done of all, open, the next two open. */
interface ProjectWork {
  total: number;
  done: number;
  open: number;
  next: ApiTask[];
}

/** Next = the open tasks by due date (undated last), like the project's "Coming up". */
function workByProject(tasks: ApiTask[]): Map<string, ProjectWork> {
  const out = new Map<string, ProjectWork>();
  for (const t of tasks) {
    const w = out.get(t.projectId) ?? { total: 0, done: 0, open: 0, next: [] };
    w.total += 1;
    if (t.status === 'done') w.done += 1;
    else {
      w.open += 1;
      w.next.push(t);
    }
    out.set(t.projectId, w);
  }
  for (const w of out.values()) w.next = w.next.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.number - b.number).slice(0, 2);
  return out;
}

/** "▬▬▭ 40%": done tasks of all tasks; nothing when the project has none. */
function Progress({ work }: { work: ProjectWork | undefined }) {
  if (!work?.total) return <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>No tasks</span>;
  const pct = Math.round((work.done / work.total) * 100);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={`${work.done} of ${work.total} tasks done`} data-testid="project-progress">
      <span style={{ width: 54, height: 4, borderRadius: 99, background: 'var(--chip)', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--brand)' }} />
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{pct}%</span>
    </span>
  );
}
