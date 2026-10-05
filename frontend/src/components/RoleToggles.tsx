import { useState } from 'react';
import type { AssignedRole, FunctionalRole } from '../lib/api';
import { ASSIGNED_ROLE_LABELS, useSetEmployeeRole } from '../store/roles';
import { useStore } from '../store/store';
import { Switch } from './ui';

const ROLE_LABELS: Record<FunctionalRole, string> = { employee: 'Employee', manager: 'Manager', administration: 'Administration', payroll: 'Payroll', admin: 'Admin' };
const ASSIGNED: AssignedRole[] = ['administration', 'payroll'];

/** A role as text with a quiet badge (never colour alone, spec 10.5). */
export function RoleBadge({ role }: { role: FunctionalRole }) {
  return (
    <span className="role-badge" data-role={role}>
      {ROLE_LABELS[role]}
    </span>
  );
}

/**
 * The Roles section of an employee card (CD-142, spec 9.1): every role the person has as badges,
 * and for Admins a switch each for Administration and Payroll (saved at once; the card and the
 * Roles tab update from the live hint). Admin and Manager are derived and only shown: Admin from
 * the workspace role (Settings → Team), Manager from reporting lines.
 *
 * `roles` is the card's `roles` (all five, as the API derives them). Mount it on the card; it
 * needs nothing else.
 */
export function RoleToggles({ employeeId, name, roles, inactive = false }: { employeeId: string; name: string; roles: readonly FunctionalRole[]; inactive?: boolean }) {
  const { session } = useStore();
  const isAdmin = session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const setRole = useSetEmployeeRole();
  // Optimistic until the card is read again (the live hint).
  const [pending, setPending] = useState<Partial<Record<AssignedRole, boolean>>>({});
  // Fresh roles from the card (after the live hint) replace the optimistic ones.
  const key = roles.join(',');
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setPending({});
  }
  const has = (r: AssignedRole) => pending[r] ?? roles.includes(r);
  const shown = (['employee', 'manager', 'administration', 'payroll', 'admin'] as const).filter((r) => (r === 'administration' || r === 'payroll' ? has(r) : roles.includes(r)));

  const toggle = async (role: AssignedRole) => {
    const on = !has(role);
    setPending((p) => ({ ...p, [role]: on }));
    const saved = await setRole(employeeId, role, on, name);
    if (!saved)
      setPending((p) => {
        const next = { ...p };
        delete next[role];
        return next;
      });
  };

  return (
    <div className="role-toggles" data-testid="role-toggles">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="role-badges">
        {shown.map((r) => (
          <RoleBadge key={r} role={r} />
        ))}
      </div>
      {isAdmin &&
        ASSIGNED.map((r) => (
          <div key={r} className="role-toggle-row" data-role-toggle={r}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{ASSIGNED_ROLE_LABELS[r]}</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {r === 'administration' ? 'Manages employees, departments, teams and reporting lines; sees personal details.' : 'Sees what payroll needs, such as approved hours. Never bank accounts.'}
              </span>
            </span>
            {inactive && !has(r) ? (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Left the company</span>
            ) : (
              <Switch on={has(r)} onClick={() => void toggle(r)} label={`${ASSIGNED_ROLE_LABELS[r]} role`} />
            )}
          </div>
        ))}
      {isAdmin && (
        <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          Admin comes from the workspace role (Settings → Team), Manager from reporting lines. {name.split(' ')[0]} gets an email when a role is given or removed.
        </span>
      )}
    </div>
  );
}
