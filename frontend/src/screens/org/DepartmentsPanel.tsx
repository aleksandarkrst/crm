/**
 * "Departments & teams" (CD-138, spec 6.3): Administration and Admins set up the departments and
 * teams of the company and put people into them. Opened from the Org structure header with
 * <DepartmentsPanelButton/>. A list of departments, each expandable to its teams, with counts of
 * active employees; add and rename inline; move a team; delete with confirmations that name the
 * members; "Add people" with the prefilled manager; the team-lead dialog "Make team members report
 * to <lead>" (CD-139). Changes by others show up through live updates (store/org.ts).
 */
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import { type ApiDepartment, type ApiDirectoryRow, type ApiOrgPerson, type ApiTeam, type AssignmentRow, type LoopSkip, orgApi } from '../../lib/orgApi';
import { canManageOrg, type OrgStructure, orgError, useOrgStructure } from '../../store/org';
import { fold } from '../../store/search';
import { useStore } from '../../store/store';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Ana Petrović, Marko Ilić and 3 others". */
function names(people: { fullName: string }[], max = 6): string {
  if (people.length <= max) return people.length <= 1 ? (people[0]?.fullName ?? '') : `${people.slice(0, -1).map((p) => p.fullName).join(', ')} and ${people.at(-1)!.fullName}`;
  return `${people.slice(0, max).map((p) => p.fullName).join(', ')} and ${plural(people.length - max, 'other')}`;
}

/** The header button that opens the panel; shown to Administration and Admins only. */
export function DepartmentsPanelButton({ className = 'btn btn-plain' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let alive = true;
    orgApi.access().then(
      (a) => alive && setAllowed(canManageOrg(a)),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);
  if (!allowed) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Departments &amp; teams
      </button>
      {open && <DepartmentsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

type Dialog =
  | { kind: 'editDepartment'; department: ApiDepartment }
  | { kind: 'deleteDepartment'; department: ApiDepartment }
  | { kind: 'deleteTeam'; team: ApiTeam }
  | { kind: 'moveTeam'; team: ApiTeam }
  | { kind: 'lead'; team: ApiTeam }
  | { kind: 'addPeople'; department: ApiDepartment; team: ApiTeam | null };

export function DepartmentsPanel({ onClose }: { onClose: () => void }) {
  const { data, error, reload } = useOrgStructure(true);
  const { flash } = useStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<'department' | string | null>(null); // 'department', or a department id (add team)
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && !dialog && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, onClose]);

  /** Runs a change, shows the API's message when it is refused, and reads the structure again. */
  const run = async (action: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setProblem(null);
    try {
      await action();
      await reload();
      if (done) flash(done);
      return true;
    } catch (err) {
      setProblem(orgError(err));
      return false;
    }
  };
  const toggle = (id: string) =>
    setExpanded((x) => {
      const next = new Set(x);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const teamsOf = (departmentId: string) => data?.teams.filter((t) => t.departmentId === departmentId) ?? [];
  const without = data ? data.employees.filter((e) => !e.departmentId).length : 0;
  const manage = canManageOrg(data?.access);

  return (
    <Modal maxWidth={760} onBackdrop={dialog ? undefined : onClose}>
      <div className="org-panel-head">
        <ModalHeader
          title="Departments & teams"
          sub={data ? `${plural(data.departments.length, 'department')} · ${plural(data.teams.length, 'team')}${without ? ` · ${plural(without, 'employee')} without a department` : ''}` : 'Loading…'}
        />
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <div className="org-problem">{error}</div>}
      {problem && (
        <div className="org-problem" role="alert">
          {problem}
        </div>
      )}
      {data && !manage && <div className="org-problem">Only Administration and Admins change departments and teams.</div>}
      {data && manage && (
        <>
          <div className="org-list" data-testid="departments-list">
            {data.departments.length === 0 && adding !== 'department' && <div className="org-empty">No departments yet. Add the first one, for example Sales or Service.</div>}
            {data.departments.map((d) => {
              const teams = teamsOf(d.id);
              const inTeams = teams.reduce((n, t) => n + t.activeEmployees, 0);
              const open = expanded.has(d.id);
              return (
                <div key={d.id} className="org-dept" data-testid={`department-${d.name}`}>
                  <div className="org-row">
                    <button type="button" className="org-expand" aria-expanded={open} aria-label={open ? `Collapse ${d.name}` : `Expand ${d.name}`} onClick={() => toggle(d.id)}>
                      {open ? '▾' : '▸'}
                    </button>
                    <div className="org-main">
                      <InlineName value={d.name} label="Department name" onSave={(name) => run(() => orgApi.updateDepartment(d.id, { name }), 'Department renamed')} />
                      <span className="org-meta">
                        {d.code && <span className="org-code">{d.code}</span>}
                        {d.headName ? `Head: ${d.headName}` : 'No head'} · {plural(d.activeEmployees, 'person', 'people')} · {plural(d.teams, 'team')}
                      </span>
                    </div>
                    <div className="org-actions">
                      <button type="button" className="org-link" onClick={() => setDialog({ kind: 'addPeople', department: d, team: null })}>
                        Add people
                      </button>
                      <button
                        type="button"
                        className="org-link"
                        onClick={() => {
                          setExpanded((x) => new Set(x).add(d.id));
                          setAdding(d.id);
                        }}
                      >
                        Add team
                      </button>
                      <button type="button" className="org-link" onClick={() => setDialog({ kind: 'editDepartment', department: d })}>
                        Edit
                      </button>
                      <button type="button" className="org-link org-danger" onClick={() => setDialog({ kind: 'deleteDepartment', department: d })}>
                        Delete
                      </button>
                    </div>
                  </div>
                  {open && (
                    <div className="org-teams">
                      {teams.map((t) => (
                        <div key={t.id} className="org-row org-team" data-testid={`team-${t.name}`}>
                          <div className="org-main">
                            <InlineName value={t.name} label="Team name" onSave={(name) => run(() => orgApi.updateTeam(t.id, { name }), 'Team renamed')} />
                            <span className="org-meta">
                              {t.leadName ? `Lead: ${t.leadName}${t.leadOutside ? ' (lead, not a member)' : ''}` : 'No lead'} · {plural(t.activeEmployees, 'person', 'people')}
                            </span>
                          </div>
                          <div className="org-actions">
                            <button type="button" className="org-link" onClick={() => setDialog({ kind: 'addPeople', department: d, team: t })}>
                              Add people
                            </button>
                            <button type="button" className="org-link" onClick={() => setDialog({ kind: 'lead', team: t })}>
                              Set lead
                            </button>
                            <button type="button" className="org-link" onClick={() => setDialog({ kind: 'moveTeam', team: t })}>
                              Move
                            </button>
                            <button type="button" className="org-link org-danger" onClick={() => setDialog({ kind: 'deleteTeam', team: t })}>
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                      {d.activeEmployees > inTeams && <div className="org-row org-team org-noteam">{plural(d.activeEmployees - inTeams, 'person', 'people')} in no team</div>}
                      {adding === d.id ? (
                        <AddForm
                          what="team"
                          employees={data.employees}
                          onCancel={() => setAdding(null)}
                          onSave={(name, person) => run(() => orgApi.createTeam({ departmentId: d.id, name, leadEmployeeId: person }), `Team ${name} added`).then((ok) => ok && setAdding(null))}
                        />
                      ) : (
                        <button type="button" className="btn-dashed org-add-team" onClick={() => setAdding(d.id)}>
                          + Add team
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {adding === 'department' ? (
            <AddForm
              what="department"
              employees={data.employees}
              onCancel={() => setAdding(null)}
              onSave={(name, person, code) => run(() => orgApi.createDepartment({ name, code: code || null, headEmployeeId: person }), `Department ${name} added`).then((ok) => ok && setAdding(null))}
            />
          ) : (
            <button type="button" className="btn btn-primary org-add-dept" onClick={() => setAdding('department')}>
              Add department
            </button>
          )}
        </>
      )}
      {dialog && data && <OrgDialog dialog={dialog} data={data} onClose={() => setDialog(null)} run={run} />}
    </Modal>
  );
}

/** Click the name to rename it; Enter saves, Escape cancels. */
function InlineName({ value, label, onSave }: { value: string; label: string; onSave: (name: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button type="button" className="org-name" title="Rename" onClick={() => setDraft(value)}>
        {value}
      </button>
    );
  }
  const save = async () => {
    const name = draft.trim();
    if (!name || name === value) return setDraft(null);
    if (await onSave(name)) setDraft(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void save();
    if (e.key === 'Escape') {
      e.stopPropagation();
      setDraft(null);
    }
  };
  return <input className="form-input org-name-input" aria-label={label} value={draft} maxLength={100} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => void save()} />;
}

/** Active employees to pick from, by name. */
function PersonSelect({ value, onChange, employees, none, label }: { value: string | null; onChange: (id: string | null) => void; employees: ApiDirectoryRow[]; none: string; label: string }) {
  return (
    <select className="form-input" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
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

/** Add a department (name, code, head) or a team (name, lead). */
function AddForm({ what, employees, onSave, onCancel }: { what: 'department' | 'team'; employees: ApiDirectoryRow[]; onSave: (name: string, person: string | null, code: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [person, setPerson] = useState<string | null>(null);
  const ok = name.trim().length > 0;
  return (
    <form
      className="org-add-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave(name.trim(), person, code.trim());
      }}
    >
      <input className="form-input" aria-label={what === 'team' ? 'Team name' : 'Department name'} placeholder={what === 'team' ? 'Team name, e.g. Service Belgrade' : 'Department name, e.g. Service'} value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} />
      {what === 'department' && <input className="form-input org-code-input" aria-label="Code" placeholder="Code (optional)" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />}
      <PersonSelect value={person} onChange={setPerson} employees={employees} none={what === 'team' ? 'No team lead' : 'No department head'} label={what === 'team' ? 'Team lead' : 'Department head'} />
      <div className="org-form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={ok ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!ok}>
          Add {what}
        </button>
      </div>
    </form>
  );
}

type Run = (action: () => Promise<unknown>, done?: string) => Promise<boolean>;

function OrgDialog({ dialog, data, onClose, run }: { dialog: Dialog; data: OrgStructure; onClose: () => void; run: Run }) {
  switch (dialog.kind) {
    case 'editDepartment':
      return <EditDepartment department={dialog.department} data={data} onClose={onClose} run={run} />;
    case 'deleteDepartment':
      return <DeleteDepartment department={dialog.department} onClose={onClose} run={run} />;
    case 'deleteTeam':
      return <DeleteTeam team={dialog.team} data={data} onClose={onClose} run={run} />;
    case 'moveTeam':
      return <MoveTeam team={dialog.team} data={data} onClose={onClose} run={run} />;
    case 'lead':
      return <TeamLead team={dialog.team} data={data} onClose={onClose} run={run} />;
    case 'addPeople':
      return <AddPeople department={dialog.department} team={dialog.team} data={data} onClose={onClose} run={run} />;
  }
}

/** A dialog on top of the panel. */
function Sheet({ title, sub, children, actions, onClose }: { title: string; sub: string; children?: ReactNode; actions: ReactNode; onClose: () => void }) {
  return (
    <Modal maxWidth={520} z={50} onBackdrop={onClose}>
      <ModalHeader title={title} sub={sub} />
      {children}
      <div className="modal-actions">{actions}</div>
    </Modal>
  );
}

function useBusy(run: Run, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (err) {
      setProblem(orgError(err));
      setBusy(false);
      return;
    }
    await run(async () => {}, done);
    onClose();
  };
  return { busy, problem, go };
}

function EditDepartment({ department, data, onClose, run }: { department: ApiDepartment; data: OrgStructure; onClose: () => void; run: Run }) {
  const [name, setName] = useState(department.name);
  const [code, setCode] = useState(department.code ?? '');
  const [head, setHead] = useState(department.headEmployeeId);
  const { busy, problem, go } = useBusy(run, onClose);
  const ok = name.trim().length > 0 && !busy;
  return (
    <Sheet
      title={`Edit ${department.name}`}
      sub="The new name shows everywhere at once; the history keeps the old one. Setting a head changes nobody's manager."
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={ok ? 'btn btn-primary' : 'btn btn-disabled'}
            disabled={!ok}
            onClick={() => void go(() => orgApi.updateDepartment(department.id, { name: name.trim(), code: code.trim() || null, headEmployeeId: head }), 'Department saved')}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <label className="form-label">
        Name
        <input className="form-input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="form-label">
        Code
        <input className="form-input" value={code} maxLength={20} placeholder="e.g. SRV" onChange={(e) => setCode(e.target.value)} />
      </label>
      <label className="form-label">
        Department head
        <PersonSelect value={head} onChange={setHead} employees={data.employees} none="No department head" label="Department head" />
      </label>
      {problem && <div className="org-problem">{problem}</div>}
    </Sheet>
  );
}

function DeleteDepartment({ department, onClose, run }: { department: ApiDepartment; onClose: () => void; run: Run }) {
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof orgApi.departmentUsage>> | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const { busy, problem, go } = useBusy(run, onClose);
  useEffect(() => {
    orgApi.departmentUsage(department.id).then(setUsage, (err) => setLoadProblem(orgError(err)));
  }, [department.id]);
  const blocked = usage && (usage.teams.length > 0 || usage.usedBy.length > 0);
  let sub = 'Checking…';
  if (usage?.teams.length) sub = `${department.name} has ${plural(usage.teams.length, 'team')} (${names(usage.teams.map((t) => ({ fullName: t.name })))}). Delete them or move them to another department first.`;
  else if (usage?.usedBy.length) sub = `${department.name} is used by ${usage.usedBy.join(', ')}, so it can't be deleted.`;
  else if (usage) sub = usage.members.length ? `Its ${plural(usage.members.length, 'member')} will have no department: ${names(usage.members)}.` : 'It has no members.';
  return (
    <Sheet
      title={blocked ? `${department.name} can't be deleted` : `Delete ${department.name}?`}
      sub={loadProblem ?? sub}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {blocked ? 'Close' : 'Cancel'}
          </button>
          {usage && !blocked && (
            <button type="button" className="btn btn-primary org-danger-btn" disabled={busy} onClick={() => void go(() => orgApi.deleteDepartment(department.id), `Department ${department.name} deleted`)}>
              {busy ? 'Deleting…' : 'Delete department'}
            </button>
          )}
        </>
      }
    >
      {problem && <div className="org-problem">{problem}</div>}
    </Sheet>
  );
}

/** The team's active members from the directory (for the confirmations). */
const membersOf = (data: OrgStructure, teamId: string) => data.employees.filter((e) => e.teamId === teamId);

function DeleteTeam({ team, data, onClose, run }: { team: ApiTeam; data: OrgStructure; onClose: () => void; run: Run }) {
  const members = membersOf(data, team.id);
  const department = data.departments.find((d) => d.id === team.departmentId);
  const { busy, problem, go } = useBusy(run, onClose);
  return (
    <Sheet
      title={`Delete ${team.name}?`}
      sub={members.length ? `Its ${plural(members.length, 'member')} stay in ${department?.name ?? 'the department'} without a team: ${names(members)}.` : 'It has no members.'}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary org-danger-btn" disabled={busy} onClick={() => void go(() => orgApi.deleteTeam(team.id), `Team ${team.name} deleted`)}>
            {busy ? 'Deleting…' : 'Delete team'}
          </button>
        </>
      }
    >
      {problem && <div className="org-problem">{problem}</div>}
    </Sheet>
  );
}

function MoveTeam({ team, data, onClose, run }: { team: ApiTeam; data: OrgStructure; onClose: () => void; run: Run }) {
  const others = data.departments.filter((d) => d.id !== team.departmentId);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const members = membersOf(data, team.id);
  const target = others.find((d) => d.id === to);
  const { busy, problem, go } = useBusy(run, onClose);
  return (
    <Sheet
      title={`Move ${team.name}`}
      sub={others.length ? 'The team moves to another department, and its members with it.' : 'There is no other department to move it to. Add one first.'}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {target && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void go(() => orgApi.updateTeam(team.id, { departmentId: target.id }), `${team.name} moved to ${target.name}`)}>
              {busy ? 'Moving…' : `Move to ${target.name}`}
            </button>
          )}
        </>
      }
    >
      {others.length > 0 && (
        <label className="form-label">
          To department
          <select className="form-input" value={to} onChange={(e) => setTo(e.target.value)}>
            {others.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {target && <div className="org-note">{members.length ? `${plural(members.length, 'employee')} move to ${target.name}: ${names(members)}.` : 'No employees move: the team has no members.'}</div>}
      {problem && <div className="org-problem">{problem}</div>}
    </Sheet>
  );
}

/** Set or change the lead; offers "Make team members report to <lead>" (ticked by default). */
function TeamLead({ team, data, onClose, run }: { team: ApiTeam; data: OrgStructure; onClose: () => void; run: Run }) {
  const [lead, setLead] = useState<string | null>(team.leadEmployeeId);
  const [preview, setPreview] = useState<{ lead: string; members: ApiOrgPerson[]; loops: LoopSkip[] } | null>(null);
  const [report, setReport] = useState(true);
  const { busy, problem, go } = useBusy(run, onClose);
  useEffect(() => {
    if (!lead) return;
    let alive = true;
    orgApi.leadPreview(team.id, lead).then(
      (p) => alive && setPreview({ lead, ...p }),
      () => alive && setPreview({ lead, members: [], loops: [] }),
    );
    return () => {
      alive = false;
    };
  }, [team.id, lead]);
  const leadName = data.employees.find((e) => e.id === lead)?.fullName ?? '';
  const shown = lead && preview?.lead === lead ? preview : null;
  const offer = !!shown && shown.members.length > 0;
  const save = () => {
    const makeMembersReport = offer && report;
    const done = makeMembersReport ? `${leadName} leads ${team.name} · ${plural(shown!.members.length, 'person', 'people')} now report to them` : lead ? `${leadName} leads ${team.name}` : `${team.name} has no lead`;
    void go(() => orgApi.updateTeam(team.id, { leadEmployeeId: lead, ...(makeMembersReport ? { makeMembersReport } : {}) }), done);
  };
  return (
    <Sheet
      title={`Team lead of ${team.name}`}
      sub="The lead is shown on the chart. Reporting lines change only if you tick the box below."
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={busy || (lead && !shown) ? 'btn btn-disabled' : 'btn btn-primary'} disabled={busy || (!!lead && !shown)} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <label className="form-label">
        Team lead
        <PersonSelect value={lead} onChange={setLead} employees={data.employees} none="No team lead" label="Team lead" />
      </label>
      {offer && (
        <label className="org-check">
          <input type="checkbox" checked={report} onChange={(e) => setReport(e.target.checked)} />
          <span>
            Make team members report to {leadName}
            <span className="org-check-sub">
              {names(shown!.members)} {shown!.members.length === 1 ? 'has' : 'have'} no manager or reported to the previous lead.
            </span>
          </span>
        </label>
      )}
      {shown && shown.loops.length > 0 && (
        <div className="org-note">
          {shown.loops.map((l) => (
            <div key={l.id}>
              {l.fullName} keeps their manager: {l.message.replace(/^This would create/, 'reporting to the lead would create')}.
            </div>
          ))}
        </div>
      )}
      {problem && <div className="org-problem">{problem}</div>}
    </Sheet>
  );
}

/**
 * "Add people": a searchable multi-select of active employees. People in another team are moved
 * ("moves from <team>"); someone without a manager gets the suggested Reports to (the team lead,
 * else the department head), which can be changed before saving.
 */
function AddPeople({ department, team, data, onClose, run }: { department: ApiDepartment; team: ApiTeam | null; data: OrgStructure; onClose: () => void; run: Run }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, AssignmentRow>>({});
  const [managers, setManagers] = useState<Record<string, string | null>>({});
  const { busy, problem, go } = useBusy(run, onClose);
  const self = data.access.employeeId;
  const isAdmin = data.access.roles.includes('admin');

  const candidates = useMemo(() => {
    const q = fold(search);
    return data.employees.filter((e) => (team ? e.teamId !== team.id : e.departmentId !== department.id) && (isAdmin || e.id !== self) && (!q || fold(`${e.fullName} ${e.jobTitle ?? ''} ${e.teamName ?? ''}`).includes(q)));
  }, [data.employees, search, team, department.id, isAdmin, self]);

  // Where the picked people come from and their suggested managers (the API's rule).
  useEffect(() => {
    const missing = picked.filter((id) => !rows[id]);
    if (!missing.length) return;
    let alive = true;
    const timer = setTimeout(() => {
      orgApi.previewAssignment({ departmentId: department.id, teamId: team?.id ?? null, employeeIds: missing }).then(
        ({ employees }) => {
          if (!alive) return;
          setRows((x) => ({ ...x, ...Object.fromEntries(employees.map((e) => [e.id, e])) }));
          setManagers((x) => ({ ...Object.fromEntries(employees.filter((e) => !e.managerId).map((e) => [e.id, e.suggestedManagerId])), ...x }));
        },
        () => {},
      );
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [picked, rows, department.id, team?.id]);

  const togglePick = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((p) => p !== id) : [...x, id]));
  const where = team ? `${team.name} (${department.name})` : department.name;
  const ready = picked.length > 0 && picked.every((id) => rows[id]) && !busy;
  const save = () => {
    const chosen = Object.fromEntries(picked.filter((id) => rows[id] && !rows[id]!.managerId && managers[id]).map((id) => [id, managers[id]!]));
    void go(() => orgApi.assign({ departmentId: department.id, teamId: team?.id ?? null, employeeIds: picked, ...(Object.keys(chosen).length ? { managers: chosen } : {}) }), `${plural(picked.length, 'person', 'people')} added to ${team?.name ?? department.name}`);
  };
  const byId = new Map(data.employees.map((e) => [e.id, e]));

  return (
    <Sheet
      title={`Add people to ${where}`}
      sub={team ? 'People in another team move to this one.' : 'People keep their team if it is in this department; otherwise they leave it.'}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={ready ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!ready} onClick={save}>
            {busy ? 'Adding…' : picked.length ? `Add ${plural(picked.length, 'person', 'people')}` : 'Add people'}
          </button>
        </>
      }
    >
      {picked.length > 0 && (
        <div className="org-picked" data-testid="picked">
          {picked.map((id) => {
            const row = rows[id];
            const person = byId.get(id);
            const from = row?.moves ? (row.teamName ?? (row.departmentId ? data.departments.find((d) => d.id === row.departmentId)?.name : null)) : null;
            return (
              <div key={id} className="org-picked-row">
                <div className="org-picked-name">
                  <span>{person?.fullName ?? row?.fullName}</span>
                  {from && <span className="org-meta">moves from {from}</span>}
                  <button type="button" className="org-link" onClick={() => togglePick(id)} aria-label={`Remove ${person?.fullName ?? ''}`}>
                    Remove
                  </button>
                </div>
                {row && !row.managerId && (
                  <label className="org-reports">
                    <span className="org-meta">Reports to</span>
                    <PersonSelect value={managers[id] ?? null} onChange={(m) => setManagers((x) => ({ ...x, [id]: m }))} employees={data.employees.filter((e) => e.id !== id)} none="No manager" label={`Reports to for ${row.fullName}`} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}
      <input className="form-input" placeholder="Search people" aria-label="Search people" value={search} autoFocus onChange={(e) => setSearch(e.target.value)} />
      <div className="org-candidates">
        {candidates.length === 0 && <div className="org-empty">{search ? 'Nobody matches.' : 'Everybody is here already.'}</div>}
        {candidates.slice(0, 200).map((e) => (
          <label key={e.id} className="org-candidate">
            <input type="checkbox" checked={picked.includes(e.id)} onChange={() => togglePick(e.id)} />
            <span className="org-candidate-name">{e.fullName}</span>
            <span className="org-meta">{[e.jobTitle, e.teamName ?? e.departmentName].filter(Boolean).join(' · ')}</span>
          </label>
        ))}
      </div>
      {problem && <div className="org-problem">{problem}</div>}
    </Sheet>
  );
}
