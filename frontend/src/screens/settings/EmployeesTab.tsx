import { useState } from 'react';
import { FieldRow, Switch } from '../../components/ui';
import { useStore } from '../../store/store';

/**
 * Settings → Employees (CD-215, spec 10.3), Admins only: the weekly hours new employees and
 * imports start with, whether an employee number is required, and whether employees change their
 * own bank account. Saved per workspace as you change them (PATCH /workspace).
 */
export function EmployeesTab() {
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
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>When off, only Administration and Admins change bank accounts. The employee is emailed about every change either way.</span>
        </div>
        <Switch on={w.employeeSelfEditBank} onClick={() => setWorkspace({ employeeSelfEditBank: !w.employeeSelfEditBank })} label="Employees can edit their own bank account" />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 4 }}>Changes are saved as you make them. Who has Administration and Payroll is in Roles & permissions.</span>
    </div>
  );
}
