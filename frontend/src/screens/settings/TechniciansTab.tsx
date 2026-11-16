import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, peopleCardApi, WORK_TYPE_LABEL, type WorkType } from '../../lib/api';
import { paths } from '../../lib/paths';
import { projectError } from '../../store/projects';
import { initialsOf } from '../../store/selectors';
import { useStore } from '../../store/store';
import { Dropdown, Section, Table } from './parts';

interface Technician {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  team: string | null;
  workType: WorkType;
  openTasks: number;
  openWorkOrders: number;
}

const WORK_TYPES = (Object.keys(WORK_TYPE_LABEL) as WorkType[]).map((w) => ({
  value: w,
  label: `${WORK_TYPE_LABEL[w]}, ${w === 'office' ? 'project tasks' : w === 'service' ? 'work orders' : 'tasks and work orders'}`,
}));

/**
 * Projects → Technicians (CD-268): everyone with their team, their work type (what they can be
 * given; the same field as on their employee card) and their open work. Owners and admins.
 */
export function TechniciansSection() {
  const { flash } = useStore();
  const [rows, setRows] = useState<Technician[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Technician[]>('/technicians')
      .then(setRows)
      .catch((err: unknown) => setError(projectError(err)));
  }, []);

  const change = async (t: Technician, workType: WorkType) => {
    const before = rows ?? [];
    setRows(before.map((r) => (r.employeeId === t.employeeId ? { ...r, workType } : r)));
    try {
      await peopleCardApi.update(t.employeeId, { workType });
      flash('Changes saved');
    } catch {
      setRows(before);
      flash('Could not save. Try again.');
    }
  };

  return (
    <Section title="Technicians" desc="What each person can be given: project tasks, work orders or both." testId="technicians">
      {error ? (
        <span className="gs-sub">{error}</span>
      ) : !rows ? (
        <span className="gs-sub">Loading people</span>
      ) : (
        <Table cols={[{ label: 'Person' }, { label: 'Team' }, { label: 'Work type' }, { label: 'Open work', align: 'num' }]} minWidth={680} empty={rows.length === 0 ? 'No one here yet.' : undefined}>
          {rows.map((t) => (
            <tr key={t.employeeId} data-testid="technician-row" data-employee={t.employeeId}>
              <td>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="gs-face soft">{initialsOf(t.name)}</span>
                  <span className="gs-cell">
                    <Link to={paths.employee(t.employeeId)} style={{ fontWeight: 600, color: 'var(--gs-ink)' }}>
                      {t.name}
                    </Link>
                    {t.jobTitle && <span className="gs-sub">{t.jobTitle}</span>}
                  </span>
                </span>
              </td>
              <td className="gs-sub" style={{ fontSize: 13.5 }}>
                {t.team ?? 'No unit'}
              </td>
              <td>
                <Dropdown label={`Work type of ${t.name}`} testId="work-type" value={t.workType} options={WORK_TYPES} width={250} onChange={(v) => void change(t, v)} />
              </td>
              <td className="num" style={{ color: t.openTasks || t.openWorkOrders ? 'var(--gs-ink)' : 'var(--gs-muted)' }} data-testid="open-work">
                {[t.openTasks ? `${t.openTasks} ${t.openTasks === 1 ? 'task' : 'tasks'}` : '', t.openWorkOrders ? `${t.openWorkOrders} ${t.openWorkOrders === 1 ? 'work order' : 'work orders'}` : ''].filter(Boolean).join(', ') || 'Nothing open'}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
