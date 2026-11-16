import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { askConfirm } from '../../components/ConfirmDialog';
import type { ApiTimesheetSettings } from '../../lib/api';
import { type ApiOrgLevel, orgApi } from '../../lib/orgApi';
import { paths } from '../../lib/paths';
import { parseHours, shortHours } from '../../lib/timesheetApi';
import { orgError } from '../../store/org';
import { useStore } from '../../store/store';
import { Badge, Card, DayToggles, Note, Preview, RemoveX, Row, RowsModal, Section, SummaryRow, Switch, Table, TextField, Unit } from './parts';

/** At most this many levels (the API's limit, CD-226). */
const MAX_LEVELS = 5;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const isClock = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** The workspace's timesheet settings and a save that sends them whole. */
export function useTimesheetSettings() {
  const { s, setWorkspace } = useStore();
  const t = s.workspace.timesheet;
  return { t, save: (patch: Partial<ApiTimesheetSettings>) => setWorkspace({ timesheet: { ...t, ...patch } }) };
}

/**
 * Workspace settings → Employees (CD-524 spec 2, design G-Settings-Employees): the employee record,
 * working time and organization levels. Not built because the app doesn't have them: the next
 * employee number, employees seeing the org chart, contract types, the name of a unit's head and
 * where employees may be placed.
 */
export function EmployeesPage() {
  return (
    <>
      <RecordSection />
      <WorkingTimeSection />
      <OrgLevelsSection />
    </>
  );
}

/** Employees → Employee record (CD-215): employee number required, employees editing their bank account. */
function RecordSection() {
  const { s, setWorkspace } = useStore();
  const w = s.workspace;
  return (
    <Section title="Employee record" desc="What is kept for every employee and who can change it.">
      <Card testId="employee-settings">
        <Row label="Employee number" desc={w.employeeNumberRequired ? 'Required. New employees cannot be saved without one.' : 'Optional'} setting="number-required" switchRow>
          <Switch on={w.employeeNumberRequired} label="Employee number required" onChange={(on) => setWorkspace({ employeeNumberRequired: on })} />
        </Row>
        <Row label="Employees can edit their own bank account" desc="Changes are emailed to the employee either way. When off, only Admins change bank accounts." setting="self-edit-bank" switchRow>
          <Switch on={w.employeeSelfEditBank} label="Employees can edit their own bank account" onChange={(on) => setWorkspace({ employeeSelfEditBank: on })} />
        </Row>
      </Card>
      <Note>
        People are invited and given a role on the Team page in Employees. <Link to={paths.team()}>Open the team</Link>
      </Note>
    </Section>
  );
}

/** "8 hours a day, 09:00 to 17:00, Monday to Friday" */
function daySummary(t: ApiTimesheetSettings) {
  const days = [...t.workingDays].sort((a, b) => a - b);
  const run = days.join() === '1,2,3,4,5' ? 'Monday to Friday' : days.length ? days.map((d) => DAY_NAMES[d - 1]!.slice(0, 3)).join(', ') : 'No working days';
  const hours = shortHours(t.dayMinutes, 'decimal');
  return `${hours} ${hours === '1' ? 'hour' : 'hours'} a day, ${t.dayStart} to ${t.dayEnd}, ${run}`;
}

/** Employees → Working time (CD-153, CD-215): the standard working day (a modal) and default weekly hours. */
function WorkingTimeSection() {
  const { s, setWorkspace } = useStore();
  const { t, save } = useTimesheetSettings();
  const [editing, setEditing] = useState(false);
  const hoursProblem = (v: string) => {
    const m = parseHours(v);
    return m !== null && m >= 15 && m <= 1440 ? '' : 'Use hours from 0.25 to 24, like 8 or 7.5.';
  };
  return (
    <Section title="Working time" desc="The standard working day. Timesheets, time off and capacity count from it.">
      <Card testId="working-day">
        <SummaryRow label="Standard working day" desc="Timesheets, time off and capacity count from it" summary={daySummary(t)} onEdit={() => setEditing(true)} testId="working-day-summary" />
        <Row label="Default weekly hours" desc="For new employees and imports. You can change it per person.">
          <TextField
            label="Default weekly hours"
            testId="employee-default-hours"
            width={90}
            inputMode="numeric"
            value={String(s.workspace.employeeDefaultWeeklyHours)}
            validate={(v) => (/^\d{1,2}$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 60 ? '' : 'Between 1 and 60 hours.')}
            onSave={(v) => setWorkspace({ employeeDefaultWeeklyHours: Number(v) })}
          />
          <Unit>hours</Unit>
        </Row>
      </Card>
      {editing && (
        <RowsModal title="Standard working day" desc="The day every employee is expected to work. Approved days keep the hours they had when they were approved." onClose={() => setEditing(false)} testId="working-day-modal">
          <Row label="Hours per day">
            <TextField label="Hours per day" testId="day-hours" width={90} inputMode="decimal" value={shortHours(t.dayMinutes, 'decimal')} validate={hoursProblem} onSave={(v) => save({ dayMinutes: parseHours(v)! })} />
            <Unit>hours</Unit>
          </Row>
          <Row label="Start">
            <TextField label="Start" testId="day-start" type="time" width={130} value={t.dayStart} validate={(v) => (isClock(v) ? '' : 'Use a time like 09:00.')} onSave={(v) => save({ dayStart: v })} />
          </Row>
          <Row label="End" error={t.dayEnd <= t.dayStart ? 'The working day must end after it starts.' : undefined}>
            <TextField label="End" testId="day-end" type="time" width={130} value={t.dayEnd} validate={(v) => (isClock(v) ? '' : 'Use a time like 17:00.')} onSave={(v) => save({ dayEnd: v })} />
          </Row>
          <Row label="Working days" desc="The other days are days off">
            <DayToggles days={t.workingDays} onChange={(days) => days.length && save({ workingDays: days })} />
          </Row>
        </RowsModal>
      )}
    </Section>
  );
}

/**
 * Employees → Organization levels (CD-226): the chain from the company down to Employee, and the
 * levels top-down, renamed in place. A level is added at the bottom; only the lowest can be removed,
 * and only without units. Read again on every org change (`s.orgRev`).
 */
function OrgLevelsSection() {
  const { s, flash, people } = useStore();
  const rev = s.orgRev;
  const [levels, setLevels] = useState<ApiOrgLevel[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
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
  const add = () => {
    const taken = new Set((levels ?? []).map((l) => l.name.toLowerCase()));
    let name = 'New level';
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `New level ${i}`;
    void run(() => orgApi.createLevel(name), 'Level added');
  };
  const last = levels ? levels.length - 1 : -1;
  return (
    <Section
      title="Organization levels"
      desc="The names of your levels, from the top down. The org chart and its units use these names."
      action={
        levels &&
        levels.length < MAX_LEVELS && (
          <button type="button" className="gs-btn primary" data-testid="org-level-add" onClick={add}>
            Add level
          </button>
        )
      }
      testId="org-levels"
    >
      {levels && levels.length > 0 && <Preview names={[s.workspace.name, ...levels.map((l) => l.name), 'Employee']} testId="org-levels-preview" />}
      {problem && (
        <span className="gs-error" role="alert" data-testid="org-levels-problem">
          {problem}
        </span>
      )}
      {!levels && !problem && <span className="gs-sub">Loading…</span>}
      {levels && (
        <Table cols={[{ label: 'Level' }, { label: 'Name' }, { label: 'Units', align: 'num' }, { label: '', align: 'end' }]} minWidth={480}>
          {levels.map((l, i) => (
            <tr key={l.id} data-testid="org-level-row" data-name={l.name}>
              <td>
                <span className="gs-cell">
                  <b>Level {i + 1}</b>
                  <span className="gs-sub">{i === 0 ? 'Top' : i === last ? 'Lowest' : ''}</span>
                </span>
              </td>
              <td>
                <LevelName level={l} onSave={(name) => run(() => orgApi.renameLevel(l.id, name), 'Changes saved')} />
              </td>
              <td className="num">{l.units}</td>
              <td className="end">
                {i === last && levels.length > 1 ? (
                  l.units > 0 ? (
                    <Badge>In use</Badge>
                  ) : (
                    <RemoveX
                      label={`Remove level ${i + 1}`}
                      testId="org-level-remove"
                      onClick={() => void askConfirm({ title: `Remove the level ${l.name}?`, confirmLabel: 'Remove', danger: true }).then((ok) => ok && run(() => orgApi.deleteLevel(l.id), `Level ${l.name} removed`))}
                    />
                  )
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {levels && levels.length >= MAX_LEVELS && <span className="gs-sub">A workspace has at most {MAX_LEVELS} levels.</span>}
      <Note>
        Only the lowest level can be removed, and only when it has no units. Units themselves are created on the org chart. <Link to={paths.org()}>Open the org chart</Link>
      </Note>
    </Section>
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
  return <input className="gs-input s" style={{ width: 200, maxWidth: '100%' }} aria-label={`Name of level ${level.position}`} data-testid="org-level-name" value={draft} maxLength={50} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => void save()} />;
}
