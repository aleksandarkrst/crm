import type { AssignedRole, MembershipRole } from '../../shared/database/schema';
import type { PermissionRelation } from './permissions';

/**
 * The five functional roles (spec 9.1). Roles are additive. Employee: has an employee record.
 * Manager: has at least one active direct report (derived). Administration, Payroll: assigned by
 * an Admin (employee_roles). Admin: workspace owner or admin (derived from the membership).
 */
export const FUNCTIONAL_ROLES = ['employee', 'manager', 'administration', 'payroll', 'admin'] as const;
export type FunctionalRole = (typeof FUNCTIONAL_ROLES)[number];

export interface AccessData {
  tenantId: string;
  userId: string;
  workspaceRole: MembershipRole;
  /** The caller's own employee record (null only for a member without one, which linking prevents). */
  employeeId: string | null;
  assignedRoles: readonly AssignedRole[];
  /** Active employees whose manager is the caller. */
  directReportIds: readonly string[];
  /** Active employees below the caller at any depth (direct reports included). */
  reportIds: readonly string[];
  /** The member accounts (user ids) of the direct reports that have one: CRM data is keyed by user. */
  directReportUserIds?: readonly string[];
  /** The member accounts of all reports that have one (direct ones included). */
  reportUserIds?: readonly string[];
}

/**
 * What the caller may see and do with people data (spec 9.3, 9.5): one object per request, built
 * by PeopleAccess.of(ctx) from one recursive query. Pure, so the rules are unit-tested
 * (test/people-access.spec.ts). Later Workforce modules use the same object: `canSeeEmployment`
 * is the "Own / Indirect / All" pattern of the matrix, `isDirectReport` the "Direct" one.
 */
export class CallerAccess {
  readonly tenantId: string;
  readonly userId: string;
  readonly employeeId: string | null;
  readonly roles: ReadonlySet<FunctionalRole>;
  readonly directReportIds: ReadonlySet<string>;
  readonly reportIds: ReadonlySet<string>;
  /** User ids of the direct reports with an account (visit plans and other CRM data are per member). */
  readonly directReportUserIds: ReadonlySet<string>;
  /** User ids of all reports with an account, direct ones included. */
  readonly reportUserIds: ReadonlySet<string>;

  constructor(data: AccessData) {
    this.tenantId = data.tenantId;
    this.userId = data.userId;
    this.employeeId = data.employeeId;
    this.directReportIds = new Set(data.directReportIds);
    this.reportIds = new Set([...data.reportIds, ...data.directReportIds]);
    this.directReportUserIds = new Set(data.directReportUserIds ?? []);
    this.reportUserIds = new Set([...(data.reportUserIds ?? []), ...this.directReportUserIds]);
    const roles = new Set<FunctionalRole>();
    if (data.employeeId) {
      roles.add('employee');
      if (this.directReportIds.size > 0) roles.add('manager');
      for (const r of data.assignedRoles) roles.add(r);
    }
    if (data.workspaceRole === 'owner' || data.workspaceRole === 'admin') roles.add('admin');
    this.roles = roles;
  }

  /** Who a person is to the caller, for the permission matrix (permissions.ts). */
  relationTo(employeeId: string): PermissionRelation {
    if (this.isSelf(employeeId)) return 'self';
    if (this.isDirectReport(employeeId)) return 'direct';
    return this.isReport(employeeId) ? 'indirect' : 'other';
  }
  /** The same for a member, by user id (CRM data such as visit plans is keyed by member). */
  relationToUser(userId: string): PermissionRelation {
    if (userId === this.userId) return 'self';
    if (this.directReportUserIds.has(userId)) return 'direct';
    return this.reportUserIds.has(userId) ? 'indirect' : 'other';
  }

  /** Workspace owner or admin: everything, including invitations, linking, roles and deleting. */
  get isAdmin(): boolean {
    return this.roles.has('admin');
  }
  get isAdministration(): boolean {
    return this.roles.has('administration');
  }
  get isPayroll(): boolean {
    return this.roles.has('payroll');
  }
  get isManager(): boolean {
    return this.roles.has('manager');
  }
  /** Administration or Admin: sees all HR data, manages employees, departments, teams and imports. */
  get isHr(): boolean {
    return this.isAdmin || this.isAdministration;
  }

  isSelf(employeeId: string): boolean {
    return this.employeeId === employeeId;
  }
  isDirectReport(employeeId: string): boolean {
    return this.directReportIds.has(employeeId);
  }
  /** A report at any depth ("Indirect" in the matrix). */
  isReport(employeeId: string): boolean {
    return this.reportIds.has(employeeId);
  }

  /** Start and end date, employment type, weekly hours, employee number: self, managers above, HR. */
  canSeeEmployment(employeeId: string): boolean {
    return this.isHr || this.isSelf(employeeId) || this.isReport(employeeId);
  }
  /** Personal details: self, Administration, Admin. Never managers or Payroll (Q2, Q6). */
  canSeePersonal(employeeId: string): boolean {
    return this.isHr || this.isSelf(employeeId);
  }
  /** Bank account (masked) and revealing it: self, Administration, Admin. */
  canSeeBank(employeeId: string): boolean {
    return this.isHr || this.isSelf(employeeId);
  }
  /** Employee history: self (without the reason for leaving), Administration, Admin. */
  canSeeHistory(employeeId: string): boolean {
    return this.isHr || this.isSelf(employeeId);
  }
  /** The reason for leaving: Administration and Admin only, never the employee. */
  get canSeeLeavingReason(): boolean {
    return this.isHr;
  }
  /** Inactive employees in lists and on cards: Administration and Admin. */
  get canSeeInactive(): boolean {
    return this.isHr;
  }

  /** For the API: `GET /api/people/access`. */
  toJSON() {
    return {
      employeeId: this.employeeId,
      roles: FUNCTIONAL_ROLES.filter((r) => this.roles.has(r)),
      directReportIds: [...this.directReportIds],
      reportIds: [...this.reportIds],
      directReportUserIds: [...this.directReportUserIds],
      reportUserIds: [...this.reportUserIds],
    };
  }
}
