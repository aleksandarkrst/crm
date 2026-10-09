import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { FieldRow, Switch } from '../../components/ui';
import { type ApiOrgLevel, orgApi } from '../../lib/orgApi';
import { orgError } from '../../store/org';
import { useStore } from '../../store/store';
import { TimeFormatAndMax, WorkingDayCard } from './WorkforceSettings';

/** At most this many levels (the API's limit, CD-226). */
const MAX_LEVELS = 5;

/**
 * "Organization levels" (CD-226): the named levels of the org structure top-down (Department and
 * Team by default). Rename inline, add (at the bottom, then move), remove (only a level without
 * units), and reorder by dragging a row or with the arrows. A unit's parent must be of a higher
 * level, so a reorder that breaks that is refused with the API's message. Read again on every
 * org change (`s.orgRev`).
 */
function OrgLevels() {
  const { s, flash, people } = useStore();
  const rev = s.orgRev;
  const [levels, setLevels] = useState<ApiOrgLevel[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const load = useCallback(() => orgApi.levels().then(setLevels, (err) => setProblem(orgError(err))), []);
  useEffect(() => void load(), [load, rev]);

  const run = async (action: () => Promise<ApiOrgLevel[]>, done: string) => {
    setProblem(null);
    try {
      setLevels(await action());
      people.refresh(0);
      flash(done);
      return true;
    } catch (err) {
      setProblem(orgError(err));
      void load();
      return false;
    }
  };
  const move = (from: number, to: number) => {
    if (!levels || to < 0 || to >= levels.length || from === to) return;
    const ids = levels.map((l) => l.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id!);
    void run(() => orgApi.reorderLevels(ids), 'Levels reordered');
  };
  const add = () => {
    const name = adding.trim();
    if (!name) return;
    void run(() => orgApi.createLevel(name), `Level ${name} added`).then((ok) => ok && setAdding(''));
  };
  const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--divider)' } as const;
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="org-levels">
      <div className="card-title">Organization levels</div>
      <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 6 }}>
        How the company is organized, top-down: for example Sector, Department and Team. Units are created on the Org structure page; a unit sits inside a unit of a higher level. Every unit's
        leader is its Lead.
      </span>
      {problem && (
        <div className="dtp-problem" role="alert" data-testid="org-levels-problem">
          {problem}
        </div>
      )}
      {!levels && !problem && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Loading…</span>}
      {levels?.map((l, i) => (
        <div
          key={l.id}
          style={{ ...row, opacity: dragging === l.id ? 0.5 : 1 }}
          data-testid="org-level-row"
          data-name={l.name}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/x-level', l.id);
            setDragging(l.id);
          }}
          onDragEnd={() => setDragging(null)}
          onDragOver={(e) => e.dataTransfer.types.includes('text/x-level') && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/x-level');
            setDragging(null);
            move(levels.findIndex((x) => x.id === id), i);
          }}
        >
          <span aria-hidden style={{ cursor: 'grab', color: 'var(--muted)', width: 14 }}>
            ⋮⋮
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted-2)', width: 18 }}>{i + 1}.</span>
          <LevelName level={l} onSave={(name) => run(() => orgApi.renameLevel(l.id, name), `Level renamed to ${name}`)} />
          <span style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{l.units === 1 ? '1 unit' : `${l.units} units`}</span>
          <button type="button" className="btn-plain" aria-label={`Move ${l.name} up`} data-testid="org-level-up" disabled={i === 0} onClick={() => move(i, i - 1)}>
            ↑
          </button>
          <button type="button" className="btn-plain" aria-label={`Move ${l.name} down`} data-testid="org-level-down" disabled={i === levels.length - 1} onClick={() => move(i, i + 1)}>
            ↓
          </button>
          <button
            type="button"
            className="btn-plain"
            data-testid="org-level-remove"
            disabled={l.units > 0 || levels.length === 1}
            title={l.units > 0 ? 'Only a level without units can be removed' : levels.length === 1 ? 'Keep at least one level' : undefined}
            onClick={() => void askConfirm({ title: `Remove the level ${l.name}?`, confirmLabel: 'Remove', danger: true }).then((ok) => ok && run(() => orgApi.deleteLevel(l.id), `Level ${l.name} removed`))}
          >
            Remove
          </button>
        </div>
      ))}
      {levels && levels.length < MAX_LEVELS && (
        <form
          style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input className="form-input" style={{ flex: '1 1 200px', minWidth: 0 }} aria-label="New level" data-testid="org-level-new" placeholder="New level, e.g. Sector" value={adding} maxLength={50} onChange={(e) => setAdding(e.target.value)} />
          <button type="submit" className={adding.trim() ? 'btn btn-secondary' : 'btn btn-disabled'} data-testid="org-level-add" disabled={!adding.trim()}>
            Add level
          </button>
        </form>
      )}
      {levels && levels.length >= MAX_LEVELS && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>A workspace has at most {MAX_LEVELS} levels.</span>}
    </div>
  );
}

/** The level's name as an input: Enter or leaving the field saves, Escape goes back. */
function LevelName({ level, onSave }: { level: ApiOrgLevel; onSave: (name: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(level.name);
  const [seen, setSeen] = useState(level.name);
  if (seen !== level.name) {
    setSeen(level.name);
    setDraft(level.name);
  }
  const save = async () => {
    const name = draft.trim();
    if (!name || name === level.name) return setDraft(level.name);
    if (!(await onSave(name))) setDraft(level.name);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') setDraft(level.name);
  };
  return (
    <input
      className="form-input"
      style={{ flex: 1, minWidth: 0, padding: '6px 9px' }}
      aria-label={`Name of level ${level.position}`}
      data-testid="org-level-name"
      value={draft}
      maxLength={50}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => void save()}
    />
  );
}

/**
 * Settings → Employees (CD-215, spec 10.3), Admins only: the weekly hours new employees and
 * imports start with, whether an employee number is required, and whether employees change their
 * own bank account, the time format and the most hours a day (CD-153), saved per workspace as you
 * change them (PATCH /workspace); the standard working day (CD-153); and the organization levels
 * (CD-226, their own endpoints).
 */
export function EmployeesTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <EmployeeSettings />
      <WorkingDayCard />
      <OrgLevels />
    </div>
  );
}

function EmployeeSettings() {
  const { s, setWorkspace } = useStore();
  const w = s.workspace;
  const [hours, setHours] = useState(String(w.employeeDefaultWeeklyHours));
  // A change from elsewhere (another Admin, a reload) shows unless you are typing a different value.
  const [shown, setShown] = useState(w.employeeDefaultWeeklyHours);
  if (shown !== w.employeeDefaultWeeklyHours) {
    setShown(w.employeeDefaultWeeklyHours);
    setHours(String(w.employeeDefaultWeeklyHours));
  }
  const valid = /^\d{1,2}$/.test(hours) && Number(hours) >= 1 && Number(hours) <= 60;
  const row = { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--divider)' } as const;
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="employee-settings">
      <div className="card-title" style={{ marginBottom: 8 }}>
        Employees
      </div>
      <FieldRow label="Default weekly hours">
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <input
            className="form-input"
            inputMode="numeric"
            aria-label="Default weekly hours"
            data-testid="employee-default-hours"
            value={hours}
            style={{ maxWidth: 120, borderColor: valid ? undefined : 'var(--danger)' }}
            onChange={(e) => {
              const next = e.target.value.replace(/[^\d]/g, '').slice(0, 2);
              setHours(next);
              const n = Number(next);
              if (/^\d{1,2}$/.test(next) && n >= 1 && n <= 60) {
                setShown(n);
                setWorkspace({ employeeDefaultWeeklyHours: n });
              }
            }}
            onBlur={() => !valid && setHours(String(w.employeeDefaultWeeklyHours))}
          />
          <span style={{ fontSize: 12, color: valid ? 'var(--text-2)' : 'var(--danger)' }}>{valid ? 'New employees and imports start with these hours.' : 'Between 1 and 60 hours.'}</span>
        </span>
      </FieldRow>
      <TimeFormatAndMax />
      <div style={row} data-setting="number-required">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Employee number required</span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Adding, editing and importing employees needs an employee number. Employees without one show under Data issues.</span>
        </div>
        <Switch on={w.employeeNumberRequired} onClick={() => setWorkspace({ employeeNumberRequired: !w.employeeNumberRequired })} label="Employee number required" />
      </div>
      <div style={{ ...row, borderBottom: 0 }} data-setting="self-edit-bank">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Employees can edit their own bank account</span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>When off, only Admins change bank accounts. The employee is emailed about every change either way.</span>
        </div>
        <Switch on={w.employeeSelfEditBank} onClick={() => setWorkspace({ employeeSelfEditBank: !w.employeeSelfEditBank })} label="Employees can edit their own bank account" />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 4 }}>Changes are saved as you make them. Only owners and admins edit employees, units and managers.</span>
    </div>
  );
}
