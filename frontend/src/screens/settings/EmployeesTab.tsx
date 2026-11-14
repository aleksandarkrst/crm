import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { Switch } from '../../components/ui';
import { type ApiOrgLevel, orgApi } from '../../lib/orgApi';
import { orgError } from '../../store/org';
import { useStore } from '../../store/store';
import { Block, MoveButton, Note, Row, Rows, StagePreview, Table, Unit } from './parts';
import { WorkingDayRows } from './WorkforceSettings';

/** At most this many levels (the API's limit, CD-226). */
const MAX_LEVELS = 5;

/**
 * Settings → Employees → Organization levels (CD-226; its own section since CD-524, design
 * G-Settings "orglevels"): the named levels of the org structure top-down (Department and Team by
 * default), with a preview of how the company is built. Rename inline, add (at the bottom, then
 * move), remove (only a level without units), and reorder by dragging a row or with the arrows. A
 * unit's parent must be of a higher level, so a reorder that breaks that is refused with the API's
 * message. Read again on every org change (`s.orgRev`).
 */
export function OrgLevelsTab() {
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
  return (
    <>
      {levels && levels.length > 0 && (
        <Block title="How your organization is built">
          <StagePreview names={[s.workspace.name, ...levels.map((l) => l.name), 'Employee']} testId="org-levels-preview" />
        </Block>
      )}
      <Block title="Levels" desc={`Level 1 sits right under the company; a unit sits inside a unit of a higher level, and every unit's leader is its Lead. You can have up to ${MAX_LEVELS} levels.`} testId="org-levels">
        {problem && (
          <div className="dtp-problem" role="alert" data-testid="org-levels-problem">
            {problem}
          </div>
        )}
        {!levels && !problem && <span className="ws-block-desc">Loading…</span>}
        {levels && (
          <Table cols={[{ label: '' }, { label: 'Level' }, { label: 'Name' }, { label: 'Units', align: 'num' }, { label: '', align: 'actions' }]} minWidth={520}>
            {levels.map((l, i) => (
              <tr
                key={l.id}
                style={{ opacity: dragging === l.id ? 0.5 : 1 }}
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
                  move(
                    levels.findIndex((x) => x.id === id),
                    i,
                  );
                }}
              >
                <td style={{ width: 14, cursor: 'grab', color: 'var(--muted)' }} aria-hidden>
                  ⋮⋮
                </td>
                <td>
                  <span className="ws-cell">
                    <b>Level {i + 1}</b>
                    <span className="ws-row-hint">{i === 0 ? 'Top' : i === levels.length - 1 ? 'Lowest' : ''}</span>
                  </span>
                </td>
                <td>
                  <LevelName level={l} onSave={(name) => run(() => orgApi.renameLevel(l.id, name), `Level renamed to ${name}`)} />
                </td>
                <td className="num">{l.units === 1 ? '1 unit' : `${l.units} units`}</td>
                <td className="actions">
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <MoveButton dir="up" label={`Move ${l.name} up`} testId="org-level-up" disabled={i === 0} onClick={() => move(i, i - 1)} />
                    <MoveButton dir="down" label={`Move ${l.name} down`} testId="org-level-down" disabled={i === levels.length - 1} onClick={() => move(i, i + 1)} />
                    <button
                      type="button"
                      className="btn-plain"
                      style={{ padding: '5px 10px', fontSize: 12.5, marginLeft: 4 }}
                      data-testid="org-level-remove"
                      disabled={l.units > 0 || levels.length === 1}
                      title={l.units > 0 ? 'Only a level without units can be removed' : levels.length === 1 ? 'Keep at least one level' : undefined}
                      onClick={() => void askConfirm({ title: `Remove the level ${l.name}?`, confirmLabel: 'Remove', danger: true }).then((ok) => ok && run(() => orgApi.deleteLevel(l.id), `Level ${l.name} removed`))}
                    >
                      Remove
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {levels && levels.length < MAX_LEVELS && (
          <form
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input
              className="form-input"
              style={{ flex: '1 1 200px', minWidth: 0, maxWidth: 320 }}
              aria-label="New level"
              data-testid="org-level-new"
              placeholder="New level, e.g. Sector"
              value={adding}
              maxLength={50}
              onChange={(e) => setAdding(e.target.value)}
            />
            <button type="submit" className={adding.trim() ? 'btn btn-primary' : 'btn btn-disabled'} data-testid="org-level-add" disabled={!adding.trim()}>
              Add level
            </button>
          </form>
        )}
        {levels && levels.length >= MAX_LEVELS && <span className="ws-block-desc">A workspace has at most {MAX_LEVELS} levels.</span>}
      </Block>
      <Note>Only a level without units can be removed. Units themselves are created on the Org structure page.</Note>
    </>
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
      style={{ width: 200, maxWidth: '100%', padding: '7px 10px' }}
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
 * Settings → Employees → Employee record (CD-215, spec 10.3; design G-Settings "employees"):
 * whether an employee number is required and whether employees change their own bank account,
 * saved per workspace as you change them (PATCH /workspace).
 */
export function EmployeeRecordTab() {
  const { s, setWorkspace } = useStore();
  const w = s.workspace;
  return (
    <>
      <Block title="Record">
        <Rows testId="employee-settings">
          <Row label="Employee number required" hint="Adding, editing and importing employees needs an employee number. Employees without one show under Data issues." setting="number-required" switchRow>
            <Switch on={w.employeeNumberRequired} onClick={() => setWorkspace({ employeeNumberRequired: !w.employeeNumberRequired })} label="Employee number required" />
          </Row>
          <Row label="Employees can edit their own bank account" hint="When off, only Admins change bank accounts. The employee is emailed about every change either way." setting="self-edit-bank" switchRow>
            <Switch on={w.employeeSelfEditBank} onClick={() => setWorkspace({ employeeSelfEditBank: !w.employeeSelfEditBank })} label="Employees can edit their own bank account" />
          </Row>
        </Rows>
      </Block>
      <Note>Only owners and admins edit employees, units and managers. People are invited and given a role on the Team page.</Note>
    </>
  );
}

/**
 * Settings → General → Working time (CD-153, CD-215; design G-Settings "worktime", in General since the CD-524 review): the standard
 * working day, and the weekly hours new employees and imports start with.
 */
export function WorkingTimeBlocks() {
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
  return (
    <>
      <Block title="Working day" desc="The day every employee is expected to work. Drives expected hours in the Timesheet and the hours of time off.">
        <WorkingDayRows />
      </Block>
      <Note>Approved days keep the hours they had when they were approved.</Note>
      <Block title="Weekly hours">
        <Rows>
          <Row label="Default weekly hours" hint={valid ? 'New employees and imports start with these hours. You can change it per person.' : undefined} error={valid ? undefined : 'Between 1 and 60 hours.'}>
            <input
              className="form-input narrow"
              inputMode="numeric"
              aria-label="Default weekly hours"
              data-testid="employee-default-hours"
              value={hours}
              aria-invalid={!valid}
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
            <Unit>hours</Unit>
          </Row>
        </Rows>
      </Block>
    </>
  );
}
