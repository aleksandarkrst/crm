import { type CallerAccess, relationsFor } from '../../people';

/**
 * Whose visit plans the caller sees and manages (spec 9.3, CD-142), from the permission matrix
 * rows "crm.visit_plans.own", ".see" and ".manage" and the caller's org scope (PeopleAccess):
 * - Admins (workspace owners and admins): every plan, and they create, change and delete any.
 * - Managers: their own plans and their reports' at any depth (list, report rows, Overview
 *   summary); they create, change and delete only their DIRECT reports' plans, not their own.
 * - Everyone else (Administration and Payroll included): their own plans, read-only.
 * Plans are keyed by member (user id), so reports without an account have none.
 */
export class VisitScope {
  /** Sees every plan. */
  readonly all: boolean;
  /** Changes every plan. */
  readonly manageAll: boolean;
  /** Members whose plans the caller sees (when not `all`). */
  readonly visible: ReadonlySet<string>;
  /** Members whose plans the caller creates, changes and deletes (when not `manageAll`). */
  readonly manageable: ReadonlySet<string>;
  /** Sees others' plans (Admin, Manager): Reports and the team summary are for them. */
  readonly seesTeam: boolean;

  constructor(access: CallerAccess) {
    const roles = access.roles;
    const see = new Set([...relationsFor('crm.visit_plans.own', roles), ...relationsFor('crm.visit_plans.see', roles)]);
    const manage = relationsFor('crm.visit_plans.manage', roles);
    this.all = see.has('other');
    this.manageAll = manage.has('other');
    this.seesTeam = this.all || see.has('direct') || see.has('indirect');
    const direct = [...access.directReportUserIds];
    const deeper = [...access.reportUserIds].filter((u) => !access.directReportUserIds.has(u));
    const members = (reach: Set<string>) =>
      new Set([...(reach.has('self') ? [access.userId] : []), ...(reach.has('direct') ? direct : []), ...(reach.has('indirect') ? deeper : [])]);
    this.visible = members(see);
    this.manageable = members(manage);
  }

  canSee(userId: string): boolean {
    return this.all || this.visible.has(userId);
  }
  canManage(userId: string): boolean {
    return this.manageAll || this.manageable.has(userId);
  }
  /** Creates plans for someone: "New plan" shows. */
  get canCreate(): boolean {
    return this.manageAll || this.manageable.size > 0;
  }
  /** The user ids to filter by, or undefined for everyone. */
  get filter(): string[] | undefined {
    return this.all ? undefined : [...this.visible];
  }

  /** For the API (the store gates "New plan", the salesperson picker and editing on it). */
  toJSON() {
    return {
      all: this.all,
      manageAll: this.manageAll,
      seesTeam: this.seesTeam,
      visibleUserIds: this.all ? null : [...this.visible],
      manageableUserIds: this.manageAll ? null : [...this.manageable],
    };
  }
}
