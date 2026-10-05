/**
 * The employee card (CD-140, milestone 13): the store's slice for `/people/:id`. Cards are read when
 * the page opens and kept by id in `s.employeeCards`; every action (saving a section, inviting,
 * linking, deactivating) returns the card as the server now has it, which replaces the cached one.
 * The pickers (active employees, departments, teams) are read once a card needs them
 * (`s.peoplePickers`).
 *
 * Saving sends only the section's fields with the card's version (If-Match): when someone else
 * changed one of them meanwhile, the API answers 409, the card is read again and the section shows
 * the conflict message. Fields the caller may not change are never sent: the card's
 * `permissions.editableFields` (the server's own rules) decides what each section offers.
 *
 * Live updates (CD-20): an `employee` hint names employee ids; open cards among them (or all, for a
 * hint without ids) are read again, and the pickers too when they are loaded.
 */
import {
  type ApiDepartment,
  type ApiEmployeeCard,
  type ApiEmployeeRow,
  ApiError,
  type ApiLinkCandidate,
  type ApiPeopleHistoryEntry,
  type ApiTeam,
  crmApi,
  type DeactivateInput,
  type EmployeePatch,
  type EmploymentType,
  type FunctionalRole,
  type LeavingReason,
  peopleCardApi,
} from '../lib/api';
import type { LiveEvent } from './live';
import type { State } from './types';

export interface PeoplePickers {
  /** Active (and leaving) employees, by last name. */
  employees: ApiEmployeeRow[];
  departments: ApiDepartment[];
  teams: ApiTeam[];
}

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = { permanent: 'Permanent', fixed_term: 'Fixed term', contractor: 'Contractor', student: 'Student or intern' };
export const LEAVING_REASON_LABEL: Record<LeavingReason, string> = { resigned: 'Resigned', contract_ended: 'Contract ended', dismissed: 'Dismissed', retired: 'Retired', other: 'Other' };
export const ROLE_LABEL: Record<FunctionalRole, string> = { employee: 'Employee', manager: 'Manager', administration: 'Administration', payroll: 'Payroll', admin: 'Admin' };
/** Why Manager and Admin can't be toggled (spec 9.1). */
export const DERIVED_ROLE_HINT: Partial<Record<FunctionalRole, string>> = {
  manager: 'Has at least one active direct report (from reporting lines)',
  admin: 'Workspace owner or admin (Settings → Team)',
};

/** What a save, invite or other card action answers. */
export type CardResult = { card: ApiEmployeeCard } | { error: string; conflict?: boolean };
/** "Invite to Pultly": the link to copy, or the offer to link the existing account instead. */
export type InviteResult = { link: string; card: ApiEmployeeCard } | { linkInstead: { userId: string; memberName: string; message: string } } | { error: string };

interface Deps {
  cur: () => State;
  set: (u: Partial<State> | ((s: State) => Partial<State>)) => void;
  flash: (msg: string, ms?: number) => void;
  errText: (err: unknown) => string;
  conflictText: (err: unknown) => string | null;
  /** Settings → Team shows invitations and links; read it again after the card changed them. */
  refreshTeam: () => Promise<void>;
}

const inviteLink = (token: string) => `${window.location.origin}/invite/${token}`;

export function employeeCardActions({ cur, set, flash, errText, conflictText, refreshTeam }: Deps) {
  const put = (card: ApiEmployeeCard) => set((x) => ({ employeeCards: { ...x.employeeCards, [card.id]: card } }));
  const drop = (id: string) =>
    set((x) => {
      const employeeCards = { ...x.employeeCards };
      delete employeeCards[id];
      return { employeeCards };
    });

  /** Reads a card; null when there is no such employee (or the caller may not see it). */
  const load = async (id: string): Promise<ApiEmployeeCard | null> => {
    try {
      const card = await peopleCardApi.card(id);
      put(card);
      return card;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
        drop(id);
        return null;
      }
      throw err;
    }
  };

  /** Runs a card action; the answer replaces the cached card. */
  const act = async (id: string, run: () => Promise<ApiEmployeeCard>, what: string): Promise<CardResult> => {
    try {
      const card = await run();
      put(card);
      return { card };
    } catch (err) {
      const conflict = conflictText(err);
      if (conflict) {
        await load(id).catch(() => null);
        return { error: conflict, conflict: true };
      }
      return { error: `${what}: ${errText(err)}` };
    }
  };

  let pickersLoading: Promise<void> | null = null;
  const loadPickers = () => {
    pickersLoading ??= Promise.all([peopleCardApi.directory(), peopleCardApi.departments(), peopleCardApi.teams()])
      .then(([directory, departments, teams]) => set({ peoplePickers: { employees: directory.employees, departments, teams } }))
      .catch(() => undefined)
      .finally(() => (pickersLoading = null));
    return pickersLoading;
  };

  return {
    load,
    /** Loads the pickers once (the card's Work and Reporting editors, the deactivate dialog). */
    ensurePickers: () => (cur().peoplePickers ? Promise.resolve() : loadPickers()),

    /**
     * Saves one section's changes (only the fields that changed). A pending invitation went to the
     * old work email: the server withdrew it, and the toast says to invite again.
     */
    save: async (id: string, patch: EmployeePatch): Promise<CardResult> => {
      const before = cur().employeeCards[id];
      if (!Object.keys(patch).length) return before ? { card: before } : { error: 'Nothing to save' };
      const result = await act(id, () => peopleCardApi.update(id, patch, before?.version), 'Not saved');
      if ('card' in result) {
        if (before?.account === 'invited' && result.card.account === 'none') flash('The invitation was withdrawn because the work email changed. Invite them again.', 7000);
        if ('managerId' in patch || 'departmentId' in patch || 'teamId' in patch) void loadPickers();
      }
      return result;
    },

    /** The full IBAN ("Show" and "Copy"); the server writes "IBAN viewed" to the audit log each time. */
    reveal: async (id: string, account: 'iban' | 'fxIban') => {
      try {
        return await peopleCardApi.reveal(id, account);
      } catch (err) {
        flash('Bank account not shown: ' + errText(err), 6000);
        return null;
      }
    },

    history: (id: string, offset = 0): Promise<{ entries: ApiPeopleHistoryEntry[]; more: boolean }> => peopleCardApi.history(id, offset),
    approvers: (id: string, date?: string) => peopleCardApi.approvers(id, date),

    /** "Invite to Pultly" (spec 4.7). */
    invite: async (id: string, role: 'admin' | 'member'): Promise<InviteResult> => {
      try {
        const { token, card } = await peopleCardApi.invite(id, role);
        put(card);
        void refreshTeam();
        return { link: inviteLink(token), card };
      } catch (err) {
        const body = err instanceof ApiError ? (err.body as { code?: string; userId?: string; memberName?: string; message?: string } | null) : null;
        if (body?.code === 'link_instead' && body.userId) return { linkInstead: { userId: body.userId, memberName: body.memberName ?? 'Member', message: body.message ?? '' } };
        return { error: errText(err) };
      }
    },

    /** "Invite selected" (Org structure list): `{ queued, skipped }`, or null when refused. */
    bulkInvite: async (employeeIds: string[], role: 'admin' | 'member' = 'member') => {
      try {
        const result = await peopleCardApi.bulkInvite(employeeIds, role);
        flash(`${result.queued} ${result.queued === 1 ? 'invitation' : 'invitations'} on the way` + (result.skipped ? ` · ${result.skipped} skipped (no work email, or already has an account or an invitation)` : ''), 7000);
        return result;
      } catch (err) {
        flash('Not invited: ' + errText(err), 7000);
        return null;
      }
    },

    resendInvitation: async (employeeId: string, invitationId: string) => {
      try {
        const row = await crmApi.resendInvitation(invitationId);
        flash('Sending the invitation to ' + row.email + ' again');
        await load(employeeId);
      } catch (err) {
        flash('Not resent: ' + errText(err), 7000);
      }
    },
    copyInvitationLink: async (invitationId: string) => {
      try {
        const { token } = await crmApi.invitationLink(invitationId);
        const link = inviteLink(token);
        await navigator.clipboard.writeText(link).then(
          () => flash('Invite link copied. It works once, for the invited email address.'),
          () => flash('Invite link: ' + link, 12000),
        );
      } catch (err) {
        flash('No link: ' + errText(err), 7000);
      }
    },
    withdrawInvitation: async (employeeId: string, invitationId: string) => {
      try {
        await crmApi.revokeInvitation(invitationId);
        flash('Invitation withdrawn');
        await load(employeeId);
        void refreshTeam();
      } catch (err) {
        flash('Not withdrawn: ' + errText(err), 7000);
      }
    },

    /** "Link to member" (spec 4.6): members and whether their own record can be merged. */
    linkCandidates: async (id: string): Promise<ApiLinkCandidate[] | null> => {
      try {
        return await peopleCardApi.linkCandidates(id);
      } catch (err) {
        flash('Members not loaded: ' + errText(err), 6000);
        return null;
      }
    },
    link: async (id: string, userId: string) => {
      const result = await act(id, () => peopleCardApi.link(id, userId), 'Not linked');
      if ('card' in result) void refreshTeam();
      return result;
    },
    unlink: async (id: string) => {
      const result = await act(id, () => peopleCardApi.unlink(id), 'Not unlinked');
      if ('card' in result) void refreshTeam();
      return result;
    },

    /** Deactivate (spec 4.8): now, or "Leaving on <date>" until the daily job applies it. */
    deactivate: async (id: string, input: DeactivateInput) => {
      const result = await act(id, () => peopleCardApi.deactivate(id, input), 'Not deactivated');
      if ('card' in result) {
        void loadPickers();
        void refreshTeam();
        flash(result.card.status === 'inactive' ? `${result.card.fullName} is deactivated` : `${result.card.fullName} is leaving on ${result.card.employment?.endDate ?? 'the chosen day'}`, 5000);
      }
      return result;
    },
    reactivate: async (id: string, employmentStartDate?: string) => {
      const result = await act(id, () => peopleCardApi.reactivate(id, employmentStartDate), 'Not reactivated');
      if ('card' in result) void loadPickers();
      return result;
    },
    /** Delete (Admin; a record that never had an account). */
    remove: async (id: string): Promise<boolean> => {
      try {
        await peopleCardApi.remove(id);
        drop(id);
        void loadPickers();
        return true;
      } catch (err) {
        flash('Not deleted: ' + errText(err), 7000);
        return false;
      }
    },

    /** Your own employee record, for Profile → "My employee card". */
    loadMyEmployeeId: async () => {
      try {
        const access = await peopleCardApi.access();
        set({ myEmployeeId: access.employeeId });
      } catch {
        set({ myEmployeeId: null });
      }
    },

    /** Live updates: re-read the open cards a hint names (all of them without ids), and the pickers. */
    onLive: (e: LiveEvent) => {
      const cards = cur().employeeCards;
      const ids = e.type === 'employee' && e.ids ? e.ids.filter((id) => cards[id]) : Object.keys(cards);
      for (const id of ids) void load(id).catch(() => undefined);
      if (cur().peoplePickers) void loadPickers();
    },
  };
}

export type EmployeeCardActions = ReturnType<typeof employeeCardActions>;
