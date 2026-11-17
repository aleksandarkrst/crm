import type { WorkspaceModule } from '../components/modules';

/**
 * What is wrong with a phone number typed into Profile settings, or '' when it can be saved
 * (CD-525 spec 5): digits, spaces, parentheses and a leading +. Dashes are refused on purpose.
 * Empty clears the phone. The check is on the page only: the API takes any phone, and a phone
 * saved before keeps its value until someone edits it.
 */
export function phoneProblem(value: string): string {
  const v = value.trim();
  if (!v) return '';
  return /^\+?[\d ()]*\d[\d ()]*$/.test(v) ? '' : 'Use digits and spaces, with a + for the country code.';
}

/** An empty name isn't saved (CD-525 spec 5). */
export const nameProblem = (value: string): string => (value.trim() ? '' : 'Enter your name.');

/**
 * The module each notification belongs to (CD-525 spec 2): with that module off in the workspace
 * its switch stays visible but disabled. The daily digest belongs to none.
 */
export const NOTIFICATION_MODULE: Record<string, WorkspaceModule | null> = {
  digest: null,
  assigned: 'crm',
  meetings: 'crm',
  'visit-plans': 'crm',
  'proposal-approvals': 'crm',
  'task-assignments': 'projects',
  'hour-limits': 'projects',
  'org-changes': 'employees',
  'timeoff-balance': 'timeoff',
  'timeoff-approvals': 'timeoff',
  'sick-leave': 'timeoff',
};

/** Whether a notification's switch is disabled because its module is off in the workspace. */
export function notificationOff(id: string, modules: readonly string[]): boolean {
  const m = NOTIFICATION_MODULE[id];
  return !!m && !modules.includes(m);
}
