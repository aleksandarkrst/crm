import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, peopleCardApi, WORK_TYPE_LABEL, type WorkType } from '../../lib/api';
import { paths } from '../../lib/paths';
import { projectError } from '../../store/projects';
import { useStore } from '../../store/store';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="technicians">
      <div className="hint-box">
        Work type decides what someone can be given. Office staff get project tasks, service staff get work orders, and people set to both can get either. It&apos;s the same field as on the person&apos;s Workforce profile.
      </div>
      {error ? (
        <div className="hint-box">{error}</div>
      ) : !rows ? (
        <div className="hint-box">Loading people</div>
      ) : (
        <div className="pipeline-table">
          <div className="techs-table-inner">
            <div className="table-head caps">
              <span>Person</span>
              <span>Team</span>
              <span>Work type · can be given</span>
              <span>Open work</span>
            </div>
            {rows.length === 0 && <div className="pipeline-table-empty">No one here yet.</div>}
            {rows.map((t) => (
              <div key={t.employeeId} className="table-row" data-testid="technician-row" data-employee={t.employeeId}>
                <span className="pt-cell">
                  <Link to={paths.employee(t.employeeId)} className="pt-main" style={{ fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }}>
                    {t.name}
                  </Link>
                  <span className="pt-sub">{t.jobTitle ?? ''}</span>
                </span>
                <span className="pt-main" style={{ color: 'var(--text-2)' }}>
                  {t.team ?? 'No unit'}
                </span>
                <span>
                  <select className="ghost ghost-sm" aria-label={`Work type of ${t.name}`} data-testid="work-type" value={t.workType} onChange={(e) => void change(t, e.target.value as WorkType)}>
                    {(Object.keys(WORK_TYPE_LABEL) as WorkType[]).map((w) => (
                      <option key={w} value={w}>
                        {WORK_TYPE_LABEL[w]}
                        {w === 'office' ? ' · project tasks' : w === 'service' ? ' · work orders' : ' · tasks and work orders'}
                      </option>
                    ))}
                  </select>
                </span>
                <span style={{ color: t.openTasks || t.openWorkOrders ? 'var(--ink)' : 'var(--muted)' }} data-testid="open-work">
                  {[t.openTasks ? `${t.openTasks} ${t.openTasks === 1 ? 'task' : 'tasks'}` : '', t.openWorkOrders ? `${t.openWorkOrders} ${t.openWorkOrders === 1 ? 'work order' : 'work orders'}` : ''].filter(Boolean).join(' · ') || 'None'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
