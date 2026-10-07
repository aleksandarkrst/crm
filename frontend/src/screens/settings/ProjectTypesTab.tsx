import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { askConfirm } from '../../components/ConfirmDialog';
import { Modal, ModalHeader } from '../../components/ui';
import { type ApiProjectType, projectsApi } from '../../lib/projectsApi';
import { projectError, useProjectTypes } from '../../store/projects';
import { useStore } from '../../store/store';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="project-types">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>Project types</span>
        <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, maxWidth: 760 }}>
          A project type is a set of stages for one kind of project, like a funnel in the CRM. Each project is on one board: it shows in that board's columns, and its tasks are grouped by the same stages in the plan. Complete and Cancel are always available and are not stages.
        </span>
        {!editable && (
          <span data-testid="project-types-read-only" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            Only owners and admins can change project types and their stages.
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 240px', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {types.map((t) => (
            <button key={t.id} type="button" className={'choice' + (t.id === type?.id ? ' on' : '')} data-testid="project-type" onClick={() => select(t.id)}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{t.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {plural(t.stages.length, 'stage')} · {plural(t.projects, 'project')}
              </span>
            </button>
          ))}
          {editable && (
            <button type="button" className="btn-dashed" onClick={() => void addType()}>
              New project type
            </button>
          )}
        </div>

        {type && (
          <TypeCard
            key={type.id}
            type={type}
            editable={editable}
            canDelete={types.length > 1}
            save={save}
            onRemoveStage={(stageId) => void remove({ kind: 'stage', stageId })}
            onRemoveType={() => void remove({ kind: 'type' })}
          />
        )}
      </div>

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
    <div className="card" data-testid="project-type-card" style={{ flex: '999 1 460px', minWidth: 0, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label className="form-label">
        Project type name
        <input className="form-input" value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="caps">Stages</span>
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
        {editable && (
          <button
            type="button"
            className="btn-dashed"
            style={{ alignSelf: 'flex-start', whiteSpace: 'nowrap' }}
            onClick={() => void save(() => projectsApi.createStage(type.id, freshName('New stage', stages.map((s) => s.name))), 'Stage added')}
          >
            New stage
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caps">Preview</span>
        <div className="stage-bar" data-testid="project-type-preview">
          {stages.map((st, i) => (
            <button key={st.id} type="button" className={'stage-chev' + (i === 0 ? ' current' : '')} disabled>
              {st.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-2)' }}>
        <span>{type.projects ? `Used by ${plural(type.projects, 'project')}` : 'No projects use this type yet'}</span>
        {editable && canDelete && (
          <button type="button" className="btn btn-secondary" style={{ marginLeft: 'auto', padding: '6px 10px', fontSize: 12 }} onClick={onRemoveType}>
            Delete project type
          </button>
        )}
      </div>
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
  const arrow = (d: string) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
  return (
    <div data-testid="project-stage" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 10, padding: '6px 8px 6px 12px' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', width: 18 }}>{n}</span>
      <input
        className="ghost ghost-sm"
        value={draft}
        disabled={!editable}
        aria-label="Stage name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        style={{ flex: 1, minWidth: 0, fontWeight: 500 }}
      />
      <span style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{plural(projects, 'project')}</span>
      {editable && (
        <>
          <button type="button" className="icon-btn" aria-label="Move up" title="Move up" disabled={first} style={{ opacity: first ? 0.35 : 1 }} onClick={() => onMove(-1)}>
            {arrow('M6 15l6-6 6 6')}
          </button>
          <button type="button" className="icon-btn" aria-label="Move down" title="Move down" disabled={last} style={{ opacity: last ? 0.35 : 1 }} onClick={() => onMove(1)}>
            {arrow('M6 9l6 6 6-6')}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Delete stage"
            title={only ? 'A project type needs at least one stage' : 'Delete stage'}
            disabled={only}
            style={{ opacity: only ? 0.35 : 1 }}
            onClick={onRemove}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </>
      )}
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
