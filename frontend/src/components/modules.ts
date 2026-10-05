import { paths } from '../lib/paths';
import type { IconName } from './icons';

/** Why a module can't be picked: not built yet, not for your role, or (later, with plans) not in your plan. */
export type LockReason = 'soon' | 'role' | 'plan';
export const LOCK_LABEL: Record<LockReason, string> = { soon: 'Coming soon', role: 'Owners and admins', plan: 'Not in your plan' };

export interface ModuleDef {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  /** Where picking it goes; none while the module isn't built. */
  to?: string;
  /** The screens that belong to it (path prefixes): the switcher marks it as the current module there. */
  screens: string[];
  /** Owners and admins only. */
  managers?: boolean;
}

/**
 * The modules in the switcher (CD-214), in grid order. Workforce goes to the Org structure page
 * (milestone 13): give it `to: '/org'` once that route is in App.tsx; until then it shows as
 * "Coming soon".
 */
export const MODULES: ModuleDef[] = [
  { id: 'overview', name: 'Overview', description: 'Numbers across modules', icon: 'overview', to: paths.overview, screens: ['/overview'] },
  {
    id: 'crm',
    name: 'CRM',
    description: 'Pipeline, deals, contacts',
    icon: 'crm',
    to: paths.pipeline,
    screens: ['/pipeline', '/today', '/calendar', '/meetings', '/visit-plans', '/companies', '/contacts', '/products', '/deals'],
  },
  { id: 'planning', name: 'Planning', description: 'Budgets and targets', icon: 'planning', screens: [] },
  { id: 'projects', name: 'Projects', description: 'Tasks and deadlines', icon: 'projects', screens: [] },
  { id: 'workforce', name: 'Workforce', description: 'People and capacity', icon: 'workforce', screens: ['/org'] },
  { id: 'reporting', name: 'Reporting', description: 'Reports and exports', icon: 'reports', to: paths.reports(), screens: ['/reports'], managers: true },
];

/** Why this person can't open the module, or null when they can. */
export function lockReason(m: ModuleDef, role: string): LockReason | null {
  if (!m.to) return 'soon';
  if (m.managers && role !== 'owner' && role !== 'admin') return 'role';
  return null;
}

/** The module the screen at `pathname` belongs to (none for settings and the profile). */
export function currentModule(pathname: string): ModuleDef | undefined {
  return MODULES.find((m) => m.screens.some((s) => pathname === s || pathname.startsWith(s + '/')));
}
