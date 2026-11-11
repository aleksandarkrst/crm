// Time off's tabs (milestone 16, CD-350, CD-503): which tabs the caller sees and which one a link opens.
// Kept free of React and the API so Node's test runner reads it as is.
import type { ApiPeopleAccess } from '../lib/api';
import type { PeopleState } from './people';

export type TimeOffTab = 'my' | 'approvals' | 'timeline' | 'balances' | 'decisions';

export interface TimeOffViewer {
  /** Workspace owner or admin (the session's role). */
  admin: boolean;
  /** The caller's own access (`GET /people/access`); null until it has been read. */
  access: ApiPeopleAccess | null | undefined;
  /** The workspace's country: vacation decisions (rešenje) exist only in Serbia (CD-167). */
  country: string | null | undefined;
}

/** The tabs past My time off and Timeline: Approvals and Balances for managers and Admins, Decisions for Serbian Admins. */
export function timeOffAccess({ admin, access, country }: TimeOffViewer): { approvals: boolean; decisions: boolean } {
  const manager = !!access?.roles.includes('manager');
  return { approvals: admin || manager, decisions: admin && country === 'RS' };
}

/** The tab `?tab=` opens; a tab the caller can't see opens My time off. Old links (CD-350) still land. */
export function timeOffTab(wanted: string | null, viewer: TimeOffViewer): TimeOffTab {
  const can = timeOffAccess(viewer);
  if (wanted === 'timeline' || wanted === 'calendar') return 'timeline';
  if (can.approvals && (wanted === 'approvals' || wanted === 'requests' || wanted === 'sick')) return 'approvals';
  if (can.approvals && wanted === 'balances') return 'balances';
  if (can.decisions && wanted === 'decisions') return 'decisions';
  return 'my';
}

/**
 * Whether the page should wait before showing a tab: the link asks for a managers' tab, the caller
 * isn't an Admin and their access hasn't been read yet (`myEmployeeId` is undefined until it was,
 * null when it failed). Without the wait, a manager's `?tab=approvals` flashes My time off first.
 */
export function timeOffWaits(wanted: string | null, viewer: TimeOffViewer, myEmployeeId: string | null | undefined): boolean {
  const managersTab = wanted === 'approvals' || wanted === 'requests' || wanted === 'sick' || wanted === 'balances';
  return managersTab && !viewer.admin && !viewer.access && myEmployeeId === undefined;
}

/**
 * The directory state with the caller's own access in it (CD-503). Time off reads the caller's roles
 * before the directory has been, so this leaves `loaded` and the rows alone: People still reads them.
 */
export const withCallerAccess = (people: PeopleState, access: ApiPeopleAccess): PeopleState => ({ ...people, access });
