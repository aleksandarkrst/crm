import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, peopleCardApi, WORK_TYPE_LABEL, type WorkType } from '../../lib/api';
import { paths } from '../../lib/paths';
import { projectError } from '../../store/projects';
import { useStore } from '../../store/store';
import { Block, Table } from './parts';

interface Technician {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  team: string | null;
  workType: WorkType;
  openTasks: number;
  openWorkOrders: number;
}

/**
 * Settings → Technicians (CD-268, design v2 §8): everyone with their team, their work type (what
 * they can be given; inline) and their open work. The same field as on the Workforce employee card.
 * Owners and admins.
 */
export function TechniciansTab() {
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
      flash(`${t.name} is ${WORK_TYPE_LABEL[workType]} now`);
    } catch (err) {
      setRows(before);
      flash(projectError(err));
    }
  };

  return (
    <Block desc="Work type decides what someone can be given. Office staff get project tasks, service staff get work orders, and people set to both can get either. It's the same field as on the person's employee card." testId="technicians">
      {error ? (
        <div className="hint-box">{error}</div>
      ) : !rows ? (
        <div className="hint-box">Loading people</div>
      ) : (
        <Table cols={[{ label: 'Person' }, { label: 'Team' }, { label: 'Work type · can be given' }, { label: 'Open work', align: 'num' }]} minWidth={680} empty={rows.length === 0 ? 'No one here yet.' : undefined}>
          {rows.map((t) => (
            <tr key={t.employeeId} data-testid="technician-row" data-employee={t.employeeId}>
              <td>
                <span className="ws-cell">
                  <Link to={paths.employee(t.employeeId)} style={{ fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }}>
                    {t.name}
                  </Link>
                  {t.jobTitle && <span className="ws-row-hint">{t.jobTitle}</span>}
                </span>
              </td>
              <td style={{ color: 'var(--text-2)' }}>{t.team ?? 'No unit'}</td>
              <td>
                <select className="form-input" style={{ width: 240, padding: '7px 10px' }} aria-label={`Work type of ${t.name}`} data-testid="work-type" value={t.workType} onChange={(e) => void change(t, e.target.value as WorkType)}>
                  {(Object.keys(WORK_TYPE_LABEL) as WorkType[]).map((w) => (
                    <option key={w} value={w}>
                      {WORK_TYPE_LABEL[w]}
                      {w === 'office' ? ' · project tasks' : w === 'service' ? ' · work orders' : ' · tasks and work orders'}
                    </option>
                  ))}
                </select>
              </td>
              <td className="num" style={{ color: t.openTasks || t.openWorkOrders ? 'var(--ink)' : 'var(--muted-2)' }} data-testid="open-work">
                {[t.openTasks ? `${t.openTasks} ${t.openTasks === 1 ? 'task' : 'tasks'}` : '', t.openWorkOrders ? `${t.openWorkOrders} ${t.openWorkOrders === 1 ? 'work order' : 'work orders'}` : ''].filter(Boolean).join(' · ') || 'Nothing open'}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Block>
  );
}
