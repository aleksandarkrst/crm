import { useEffect, useState } from 'react';
import { enabledModules } from '../../components/modules';
import type { WorkspaceTerms } from '../../lib/api';
import { type ApiProjectType, projectsApi } from '../../lib/projectsApi';
import { projectError, useProjectTypes } from '../../store/projects';
import { DEFAULT_TERMS } from '../../store/remote';
import { useStore } from '../../store/store';
import { Card, Confirm, Modal, Note, RemoveX, Row, RowMenu, RowsModal, Section, Segmented, SummaryRow, Switch, Table } from './parts';
import { TechniciansSection } from './TechniciansTab';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Workspace settings → Projects (CD-524 spec 2, design G-Settings-Projects): Project hierarchy
 * (names, creating projects from won opportunities, hour limits), Project types and Technicians.
 */
export function ProjectsPage() {
  return (
    <>
      <HierarchySection />
      <ProjectTypesSection />
      <TechniciansSection />
    </>
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

const LIMIT_MODES = [
  { value: 'warn', label: 'Warn', testId: 'hour-limit-warn', text: "Time beyond someone's hour limit on a task is saved after a confirmation and flagged for their approver." },
  { value: 'block', label: 'Block', testId: 'hour-limit-block', text: "Time beyond someone's hour limit on a task is refused; their manager raises the limit first." },
] as const;

/** Projects → Project hierarchy (CD-143, CD-149, CD-488). */
function HierarchySection() {
  const { s, setWorkspace, canEditWorkspace, canEditFunnels } = useStore();
  const w = s.workspace;
  const [names, setNames] = useState(false);
  const crmOn = enabledModules(w.modules).includes('crm');
  const mode = LIMIT_MODES.find((m) => m.value === w.hourLimitMode) ?? LIMIT_MODES[0];
  const t = w.terms;
  return (
    <Section title="Project hierarchy" desc="What your team calls projects and tasks, and how hour limits behave.">
      <Card testId="project-terms">
        <SummaryRow label="Names" desc="What your team calls projects and tasks everywhere in Pultly" summary={[t.project, t.projects, t.task, t.tasks].join(', ')} disabled={!canEditFunnels} onEdit={() => setNames(true)} testId="names-summary" />
        {/* Needs both the CRM and Projects (CD-488): with the CRM off it shows, dimmed. */}
        <Row
          label="Create a project when an opportunity is won"
          desc={crmOn ? "The project takes the opportunity's title and company, the first project type, and the opportunity owner as lead, who gets an email. Once per opportunity." : 'Needs the CRM, which is off in this workspace.'}
          testId="auto-create-projects"
          dim={!crmOn}
          switchRow
        >
          <Switch on={w.autoCreateProjects} disabled={!crmOn} label="Create a project when an opportunity is won" onChange={(on) => setWorkspace({ autoCreateProjects: on })} />
        </Row>
        <Row label="When someone goes over their hour limit" desc={mode.text} testId="hour-limit-mode">
          <Segmented label="Hour limit mode" value={w.hourLimitMode} options={LIMIT_MODES} disabled={!canEditWorkspace} onChange={(v) => setWorkspace({ hourLimitMode: v })} />
        </Row>
      </Card>
      {names && <NamesModal onClose={() => setNames(false)} />}
    </Section>
  );
}

/**
 * The Names modal (CD-143): what this workspace calls projects and tasks, saved as each field is
 * left (all four go together, with the API's rules), and back to the defaults with Reset.
 */
function NamesModal({ onClose }: { onClose: () => void }) {
  const { s, flash, saveTerms } = useStore();
  const saved = s.workspace.terms;
  const [draft, setDraft] = useState<WorkspaceTerms>(saved);
  const [errors, setErrors] = useState<Partial<Record<keyof WorkspaceTerms, string>>>({});
  const submit = async (next: WorkspaceTerms) => {
    const trimmed = { project: next.project.trim(), projects: next.projects.trim(), task: next.task.trim(), tasks: next.tasks.trim() };
    if (sameTerms(trimmed, saved)) return;
    const found = termErrors(trimmed);
    setErrors(found);
    if (Object.keys(found).length) return;
    const refused = await saveTerms(trimmed);
    if (refused) return setErrors(refused);
    setDraft(trimmed);
    flash('Changes saved');
  };
  return (
    <RowsModal title="Names" desc="One and several, as people see them in menus, pages and emails." onClose={onClose} testId="names-modal">
      {TERM_FIELDS.map(({ key, label }) => (
        <Row key={key} label={label} error={errors[key] && <span data-testid={`term-${key}-error`}>{errors[key]}</span>}>
          <input
            className="gs-input s"
            style={{ width: 200 }}
            aria-label={label}
            data-testid={`term-${key}`}
            value={draft[key]}
            maxLength={40}
            aria-invalid={!!errors[key]}
            onChange={(e) => {
              setDraft({ ...draft, [key]: e.target.value });
              // The field's message goes once it is changed (CD-489).
              if (errors[key]) setErrors({ ...errors, [key]: undefined });
            }}
            onBlur={() => void submit(draft)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </Row>
      ))}
      <Row label="Back to the defaults" desc="Project, Projects, Task, Tasks">
        <button
          type="button"
          className="gs-btn"
          data-testid="reset-terms"
          disabled={sameTerms(saved, DEFAULT_TERMS)}
          onClick={() => {
            setDraft(DEFAULT_TERMS);
            void submit(DEFAULT_TERMS);
          }}
        >
          Reset
        </button>
      </Row>
    </RowsModal>
  );
}

type Draft = { id?: string; name: string; projects: number };

/**
 * Projects → Project types (CD-272): a table with a ⋯ menu; New and Edit open a modal with the name
 * and the stages. Owners and admins change them; a type that projects use asks where they go before
 * it is deleted. Other viewers get changes through the live hint `project_type`.
 */
function ProjectTypesSection() {
  const store = useStore();
  const { flash } = store;
  const editable = store.canEditFunnels;
  const { data: types, error, set: setTypes } = useProjectTypes();
  const [editing, setEditing] = useState<ApiProjectType | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ApiProjectType | null>(null);
  return (
    <Section
      title="Project types"
      desc="A project type is a set of stages for one kind of project, like a funnel in the CRM."
      action={
        editable && (
          <button type="button" className="gs-btn primary" onClick={() => setEditing('new')}>
            New project type
          </button>
        )
      }
      testId="project-types"
    >
      {!editable && <span className="gs-sub" data-testid="project-types-read-only">Only owners and admins can change project types and their stages.</span>}
      {!types ? (
        <span className="gs-sub">{error ? `Couldn't load project types: ${error}` : 'Loading project types'}</span>
      ) : (
        <Table cols={[{ label: 'Project type' }, { label: 'Stages' }, { label: 'Projects', align: 'num' }, { label: '', align: 'end' }]} minWidth={560} empty={types.length ? undefined : 'No project types yet. Add one to start creating projects.'}>
          {types.map((t, i) => (
            <tr key={t.id} data-testid="project-type" data-type={t.id}>
              <td>
                <span className="gs-cell">
                  <b>{t.name}</b>
                  {/* The first type is the one won opportunities create projects in (CD-488). */}
                  {i === 0 && <span className="gs-sub">Default for new projects</span>}
                </span>
              </td>
              <td className="gs-sub" style={{ fontSize: 13.5 }} data-testid="project-type-stages">
                {[...t.stages.map((st) => st.name), 'Complete'].join(', ')}
              </td>
              <td className="num">{t.projects}</td>
              <td className="end">
                {editable && (
                  <RowMenu
                    label={`Actions for ${t.name}`}
                    testId="project-type-menu"
                    items={[{ label: 'Edit', onClick: () => setEditing(t), testId: 'project-type-edit' }, ...(types.length > 1 ? [{ label: 'Delete', onClick: () => setDeleting(t), danger: true, testId: 'project-type-delete' }] : [])]}
                  />
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Note>Complete and Cancel are always available in every project type and are not stages. A type that is used by projects asks where they go before it is deleted.</Note>
      {editing && types && <TypeModal type={editing === 'new' ? null : editing} types={types} onClose={() => setEditing(null)} onSaved={setTypes} />}
      {deleting && types && (
        <DeleteType
          type={deleting}
          types={types}
          onClose={() => setDeleting(null)}
          onDone={async (target) => {
            try {
              setTypes(await projectsApi.deleteType(deleting.id, deleting.projects ? target : undefined));
              flash(`${deleting.name} deleted`);
            } catch (err) {
              flash(projectError(err));
            }
            setDeleting(null);
          }}
        />
      )}
    </Section>
  );
}

/**
 * New or Edit project type: the name (required) and the stages (add, rename, remove, in order).
 * Save applies the difference with the stage endpoints; a stage that projects are in can't be
 * removed here (they'd need somewhere to go).
 */
function TypeModal({ type, types, onClose, onSaved }: { type: ApiProjectType | null; types: ApiProjectType[]; onClose: () => void; onSaved: (next: ApiProjectType[]) => void }) {
  const { flash } = useStore();
  const [name, setName] = useState(type?.name ?? '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stages, setStages] = useState<Draft[]>(type ? type.stages.map((st) => ({ id: st.id, name: st.name, projects: st.projects })) : [{ name: 'Planning', projects: 0 }, { name: 'In progress', projects: 0 }]);
  const nameBad = tried && !name.trim();
  const stagesBad = tried && (!stages.length || stages.some((st) => !st.name.trim()));
  const save = async () => {
    setTried(true);
    if (!name.trim() || !stages.length || stages.some((st) => !st.name.trim())) return;
    setBusy(true);
    try {
      let all = types;
      let id = type?.id;
      if (!id) {
        const before = new Set(types.map((t) => t.id));
        all = await projectsApi.createType(name.trim());
        id = all.find((t) => !before.has(t.id))!.id;
      } else if (name.trim() !== type!.name) all = await projectsApi.renameType(id, name.trim());
      const current = () => all.find((t) => t.id === id)!;
      const keep = new Set(stages.filter((st) => st.id).map((st) => st.id));
      // New stages first (a type always keeps one), then renames, then removals, then the order.
      const ids: string[] = [];
      for (const st of stages) {
        if (st.id) {
          const was = current().stages.find((x) => x.id === st.id);
          if (was && was.name !== st.name.trim()) all = await projectsApi.renameStage(id, st.id, st.name.trim());
          ids.push(st.id);
        } else {
          const before = new Set(current().stages.map((x) => x.id));
          all = await projectsApi.createStage(id, st.name.trim());
          ids.push(current().stages.find((x) => !before.has(x.id))!.id);
        }
      }
      for (const st of current().stages) if (!keep.has(st.id) && !ids.includes(st.id)) all = await projectsApi.deleteStage(id, st.id);
      if (current().stages.map((x) => x.id).join() !== ids.join()) all = await projectsApi.reorderStages(id, ids);
      onSaved(all);
      flash(type ? 'Project type saved' : 'Project type added');
      onClose();
    } catch (err) {
      flash(projectError(err));
      setBusy(false);
    }
  };
  const move = (i: number, dir: -1 | 1) => {
    const next = [...stages];
    [next[i], next[i + dir]] = [next[i + dir]!, next[i]!];
    setStages(next);
  };
  return (
    <Modal title={type ? `Edit ${type.name}` : 'New project type'} desc="A set of stages for one kind of project." onClose={onClose} wide testId="project-type-card">
      <label className="gs-label">
        Name
        <input className="gs-input" value={name} aria-invalid={nameBad} placeholder="e.g. Installation" maxLength={100} onChange={(e) => setName(e.target.value)} />
        {nameBad && (
          <span className="gs-error" role="alert">
            Give the project type a name.
          </span>
        )}
      </label>
      <div className="gs-label">
        Stages
        <span className="gs-sub" style={{ fontWeight: 400 }}>
          In the order projects move through them. Complete and Cancel are always available and are not stages.
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stages.map((st, i) => (
            <span key={st.id ?? 'new' + i} style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-testid="project-stage">
              <span className="gs-pn">{i + 1}</span>
              <input
                className="gs-input s"
                style={{ flex: 1 }}
                aria-label={`Stage ${i + 1}`}
                aria-invalid={tried && !st.name.trim()}
                value={st.name}
                maxLength={100}
                onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <button type="button" className="gs-x plain" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="gs-x plain" aria-label="Move down" disabled={i === stages.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <RemoveX
                label="Delete stage"
                title={stages.length === 1 ? 'A project type needs at least one stage' : st.projects ? `In use by ${plural(st.projects, 'project')}. Move them to another stage first.` : 'Delete stage'}
                disabled={stages.length === 1 || st.projects > 0}
                onClick={() => setStages(stages.filter((_, j) => j !== i))}
              />
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
            <span className="gs-pn" style={{ background: 'var(--gs-chip)', color: 'var(--gs-text-2)' }}>
              ✓
            </span>
            <span className="gs-sub">Complete</span>
          </span>
          <button type="button" className="gs-tag-add" style={{ alignSelf: 'flex-start' }} onClick={() => setStages([...stages, { name: '', projects: 0 }])}>
            + Add stage
          </button>
        </span>
        {stagesBad && (
          <span className="gs-error" role="alert">
            Every stage needs a name.
          </span>
        )}
      </div>
      <div className="gs-sheet-actions">
        <span className="grow" />
        <button type="button" className="gs-btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="gs-btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving' : type ? 'Save' : 'Add project type'}
        </button>
      </div>
    </Modal>
  );
}

/** Deleting a project type: what uses it, and where its projects go (into that type's first stage). */
function DeleteType({ type, types, onClose, onDone }: { type: ApiProjectType; types: ApiProjectType[]; onClose: () => void; onDone: (target: string) => void }) {
  const others = types.filter((t) => t.id !== type.id);
  const [target, setTarget] = useState(others[0]?.id ?? '');
  useEffect(() => setTarget(others[0]?.id ?? ''), [type.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Confirm
      title={`Delete ${type.name}?`}
      text={type.projects ? `${plural(type.projects, 'project uses', 'projects use')} it. They move to the type you pick, into its first stage, and keep their history. The type and its stages cannot be restored.` : 'Nothing uses it. The type and its stages cannot be restored.'}
      confirmLabel="Delete project type"
      move={type.projects ? { label: `Move the ${type.projects === 1 ? 'project' : 'projects'} to`, options: others.map((t) => ({ value: t.id, label: t.name })), value: target, onPick: setTarget } : undefined}
      onCancel={onClose}
      onConfirm={() => onDone(target)}
      testId="delete-type-confirm"
    />
  );
}
