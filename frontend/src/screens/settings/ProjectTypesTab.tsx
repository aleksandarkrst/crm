import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { askConfirm } from '../../components/ConfirmDialog';
import { enabledModules } from '../../components/modules';
import { Modal, ModalHeader, Switch } from '../../components/ui';
import type { WorkspaceTerms } from '../../lib/api';
import { type ApiProjectType, projectsApi } from '../../lib/projectsApi';
import { projectError, useProjectTypes } from '../../store/projects';
import { DEFAULT_TERMS } from '../../store/remote';
import { useStore } from '../../store/store';
import { Block, MoveButton, Note, RemoveX, Row, Rows, Segmented, StagePreview } from './parts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "New project type", "New project type 2", …: a name the list doesn't have yet (names are unique). */
function freshName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.trim().toLowerCase()));
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base} ${i}`;
    if (!lower.has(name.toLowerCase())) return name;
  }
}

type Removing = { kind: 'stage'; stageId: string } | { kind: 'type' };

/**
 * Settings → Project types (CD-272, design v2 §10): like the Funnel builder, a list of types on the
 * left and the selected type's name, stages and a preview of its stage bar on the right. Owners and
 * admins change them; others see them read-only. `?type=<id>` selects a type (the pencil buttons
 * next to a Project type select link here). Every change saves at once and the list comes back from
 * the API; other viewers get it through the live hint `project_type`.
 */
export function ProjectTypesTab() {
  const store = useStore();
  const { flash } = store;
  const editable = store.canEditFunnels;
  const { data: types, error, set: setTypes } = useProjectTypes();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('type');
  const type = types?.find((t) => t.id === selectedId) ?? types?.[0];
  const [removing, setRemoving] = useState<Removing | null>(null);
  const select = (id: string) => setParams({ type: id }, { replace: true });

  /** Runs a change; the answer (every type) replaces the list, a refusal is a toast. */
  const save = async (change: () => Promise<ApiProjectType[]>, done?: string): Promise<ApiProjectType[] | null> => {
    try {
      const next = await change();
      setTypes(next);
      if (done) flash(done);
      return next;
    } catch (err) {
      flash(projectError(err));
      return null;
    }
  };

  if (!types) return <div className="hint-box">{error ? `Couldn't load project types: ${error}` : 'Loading project types'}</div>;

  /**
   * Deleting a stage or a type. With no projects in it, the app's confirm; with projects, a dialog
   * that asks where they go.
   */
  const remove = async (what: Removing) => {
    if (!type) return;
    const stage = what.kind === 'stage' ? type.stages.find((s) => s.id === what.stageId) : undefined;
    const count = what.kind === 'stage' ? (stage?.projects ?? 0) : type.projects;
    if (count) return setRemoving(what);
    const yes = await askConfirm({
      title: `Delete ${what.kind === 'stage' ? (stage?.name ?? 'this stage') : type.name}?`,
      message: what.kind === 'stage' ? 'The stage leaves this project type.' : 'The project type and its stages are deleted.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    if (what.kind === 'stage') await save(() => projectsApi.deleteStage(type.id, what.stageId), 'Stage deleted');
    else {
      const next = await save(() => projectsApi.deleteType(type.id), 'Project type deleted');
      if (next) select(next[0]!.id);
    }
  };

  const addType = async () => {
    const before = new Set(types.map((t) => t.id));
    const next = await save(() => projectsApi.createType(freshName('New project type', types.map((t) => t.name))), 'Project type added');
    const added = next?.find((t) => !before.has(t.id));
    if (added) select(added.id);
  };

  return (
    <div className="ws-stack" data-testid="project-types">
      {!editable && (
        <span data-testid="project-types-read-only" className="ws-block-desc">
          Only owners and admins can change project types and their stages.
        </span>
      )}

      <div className="ws-choices">
        {types.map((t) => (
          <button key={t.id} type="button" className={'choice' + (t.id === type?.id ? ' on' : '')} aria-pressed={t.id === type?.id} data-testid="project-type" onClick={() => select(t.id)}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{t.name}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              {plural(t.stages.length, 'stage')} · {plural(t.projects, 'project')}
            </span>
          </button>
        ))}
        {editable && (
          <button type="button" className="choice ws-choice-new" onClick={() => void addType()}>
            New project type
          </button>
        )}
      </div>

      <div>{type && <TypeCard key={type.id} type={type} editable={editable} canDelete={types.length > 1} save={save} onRemoveStage={(stageId) => void remove({ kind: 'stage', stageId })} onRemoveType={() => void remove({ kind: 'type' })} />}</div>

      {removing && type && (
        <RemoveDialog
          key={removing.kind === 'stage' ? removing.stageId : type.id}
          removing={removing}
          type={type}
          types={types}
          onClose={() => setRemoving(null)}
          onDone={(next) => {
            if (removing.kind === 'type') select(next[0]!.id);
          }}
          save={save}
        />
      )}
    </div>
  );
}

function TypeCard({
  type,
  editable,
  canDelete,
  save,
  onRemoveStage,
  onRemoveType,
}: {
  type: ApiProjectType;
  editable: boolean;
  canDelete: boolean;
  save: (change: () => Promise<ApiProjectType[]>, done?: string) => Promise<ApiProjectType[] | null>;
  onRemoveStage: (stageId: string) => void;
  onRemoveType: () => void;
}) {
  const [name, setName] = useState(type.name);
  useEffect(() => setName(type.name), [type.name]);
  const stages = type.stages;

  const saveName = () => {
    const next = name.trim();
    if (!next || next === type.name) return setName(type.name);
    void save(() => projectsApi.renameType(type.id, next), 'Project type renamed');
  };
  const moveStage = (idx: number, dir: -1 | 1) => {
    const ids = stages.map((s) => s.id);
    [ids[idx], ids[idx + dir]] = [ids[idx + dir]!, ids[idx]!];
    void save(() => projectsApi.reorderStages(type.id, ids));
  };

  return (
    <div className="ws-stack" data-testid="project-type-card">
      <Block title="Type">
        <Rows>
          <Row label="Name">
            <input className="form-input" aria-label="Project type name" value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          </Row>
        </Rows>
      </Block>

      <Block title="Stages" desc="Projects move through them from left to right. Complete and Cancel always come after the last stage.">
        <StagePreview names={stages.map((st) => st.name)} testId="project-type-preview" />
        <div className="card ws-stages">
          <div>
            {stages.map((st, idx) => (
              <StageRow
                key={st.id}
                n={idx + 1}
                name={st.name}
                projects={st.projects}
                editable={editable}
                first={idx === 0}
                last={idx === stages.length - 1}
                only={stages.length === 1}
                onRename={(next) => void save(() => projectsApi.renameStage(type.id, st.id, next))}
                onMove={(dir) => moveStage(idx, dir)}
                onRemove={() => onRemoveStage(st.id)}
              />
            ))}
          </div>
          {editable && (
            <div className="ws-stages-foot">
              <button
                type="button"
                className="btn-plain"
                onClick={() =>
                  void save(
                    () =>
                      projectsApi.createStage(
                        type.id,
                        freshName(
                          'New stage',
                          stages.map((s) => s.name),
                        ),
                      ),
                    'Stage added',
                  )
                }
              >
                New stage
              </button>
            </div>
          )}
        </div>
      </Block>

      {editable && canDelete && (
        <Block title="Danger zone">
          <Rows danger>
            <Row label="Delete project type" hint={type.projects ? `Used by ${plural(type.projects, 'project')}. You choose where they go before it is deleted.` : 'No projects use this type yet.'}>
              <button type="button" className="btn-danger-quiet" onClick={onRemoveType}>
                Delete project type
              </button>
            </Row>
          </Rows>
        </Block>
      )}
      {!(editable && canDelete) && <Note>{type.projects ? `Used by ${plural(type.projects, 'project')}.` : 'No projects use this type yet.'}</Note>}
    </div>
  );
}

function StageRow({
  n,
  name,
  projects,
  editable,
  first,
  last,
  only,
  onRename,
  onMove,
  onRemove,
}: {
  n: number;
  name: string;
  projects: number;
  editable: boolean;
  first: boolean;
  last: boolean;
  only: boolean;
  onRename: (name: string) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => {
    const next = draft.trim();
    if (!next || next === name) return setDraft(name);
    onRename(next);
  };
  return (
    <div data-testid="project-stage" className="ws-stage">
      <div className="ws-stage-head">
        <div className="ws-stage-main" style={{ cursor: 'default' }}>
          <span className="ws-stage-n">{n}</span>
          <span className="ws-stage-text">
            <input
              className="ghost ghost-sm"
              value={draft}
              disabled={!editable}
              aria-label="Stage name"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              style={{ fontWeight: 600, fontSize: 13.5, padding: '2px 6px', margin: '0 -6px' }}
            />
          </span>
          <span className="ws-stage-opps" style={{ display: 'inline' }}>
            {plural(projects, 'project')}
          </span>
        </div>
        {editable && (
          <span className="ws-stage-actions">
            <MoveButton dir="up" label="Move up" disabled={first} onClick={() => onMove(-1)} />
            <MoveButton dir="down" label="Move down" disabled={last} onClick={() => onMove(1)} />
            <RemoveX
              label="Delete stage"
              title={only ? 'A project type needs at least one stage' : projects > 0 ? `In use by ${plural(projects, 'project')}. Move them to another stage first.` : 'Delete stage'}
              disabled={only || projects > 0}
              onClick={onRemove}
            />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Deleting a stage or a type that has projects: where they go (another stage of the type, or
 * another type, whose first stage they take).
 */
function RemoveDialog({
  removing,
  type,
  types,
  onClose,
  onDone,
  save,
}: {
  removing: Removing;
  type: ApiProjectType;
  types: ApiProjectType[];
  onClose: () => void;
  onDone: (next: ApiProjectType[]) => void;
  save: (change: () => Promise<ApiProjectType[]>, done?: string) => Promise<ApiProjectType[] | null>;
}) {
  const stage = removing.kind === 'stage' ? type.stages.find((s) => s.id === removing.stageId) : undefined;
  const count = removing.kind === 'stage' ? (stage?.projects ?? 0) : type.projects;
  const targets = removing.kind === 'stage' ? type.stages.filter((s) => s.id !== removing.stageId) : types.filter((t) => t.id !== type.id);
  const stageIdx = stage ? type.stages.indexOf(stage) : -1;
  const [target, setTarget] = useState(() => (removing.kind === 'stage' ? (type.stages[stageIdx - 1] ?? targets[0])?.id : targets[0]?.id) ?? '');
  const name = removing.kind === 'stage' ? (stage?.name ?? 'this stage') : type.name;
  const run = async () => {
    const next = await save(
      () => (removing.kind === 'stage' ? projectsApi.deleteStage(type.id, removing.stageId, target) : projectsApi.deleteType(type.id, target)),
      removing.kind === 'stage' ? 'Stage deleted' : 'Project type deleted',
    );
    if (next) onDone(next);
    onClose();
  };

  return (
    <Modal maxWidth={480} onBackdrop={onClose}>
      <ModalHeader
        title={`Delete ${name}?`}
        sub={removing.kind === 'stage' ? 'The stage leaves this project type. Its projects move to the stage you pick.' : "The project type and its stages are deleted. Its projects move to the type you pick, into that type's first stage."}
      />
      <label className="form-label">
        Move its {plural(count, 'project')} to
        <select className="form-input" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="move-projects-to">
          {targets.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!target} onClick={() => void run()}>
          {removing.kind === 'stage' ? 'Delete stage' : 'Delete project type'}
        </button>
      </div>
    </Modal>
  );
}

const TERM_FIELDS: { key: keyof WorkspaceTerms; label: string }[] = [
  { key: 'project', label: 'One project' },
  { key: 'projects', label: 'Several projects' },
  { key: 'task', label: 'One task' },
  { key: 'tasks', label: 'Several tasks' },
];

/** The same rules as the API: 1 to 30 characters, and a task name can't repeat a project name. */
function termErrors(t: WorkspaceTerms): Partial<Record<keyof WorkspaceTerms, string>> {
  const out: Partial<Record<keyof WorkspaceTerms, string>> = {};
  for (const { key } of TERM_FIELDS) {
    const v = t[key].trim();
    if (!v) out[key] = 'Enter a name';
    else if (v.length > 30) out[key] = 'At most 30 characters';
  }
  const projectNames = new Set([t.project.trim().toLowerCase(), t.projects.trim().toLowerCase()]);
  for (const key of ['task', 'tasks'] as const) if (!out[key] && projectNames.has(t[key].trim().toLowerCase())) out[key] = 'Projects and tasks need different names';
  return out;
}

const sameTerms = (a: WorkspaceTerms, b: WorkspaceTerms) => TERM_FIELDS.every(({ key }) => a[key].trim() === b[key].trim());

/** Settings → Projects → Project hierarchy (CD-318): the Names card on a page of its own, above Project types. */
export function ProjectHierarchyTab() {
  const store = useStore();
  const { s, setWorkspace } = store;
  const w = s.workspace;
  const modules = enabledModules(w.modules);
  return (
    <>
      <NamesCard editable={store.canEditFunnels} />
      {/* Only where both the CRM and Projects are on (CD-488); here with the design since CD-524. */}
      {modules.includes('crm') && modules.includes('projects') && (
        <Block title="From the CRM">
          <Rows>
            <Row
              label="Create a project when an opportunity is won"
              hint="The project takes the opportunity's title and company, the first project type, and the opportunity owner as lead, who gets an email. Once per opportunity."
              testId="auto-create-projects"
              switchRow
            >
              <Switch on={w.autoCreateProjects} onClick={() => setWorkspace({ autoCreateProjects: !w.autoCreateProjects })} label="Create a project when an opportunity is won" />
            </Row>
          </Rows>
        </Block>
      )}
      <HourLimitCard />
    </>
  );
}

const LIMIT_MODES = [
  { value: 'warn', label: 'Warn', testId: 'hour-limit-warn', text: "Time beyond someone's hour limit on a task is saved after a confirmation and flagged for their approver." },
  { value: 'block', label: 'Block', testId: 'hour-limit-block', text: "Time beyond someone's hour limit on a task is refused; their manager raises the limit first." },
] as const;

/** Hour limit mode (CD-149, spec 10.4): Warn (default) or Block. Owners and admins change it. */
function HourLimitCard() {
  const { s, setWorkspace, canEditWorkspace } = useStore();
  const mode = s.workspace.hourLimitMode;
  return (
    <Block title="Hour limits">
      <Rows testId="hour-limit-mode">
        <Row label="When someone goes over their hour limit" hint={LIMIT_MODES.find((m) => m.value === mode)?.text}>
          <Segmented label="Hour limit mode" value={mode} options={LIMIT_MODES} disabled={!canEditWorkspace} onChange={(v) => setWorkspace({ hourLimitMode: v })} />
        </Row>
      </Rows>
    </Block>
  );
}

/**
 * What this workspace calls projects and tasks (CD-143): singular and plural, used everywhere the
 * words appear (sidebar, pages, buttons, dialogs, emails) and live for everyone. Owners and admins
 * change them; others see them read-only.
 */
function NamesCard({ editable }: { editable: boolean }) {
  const { s, flash, saveTerms } = useStore();
  const saved = s.workspace.terms;
  const [draft, setDraft] = useState<WorkspaceTerms>(saved);
  const [errors, setErrors] = useState<Partial<Record<keyof WorkspaceTerms, string>>>({});
  const [saving, setSaving] = useState(false);
  // Someone else renamed them: show the new names unless this person is editing.
  useEffect(() => setDraft((d) => (sameTerms(d, saved) || !editable ? saved : d)), [saved, editable]);

  const submit = async (next: WorkspaceTerms) => {
    const trimmed = { project: next.project.trim(), projects: next.projects.trim(), task: next.task.trim(), tasks: next.tasks.trim() };
    const found = termErrors(trimmed);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    const refused = await saveTerms(trimmed);
    setSaving(false);
    if (refused) return setErrors(refused);
    setDraft(trimmed);
    flash(sameTerms(trimmed, DEFAULT_TERMS) ? 'Names reset to Project and Task' : `Names saved: ${trimmed.projects} and ${trimmed.tasks}`);
  };

  const changed = !sameTerms(draft, saved);
  return (
    <Block
      title="Names"
      desc="What this workspace calls projects and tasks, e.g. Job and Activity. The names show everywhere: the sidebar, pages, buttons and emails."
      testId="project-terms"
      actions={
        editable && (
          <>
            <button type="button" className="btn-plain" disabled={saving || sameTerms(saved, DEFAULT_TERMS)} data-testid="reset-terms" onClick={() => void submit(DEFAULT_TERMS)}>
              Reset to defaults
            </button>
            <button type="button" className={changed && !saving ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!changed || saving} data-testid="save-terms" onClick={() => void submit(draft)}>
              {saving ? 'Saving…' : 'Save names'}
            </button>
          </>
        )
      }
    >
      <Rows>
        {TERM_FIELDS.map(({ key, label }) => (
          <Row key={key} label={label} error={errors[key] && <span data-testid={`term-${key}-error`}>{errors[key]}</span>}>
            <input
              className="form-input"
              style={{ width: 200 }}
              aria-label={label}
              data-testid={`term-${key}`}
              value={draft[key]}
              disabled={!editable || saving}
              maxLength={40}
              aria-invalid={!!errors[key]}
              onChange={(e) => {
                setDraft({ ...draft, [key]: e.target.value });
                // The field's message goes once it is changed (CD-489); Save checks again.
                if (errors[key]) setErrors({ ...errors, [key]: undefined });
              }}
              onKeyDown={(e) => e.key === 'Enter' && changed && void submit(draft)}
            />
          </Row>
        ))}
      </Rows>
    </Block>
  );
}
