import type { ReactNode } from 'react';
import type { ApiEmployee, ApiOrgUnit, ApiPeopleAccess } from '../../lib/api';
import { ACCOUNT_LABEL, EMPLOYMENT_TYPE_LABEL, isAdminOf, isHrOf, isManagerOf, ROLE_LABEL, type SortKey, STATUS_LABEL, unitPathLabel } from '../../store/people';
import { IssueIcons } from './parts';

export interface Column {
  key: SortKey | 'roles';
  label: string;
  /** CSS grid track. */
  width: string;
  sortable: boolean;
  cell: (e: ApiEmployee) => ReactNode;
  /** The CSV value (the export takes the visible columns). */
  text: (e: ApiEmployee) => string | null;
}

const dash = (v: string | null | undefined) => v || '';
/** "1 Mar 2024" */
export const shortDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const muted = (v: ReactNode) => <span className="org-cell-muted">{v}</span>;

/**
 * The list's columns (spec 5.4) for this caller. The directory columns for everyone (the unit with
 * its path as a tooltip, CD-226); Start date and
 * Employment type for managers and Admins; Status, Account and Roles for Admins. A row the caller may not see a value of (the API left it out) shows
 * it empty.
 */
export function listColumns(access: ApiPeopleAccess | null, units: readonly ApiOrgUnit[] = []): Column[] {
  const hr = isHrOf(access);
  const cols: Column[] = [
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(180px, 1.4fr)',
      sortable: true,
      cell: (e) => (
        <span className="org-cell-name">
          <span className="org-cell-ellipsis">{e.fullName}</span>
          {hr && <IssueIcons e={e} />}
        </span>
      ),
      text: (e) => e.fullName,
    },
    { key: 'jobTitle', label: 'Job title', width: 'minmax(130px, 1fr)', sortable: true, cell: (e) => muted(dash(e.jobTitle)), text: (e) => e.jobTitle },
    {
      key: 'unit',
      label: 'Unit',
      width: 'minmax(130px, 1fr)',
      sortable: true,
      cell: (e) => <span title={unitPathLabel(units, e.unitId, e.unitName) || undefined}>{dash(e.unitName)}</span>,
      text: (e) => e.unitName,
    },
    { key: 'manager', label: 'Reports to', width: 'minmax(130px, 1fr)', sortable: true, cell: (e) => muted(dash(e.managerName)), text: (e) => e.managerName },
    { key: 'workEmail', label: 'Work email', width: 'minmax(170px, 1.2fr)', sortable: true, cell: (e) => muted(dash(e.workEmail)), text: (e) => e.workEmail },
    { key: 'workPhone', label: 'Work phone', width: 'minmax(110px, 0.8fr)', sortable: true, cell: (e) => muted(dash(e.workPhone)), text: (e) => e.workPhone },
  ];
  if (hr || isManagerOf(access)) {
    cols.push(
      { key: 'startDate', label: 'Start date', width: '110px', sortable: true, cell: (e) => muted(shortDate(e.employment?.startDate)), text: (e) => e.employment?.startDate ?? null },
      {
        key: 'type',
        label: 'Employment type',
        width: '130px',
        sortable: true,
        cell: (e) => muted(e.employment ? (EMPLOYMENT_TYPE_LABEL[e.employment.type] ?? e.employment.type) : ''),
        text: (e) => (e.employment ? (EMPLOYMENT_TYPE_LABEL[e.employment.type] ?? e.employment.type) : null),
      },
    );
  }
  if (hr) {
    cols.push(
      {
        key: 'status',
        label: 'Status',
        width: '96px',
        sortable: true,
        cell: (e) => <span className={'badge ' + (e.status === 'active' ? 'badge-brand' : e.status === 'leaving' ? 'badge-warn' : 'badge-neutral')}>{STATUS_LABEL[e.status]}</span>,
        text: (e) => STATUS_LABEL[e.status],
      },
      { key: 'account', label: 'Account', width: '110px', sortable: true, cell: (e) => muted(e.hr ? ACCOUNT_LABEL[e.hr.account] : ''), text: (e) => (e.hr ? ACCOUNT_LABEL[e.hr.account] : null) },
    );
  }
  if (isAdminOf(access)) {
    const roles = (e: ApiEmployee) => (e.roles ?? []).filter((r) => r !== 'employee').map((r) => ROLE_LABEL[r] ?? r);
    cols.push({
      key: 'roles',
      label: 'Roles',
      width: 'minmax(140px, 1fr)',
      sortable: false,
      cell: (e) => (
        <span className="org-roles">
          {roles(e).map((r) => (
            <span key={r} className="badge badge-neutral">
              {r}
            </span>
          ))}
        </span>
      ),
      text: (e) => roles(e).join(', ') || null,
    });
  }
  return cols;
}
