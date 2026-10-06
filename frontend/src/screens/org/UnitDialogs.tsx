/**
 * The dialogs that change the organization's units (CD-226, CD-228). Admins open them from the Org
 * structure chart: the header's Create menu ("New <level>", `CreateUnitDialog`), and on each unit
 * the Lead picker, "Add person" and the unit's menu (add a unit inside, rename, move, delete). The
 * "Organization" panel that listed the units is gone (CD-228): the chart is where units are set up.
 * Managers follow the org rules on the server: a unit brings its lead as manager, a new lead reports
 * to the lead above and takes over the members who reported to the previous one. Moving a lead
 * away asks first, in the app's confirm dialog (lib/headMoves.ts). After every change the Org
 * structure page and the card's pickers read again.
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import { withHeadConfirm } from '../../lib/headMoves';
import { type ApiDirectoryRow, type ApiOrgLevel, type ApiOrgUnit, type LeadPreview, orgApi } from '../../lib/orgApi';
import { type OrgStructure, orgError, useOrgStructure } from '../../store/org';
import { managerForUnit, unitPathLabel, unitsBelow, unitTree } from '../../store/orgChart';
import { fold } from '../../store/search';
import { useStore } from '../../store/store';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Ana Petrović, Marko Ilić and 3 others". */
function names(people: { fullName: string }[], max = 6): string {
  if (people.length <= max) return people.length <= 1 ? (people[0]?.fullName ?? '') : `${people.slice(0, -1).map((p) => p.fullName).join(', ')} and ${people.at(-1)!.fullName}`;
  return `${people.slice(0, max).map((p) => p.fullName).join(', ')} and ${plural(people.length - max, 'other')}`;
}

/** Units a unit of `level` may be inside: those of a higher level (smaller position). */
export function parentChoices(levels: readonly ApiOrgLevel[], units: readonly ApiOrgUnit[], levelId: string, except: ReadonlySet<string> = new Set()): ApiOrgUnit[] {
  const position = new Map(levels.map((l) => [l.id, l.position]));
  const own = position.get(levelId) ?? 0;
  const ordered = unitTree(units).map((t) => t.unit);
  return ordered.filter((u) => (position.get(u.levelId) ?? 99) < own && !except.has(u.id));
}

type Run = (action: (clearLeadRoles: boolean) => Promise<unknown>, done?: string) => Promise<boolean>;

/** Runs a change from a dialog: asks first when it moves a lead away, keeps the dialog open with the API's message when refused. */
function useRun(onDone: () => void) {
  const { flash, people } = useStore();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run: Run = async (action, done) => {
    setBusy(true);
    setProblem(null);
    try {
      if ((await withHeadConfirm(async (clear) => (await action(clear)) ?? true)) === null) return false;
      // The Org structure page at once; the card's pickers follow the change's live hint (store.tsx).
      people.refresh(0);
      if (done) flash(done);
      onDone();
      return true;
    } catch (err) {
      setProblem(orgError(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, problem, run };
}

/** Active employees to pick from, by name. */
function PersonSelect({ value, onChange, employees, none, label, testId }: { value: string | null; onChange: (id: string | null) => void; employees: ApiDirectoryRow[]; none: string; label: string; testId?: string }) {
  return (
    <select className="form-input" aria-label={label} data-testid={testId} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{none}</option>
      {employees.map((e) => (
        <option key={e.id} value={e.id}>
          {e.fullName}
          {e.jobTitle ? ` · ${e.jobTitle}` : ''}
        </option>
      ))}
    </select>
  );
}

/** A dialog on top of the page or the panel. */
function Sheet({ title, sub, children, actions, onClose }: { title: string; sub: string; children?: ReactNode; actions: ReactNode; onClose: () => void }) {
  return (
    <Modal maxWidth={520} onBackdrop={onClose}>
      <ModalHeader title={title} sub={sub} />
      {children}
      <div className="modal-actions">{actions}</div>
    </Modal>
  );
}

function Actions({ busy, ok, label, onCancel, onSave, testId, danger }: { busy: boolean; ok: boolean; label: string; onCancel: () => void; onSave: () => void; testId?: string; danger?: boolean }) {
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className={!ok || busy ? 'btn btn-disabled' : danger ? 'btn btn-primary dtp-danger-btn' : 'btn btn-primary'} data-testid={testId} disabled={!ok || busy} onClick={onSave}>
        {busy ? 'Saving…' : label}
      </button>
    </>
  );
}

/**
 * "New <level>" (the Org header's Create menu, a unit's "Add <level>" on the chart): name, parent (a unit of a
 * higher level, or directly under the company) and lead. The lead joins the unit and reports to the
 * nearest lead above, else the CEO.
 */
export function CreateUnitDialog({ level, parentId = null, onClose }: { level: ApiOrgLevel; parentId?: string | null; onClose: () => void }) {
  const { data } = useOrgStructure(true);
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | null>(parentId);
  const [lead, setLead] = useState<string | null>(null);
  const { busy, problem, run } = useRun(onClose);
  const parents = data ? parentChoices(data.levels, data.units, level.id) : [];
  const ok = name.trim().length > 0 && !!data;
  const save = () =>
    void run(
      (clear) => orgApi.createUnit({ levelId: level.id, name: name.trim(), parentId: parent, leadEmployeeId: lead, ...(clear ? { clearLeadRoles: true } : {}) }),
      `${level.name} ${name.trim()} created`,
    );
  return (
    <Sheet
      title={`New ${level.name.toLowerCase()}`}
      sub="A unit of the organization. Its lead reports to the lead above it, else the CEO; people you put in it report to the lead."
      onClose={onClose}
      actions={<Actions busy={busy} ok={ok} label={`Create ${level.name.toLowerCase()}`} onCancel={onClose} onSave={save} testId="unit-create-save" />}
    >
      <label className="form-label">
        Name
        <input
          className="form-input"
          data-testid="unit-create-name"
          value={name}
          maxLength={100}
          autoFocus
          placeholder={`${level.name} name`}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ok && save()}
        />
      </label>
      <label className="form-label">
        Inside
        <select className="form-input" data-testid="unit-create-parent" value={parent ?? ''} onChange={(e) => setParent(e.target.value || null)}>
          <option value="">Directly under the company</option>
          {data &&
            parents.map((u) => (
              <option key={u.id} value={u.id}>
                {unitPathLabel(data.units, u.id)}
              </option>
            ))}
        </select>
      </label>
      <label className="form-label">
        Lead
        <PersonSelect value={lead} onChange={setLead} employees={data?.employees ?? []} none="No lead" label="Lead" testId="unit-create-lead" />
      </label>
      {problem && <div className="dtp-problem">{problem}</div>}
    </Sheet>
  );
}

/** What an Admin does with a unit on the chart. */
export type UnitAction =
  | { kind: 'create'; level: ApiOrgLevel; parentId: string | null }
  | { kind: 'lead'; unit: ApiOrgUnit; leadId?: string | null }
  | { kind: 'rename'; unit: ApiOrgUnit }
  | { kind: 'move'; unit: ApiOrgUnit }
  | { kind: 'delete'; unit: ApiOrgUnit }
  | { kind: 'addPeople'; unit: ApiOrgUnit };

/** The dialog for `action`. */
export function UnitDialog({ action, data, onClose }: { action: UnitAction; data: OrgStructure; onClose: () => void }) {
  switch (action.kind) {
    case 'create':
      return <CreateUnitDialog level={action.level} parentId={action.parentId} onClose={onClose} />;
    case 'lead':
      return <LeadDialog unit={action.unit} initial={action.leadId} data={data} onClose={onClose} />;
    case 'rename':
      return <RenameUnit unit={action.unit} onClose={onClose} />;
    case 'move':
      return <MoveUnit unit={action.unit} data={data} onClose={onClose} />;
    case 'delete':
      return <DeleteUnit unit={action.unit} onClose={onClose} />;
    case 'addPeople':
      return <AddPeople unit={action.unit} data={data} onClose={onClose} />;
  }
}

function RenameUnit({ unit, onClose }: { unit: ApiOrgUnit; onClose: () => void }) {
  const [name, setName] = useState(unit.name);
  const { busy, problem, run } = useRun(onClose);
  const ok = !!name.trim() && name.trim() !== unit.name;
  const save = () => void run(() => orgApi.updateUnit(unit.id, { name: name.trim() }), `Renamed to ${name.trim()}`);
  return (
    <Sheet title={`Rename ${unit.name}`} sub="The new name shows everywhere the unit is used." onClose={onClose} actions={<Actions busy={busy} ok={ok} label="Save" onCancel={onClose} onSave={save} testId="unit-rename-save" />}>
      <label className="form-label">
        Name
        <input className="form-input" data-testid="unit-rename-name" value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && save()} />
      </label>
      {problem && <div className="dtp-problem">{problem}</div>}
    </Sheet>
  );
}

/**
 * Set or change the lead. The preview says what the org rules will do: who the lead reports to,
 * who will report to the lead (members who had no manager or reported to the previous lead), who
 * keeps their manager because of a loop, and the unit the person stops leading.
 */
function LeadDialog({ unit, initial, data, onClose }: { unit: ApiOrgUnit; initial?: string | null; data: OrgStructure; onClose: () => void }) {
  const [lead, setLead] = useState<string | null>(initial === undefined ? unit.leadEmployeeId : initial);
  const [preview, setPreview] = useState<(LeadPreview & { lead: string }) | null>(null);
  const { busy, problem, run } = useRun(onClose);
  useEffect(() => {
    if (!lead || lead === unit.leadEmployeeId) return;
    let alive = true;
    orgApi.leadPreview(unit.id, lead).then(
      (p) => alive && setPreview({ lead, ...p }),
      () => alive && setPreview({ lead, managerId: null, managerName: null, members: [], loops: [], leavesUnit: null }),
    );
    return () => {
      alive = false;
    };
  }, [unit.id, unit.leadEmployeeId, lead]);
  const leadName = data.employees.find((e) => e.id === lead)?.fullName ?? '';
  const changed = lead !== unit.leadEmployeeId;
  const shown = lead && preview?.lead === lead ? preview : null;
  const ready = changed && (!lead || !!shown);
  const save = () => void run((clear) => orgApi.updateUnit(unit.id, { leadEmployeeId: lead, ...(clear ? { clearLeadRoles: true } : {}) }), lead ? `${leadName} leads ${unit.name}` : `${unit.name} has no lead`);
  return (
    <Sheet
      title={`Lead of ${unit.name}`}
      sub="The lead joins the unit and is shown on top of it on the chart."
      onClose={onClose}
      actions={<Actions busy={busy} ok={ready} label="Save" onCancel={onClose} onSave={save} testId="unit-lead-save" />}
    >
      <label className="form-label">
        Lead
        <PersonSelect value={lead} onChange={setLead} employees={data.employees} none="No lead" label="Lead" testId="unit-lead" />
      </label>
      {shown && (
        <div className="dtp-note" data-testid="unit-lead-preview">
          <div>{shown.managerName ? `${leadName} will report to ${shown.managerName}.` : `${leadName} keeps their manager.`}</div>
          {shown.members.length > 0 && (
            <div>
              {names(shown.members)} will report to {leadName}.
            </div>
          )}
          {shown.loops.map((l) => (
            <div key={l.id}>
              {l.fullName} keeps their manager: {l.message.replace(/^This would create/, 'reporting to the lead would create')}.
            </div>
          ))}
          {shown.leavesUnit && <div>{leadName} stops leading {shown.leavesUnit.name}.</div>}
        </div>
      )}
      {problem && <div className="dtp-problem">{problem}</div>}
    </Sheet>
  );
}

/** Move a unit under another one (of a higher level), or directly under the company. Its people move with it. */
function MoveUnit({ unit, data, onClose }: { unit: ApiOrgUnit; data: OrgStructure; onClose: () => void }) {
  const choices = parentChoices(data.levels, data.units, unit.levelId, unitsBelow(data.units, unit.id));
  const [to, setTo] = useState<string>(unit.parentId ?? '');
  const { busy, problem, run } = useRun(onClose);
  const target = to ? unitPathLabel(data.units, to) : 'directly under the company';
  return (
    <Sheet
      title={`Move ${unit.name}`}
      sub="The unit moves with its people and the units inside it. Its lead reports to the lead above the new place."
      onClose={onClose}
      actions={
        <Actions busy={busy} ok={(to || null) !== unit.parentId} label="Move" onCancel={onClose} onSave={() => void run(() => orgApi.updateUnit(unit.id, { parentId: to || null }), `${unit.name} moved ${to ? 'to ' + target : target}`)} />
      }
    >
      <label className="form-label">
        Inside
        <select className="form-input" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Directly under the company</option>
          {choices.map((u) => (
            <option key={u.id} value={u.id}>
              {unitPathLabel(data.units, u.id)}
            </option>
          ))}
        </select>
      </label>
      {problem && <div className="dtp-problem">{problem}</div>}
    </Sheet>
  );
}

function DeleteUnit({ unit, onClose }: { unit: ApiOrgUnit; onClose: () => void }) {
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof orgApi.unitUsage>> | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const { busy, problem, run } = useRun(onClose);
  useEffect(() => {
    orgApi.unitUsage(unit.id).then(setUsage, (err) => setLoadProblem(orgError(err)));
  }, [unit.id]);
  const blocked = !!usage && (usage.units.length > 0 || usage.usedBy.length > 0);
  let sub = 'Checking…';
  if (usage?.units.length) sub = `${unit.name} has ${plural(usage.units.length, 'unit')} (${names(usage.units.map((t) => ({ fullName: t.name })))}). Move or delete them first.`;
  else if (usage?.usedBy.length) sub = `${unit.name} is used by ${usage.usedBy.join(', ')}, so it can't be deleted.`;
  else if (usage) sub = usage.members.length ? `Its ${plural(usage.members.length, 'member')} will have no unit and keep their managers: ${names(usage.members)}.` : 'It has no members.';
  return (
    <Sheet
      title={blocked ? `${unit.name} can't be deleted` : `Delete ${unit.name}?`}
      sub={loadProblem ?? sub}
      onClose={onClose}
      actions={
        blocked ? (
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        ) : (
          <Actions busy={busy} ok={!!usage} label="Delete unit" danger onCancel={onClose} onSave={() => void run(() => orgApi.deleteUnit(unit.id), `${unit.name} deleted`)} />
        )
      }
    >
      {problem && <div className="dtp-problem">{problem}</div>}
    </Sheet>
  );
}

/**
 * "Add people": a searchable multi-select of active employees. Each gets the unit's lead as
 * manager (else the nearest lead above, else the CEO), as the dialog says.
 */
function AddPeople({ unit, data, onClose }: { unit: ApiOrgUnit; data: OrgStructure; onClose: () => void }) {
  const { s } = useStore();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const { busy, problem, run } = useRun(onClose);
  const candidates = useMemo(() => {
    const q = fold(search);
    return data.employees.filter((e) => e.unitId !== unit.id && (!q || fold(`${e.fullName} ${e.jobTitle ?? ''} ${e.unitName ?? ''}`).includes(q)));
  }, [data.employees, search, unit.id]);
  const togglePick = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((p) => p !== id) : [...x, id]));
  const managerId = managerForUnit(data.units, unit.id, '', s.workspace.ceoEmployeeId);
  const managerName = data.employees.find((e) => e.id === managerId)?.fullName;
  return (
    <Sheet
      title={`Add people to ${unit.name}`}
      sub={managerName ? `They will report to ${managerName}.` : 'Their managers stay as they are: the unit has no lead above it and there is no CEO.'}
      onClose={onClose}
      actions={
        <Actions
          busy={busy}
          ok={picked.length > 0}
          label={picked.length ? `Add ${plural(picked.length, 'person', 'people')}` : 'Add people'}
          onCancel={onClose}
          onSave={() => void run((clear) => orgApi.assign({ unitId: unit.id, employeeIds: picked, ...(clear ? { clearLeadRoles: true } : {}) }), `${plural(picked.length, 'person', 'people')} added to ${unit.name}`)}
        />
      }
    >
      <input className="form-input" placeholder="Search people" aria-label="Search people" value={search} autoFocus onChange={(e) => setSearch(e.target.value)} />
      <div className="dtp-candidates">
        {candidates.length === 0 && <div className="dtp-empty">{search ? 'Nobody matches.' : 'Everybody is here already.'}</div>}
        {candidates.slice(0, 200).map((e) => (
          <label key={e.id} className="dtp-candidate">
            <input type="checkbox" checked={picked.includes(e.id)} onChange={() => togglePick(e.id)} />
            <span className="dtp-candidate-name">{e.fullName}</span>
            <span className="dtp-meta">{[e.jobTitle, e.unitName ? `moves from ${e.unitName}` : null].filter(Boolean).join(' · ')}</span>
          </label>
        ))}
      </div>
      {problem && <div className="dtp-problem">{problem}</div>}
    </Sheet>
  );
}
