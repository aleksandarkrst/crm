import { paths } from '../lib/paths';
import type { IconName } from './icons';

/** Why a module can't be picked: not built yet, not for your role, or (later, with plans) not in your plan. */
export type LockReason = 'soon' | 'role' | 'plan';
export const LOCK_LABEL: Record<LockReason, string> = { soon: 'Coming soon', role: 'Owners and admins', plan: 'Not in your plan' };

/** One page in a module's sidebar (CD-223). */
export interface NavDef {
  to: string;
  label: string;
  /** A 24×24 stroke path. */
  icon: string;
  /** In the bottom bar on phones; the others are under "More" there (CD-70). */
  phone?: boolean;
  /** Owners, admins and managers (people who see their team) only: Reports (CD-135, CD-142). */
  managers?: boolean;
}

export interface ModuleDef {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  /** Where picking it goes; none while the module isn't built. */
  to?: string;
  /** The screens that belong to it (path prefixes): it is the current module there. */
  screens: string[];
  /** Its own sidebar: each module is its own app (CD-223). */
  nav: NavDef[];
  /** Owners and admins only. */
  managers?: boolean;
}

/** The CRM's pages, in sidebar order. */
const CRM_NAV: NavDef[] = [
  { to: paths.overview, label: 'Overview', icon: 'M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6' },
  { to: paths.pipeline, label: 'Pipeline', icon: 'M4 5h5v14H4zM15 5h5v9h-5z', phone: true },
  { to: paths.today, label: 'Today', icon: 'M5 5h14v14H5zM9 12l2 2 4-4', phone: true },
  // Salespeople use it every day, so it's in the phone bar (CD-223).
  { to: paths.calendar(), label: 'Calendar', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', phone: true },
  { to: paths.visitPlans, label: 'Visit plans', icon: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' },
  { to: paths.companies, label: 'Companies', icon: 'M4 20V6.5L11 4v16M11 20h9V10h-9M14.5 13h2M14.5 16.5h2M7 8.5h1M7 12h1M7 15.5h1', phone: true },
  { to: paths.contacts, label: 'Contacts', icon: 'M12 11a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6ZM5 20c1.2-3.1 4-4.7 7-4.7s5.8 1.6 7 4.7' },
  { to: paths.products, label: 'Products', icon: 'M20 8.5 12 4 4 8.5v7L12 20l8-4.5v-7ZM4 8.5 12 13m0 0 8-4.5M12 13v7' },
  { to: paths.reports(), label: 'Reports', icon: 'M5 20V10M10 20V4M15 20v-7M20 20v-4M3 20h18', managers: true },
];

/** Projects' pages (CD-234): the board and list for now; Tasks, Work orders and Dispatch come with CD-229. */
const PROJECTS_NAV: NavDef[] = [{ to: paths.projects, label: 'Projects', icon: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v7h-4z', phone: true }];

/** Workforce's pages: Org structure for now; Timesheets, Time off, Approvals and Utilisation come later. */
const WORKFORCE_NAV: NavDef[] = [{ to: paths.org(), label: 'Org structure', icon: 'M9.5 3.5h5v4h-5zM3.5 16.5h5v4h-5zM15.5 16.5h5v4h-5zM12 7.5v4.5M6 16.5v-2.5h12v2.5', phone: true }];

/**
 * The modules in the switcher (CD-214, CD-223), in grid order. Each is its own app with its own
 * sidebar. Workforce goes to the Org structure page (milestone 13, CD-137); its employee cards
 * (/people/…) belong to it too. Settings and the profile belong to none: they keep the last one.
 */
export const MODULES: ModuleDef[] = [
  { id: 'planning', name: 'Planning', description: 'Budgets and targets', icon: 'planning', screens: [], nav: [] },
  {
    id: 'crm',
    name: 'CRM',
    description: 'Pipeline, deals, contacts',
    icon: 'crm',
    to: paths.pipeline,
    screens: ['/overview', '/pipeline', '/today', '/calendar', '/meetings', '/visit-plans', '/companies', '/contacts', '/products', '/deals', '/reports'],
    nav: CRM_NAV,
  },
  { id: 'projects', name: 'Projects', description: 'Tasks and deadlines', icon: 'projects', to: paths.projects, screens: ['/projects'], nav: PROJECTS_NAV },
  { id: 'workforce', name: 'Workforce', description: 'People and capacity', icon: 'workforce', to: paths.org(), screens: ['/org', '/people'], nav: WORKFORCE_NAV },
];

/** Where you land with nothing else to go by: the CRM. */
export const DEFAULT_MODULE = MODULES.find((m) => m.id === 'crm')!;

/** Why this person can't open the module, or null when they can. */
export function lockReason(m: ModuleDef, role: string): LockReason | null {
  if (!m.to) return 'soon';
  if (m.managers && role !== 'owner' && role !== 'admin') return 'role';
  return null;
}

/** The module the screen at `pathname` belongs to (none for settings and the profile). */
export function routeModule(pathname: string): ModuleDef | undefined {
  return MODULES.find((m) => m.screens.some((s) => pathname === s || pathname.startsWith(s + '/')));
}

/** The sidebar items this person sees in a module: Reports only for owners, admins and managers (CD-142). */
export function navFor(m: ModuleDef, role: string, seesTeam = false): NavDef[] {
  return m.nav.filter((n) => !n.managers || seesTeam || role === 'owner' || role === 'admin');
}

const lastKey = (userId: string) => `crm.module.${userId}`;

/** The last module this person was in, in this browser (so Settings keeps its sidebar). */
export function lastModule(userId: string): ModuleDef | undefined {
  try {
    const id = localStorage.getItem(lastKey(userId));
    return MODULES.find((m) => m.id === id && m.to);
  } catch {
    return undefined;
  }
}

export function rememberModule(userId: string, m: ModuleDef) {
  try {
    localStorage.setItem(lastKey(userId), m.id);
  } catch {
    // No storage (private mode, blocked): Settings then shows the CRM.
  }
}

/** The module you're in: the screen's own, or on Settings and the profile the last one (else the CRM). */
export function currentModule(pathname: string, userId: string): ModuleDef {
  return routeModule(pathname) ?? lastModule(userId) ?? DEFAULT_MODULE;
}
