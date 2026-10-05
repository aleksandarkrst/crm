import { useCallback, useEffect, useState } from 'react';
import { ApiError, type ApiDirectoryEmployee, type ApiPermissionMatrix, type ApiRoleHolders, type AssignedRole, rolesApi } from '../lib/api';
import { useStore } from './store';

/**
 * Functional roles and permissions (CD-142). The matrix comes from the server's one definition
 * (GET /people/permissions), so Settings → Roles & permissions can't drift from what the API
 * enforces; it never changes while the app runs, so it is read once. "Who has which role" is read
 * when shown and again after any employee or role change (`s.peopleRev`, raised by live hints).
 */
let matrixLoad: Promise<ApiPermissionMatrix> | null = null;
const loadMatrix = () => {
  matrixLoad ??= rolesApi.permissions().catch((err: unknown) => {
    matrixLoad = null;
    throw err;
  });
  return matrixLoad;
};

export const ASSIGNED_ROLE_LABELS: Record<AssignedRole, string> = { administration: 'Administration', payroll: 'Payroll' };

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export function usePermissionMatrix(): { matrix: ApiPermissionMatrix | null; error: string | null } {
  const [state, setState] = useState<{ matrix: ApiPermissionMatrix | null; error: string | null }>({ matrix: null, error: null });
  useEffect(() => {
    let alive = true;
    loadMatrix().then(
      (matrix) => alive && setState({ matrix, error: null }),
      (err: unknown) => alive && setState({ matrix: null, error: message(err, "Couldn't load the permissions.") }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** Who has Administration, Payroll, Admin and Manager; current after every employee or role change. */
export function useRoleHolders(): { holders: ApiRoleHolders | null; error: string | null } {
  const { s } = useStore();
  const rev = s.peopleRev;
  const [state, setState] = useState<{ holders: ApiRoleHolders | null; error: string | null }>({ holders: null, error: null });
  useEffect(() => {
    let alive = true;
    rolesApi.holders().then(
      (holders) => alive && setState({ holders, error: null }),
      (err: unknown) => alive && setState((x) => ({ holders: x.holders, error: message(err, "Couldn't load who has which role.") })),
    );
    return () => {
      alive = false;
    };
  }, [rev]);
  return state;
}

/** Active employees, for "Add person" (read when the picker opens). */
export function useDirectory(load: boolean): ApiDirectoryEmployee[] | null {
  const [rows, setRows] = useState<ApiDirectoryEmployee[] | null>(null);
  useEffect(() => {
    if (!load) return;
    let alive = true;
    rolesApi.employees().then(
      (list) => alive && setRows(list.filter((e) => e.status !== 'inactive')),
      () => alive && setRows([]),
    );
    return () => {
      alive = false;
    };
  }, [load]);
  return rows;
}

/**
 * Gives or takes Administration or Payroll (Admins only; the API refuses others). The lists and
 * the card update from the live hint the change sends; on failure the API's message is flashed.
 * Resolves to whether it was saved.
 */
export function useSetEmployeeRole() {
  const { flash } = useStore();
  return useCallback(
    async (employeeId: string, role: AssignedRole, on: boolean, name?: string): Promise<boolean> => {
      try {
        if (on) await rolesApi.grant(employeeId, role);
        else await rolesApi.remove(employeeId, role);
        if (name) flash(on ? `${name} now has the ${ASSIGNED_ROLE_LABELS[role]} role` : `${name} no longer has the ${ASSIGNED_ROLE_LABELS[role]} role`);
        return true;
      } catch (err) {
        flash(message(err, `Couldn't change the ${ASSIGNED_ROLE_LABELS[role]} role.`));
        return false;
      }
    },
    [flash],
  );
}
