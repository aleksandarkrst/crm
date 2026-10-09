import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { paths } from '../lib/paths';
import { useStore } from '../store/store';
import { currentModule, DEFAULT_MODULE, navFor } from './modules';
import { useTerms } from '../store/terms';

/**
 * What the "+" menu and the command palette can do (CD-80). One list, so both offer the same
 * actions. `key` is the letter that runs a create action while the "+" menu is open.
 */
export interface Command {
  id: string;
  group: 'Create' | 'Go to' | 'Settings';
  label: string;
  hint: string;
  /** Other words it is found by in the palette. */
  keywords?: string;
  icon: IconPath;
  key?: string;
  /** The module a create action belongs to (CD-229): in Projects the "+" menu offers only its own. */
  module?: 'crm' | 'projects';
  run: () => void;
}

/** Stroke paths (24×24) for the command icons. */
export const ICONS = {
  deal: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3',
  contact: 'M12 11a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6ZM5 20c1.2-3.1 4-4.7 7-4.7s5.8 1.6 7 4.7',
  company: 'M4 20V6.5L11 4v16M11 20h9V10h-9M14.5 13h2M14.5 16.5h2M7 8.5h1M7 12h1M7 15.5h1',
  task: 'M5 5h14v14H5zM9 12l2 2 4-4',
  product: 'M20 8.5 12 4 4 8.5v7L12 20l8-4.5v-7ZM4 8.5 12 13m0 0 8-4.5M12 13v7',
  project: 'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  overview: 'M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6',
  pipeline: 'M4 5h5v14H4zM15 5h5v9h-5z',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.5 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.5-2-1.5Z',
  team: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M17 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a7 7 0 0 1 16 0v1',
  document: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9zM10 19.5a2 2 0 0 0 4 0',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  org: 'M9.5 3.5h5v4h-5zM3.5 16.5h5v4h-5zM15.5 16.5h5v4h-5zM12 7.5v4.5M6 16.5v-2.5h12v2.5',
  timesheet: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  reports: 'M5 20V10M10 20V4M15 20v-7M20 20v-4M3 20h18',
  visitPlan: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
} as const;
export type IconPath = keyof typeof ICONS;

export function useCommands(): Command[] {
  const { s, set, addCompany, meetings, session } = useStore();
  const terms = useTerms();
  const navigate = useNavigate();
  // On a deal's screen, a new task or contact starts out linked to that deal.
  const dealId = useMatch('/deals/:id')?.params.id;
  const onDeal = dealId && s.leads.some((l) => l.id === dealId) ? dealId : undefined;
  // A new meeting starts out with the record that is open (CD-130).
  const companyId = useMatch('/companies/:id')?.params.id;
  const contactId = useMatch('/contacts/:id')?.params.id;
  const deal = s.leads.find((l) => l.id === onDeal);
  const meetingSeed = deal ? { dealId: deal.id, companyId: deal.companyId, contactId: deal.contactId } : companyId ? { companyId } : contactId ? { contactId } : {};
  const go = (to: string) => () => navigate(to);
  // On a project's page a new task is for that project (CD-283); in the Projects module it is just "Task".
  const projectId = useMatch('/projects/:id')?.params.id;
  const inProjects = currentModule(useLocation().pathname, session.userId).id === 'projects';

  const create: Command[] = [
    { id: 'new-deal', group: 'Create', label: 'Deal', hint: 'Starts a funnel', key: 'D', icon: 'deal', keywords: 'new create add opportunity lead', run: () => set({ newLeadOpen: true }) },
    { id: 'new-contact', group: 'Create', label: 'Contact', hint: 'A person at a company', key: 'P', icon: 'contact', keywords: 'new create add person people', run: () => set(onDeal ? { contactOpen: true, contactCompany: onDeal } : { contactOpen: true }) },
    { id: 'new-company', group: 'Create', label: 'Company', hint: 'Opens the new record', key: 'O', icon: 'company', keywords: 'new create add organization organisation', run: addCompany },
    // "Deal task" since projects have tasks too (spec Q8, CD-144).
    { id: 'new-task', group: 'Create', label: 'Deal task', hint: 'Shows in Today', key: 'T', icon: 'task', keywords: 'new create add activity to-do todo call meeting', run: () => set(onDeal ? { taskOpen: true, taskLeadId: onDeal } : { taskOpen: true }) },
    { id: 'new-meeting', group: 'Create', label: 'Meeting', hint: 'On the calendar', key: 'M', icon: 'calendar', keywords: 'new create add meeting visit call schedule calendar', run: () => meetings.openDialog(meetingSeed) },
    { id: 'new-product', group: 'Create', label: 'Product', hint: 'Adds to the catalog', key: 'R', icon: 'product', keywords: 'new create add service catalog', run: () => set({ productOpen: true, productEditId: null }) },
    // On a company's page or a won deal's, the project starts out for it (CD-234).
    { id: 'new-project', group: 'Create', label: terms.Project, hint: 'Work for a company', key: 'J', icon: 'project', module: 'projects', keywords: 'new create add project delivery job', run: () => set({ newProject: deal?.outcome === 'won' ? { dealId: deal.id } : companyId ? { companyId } : {} }) },
    { id: 'new-project-task', group: 'Create', label: inProjects ? terms.Task : `${terms.Project} ${terms.task}`, hint: `Work on ${terms.aProject}`, key: 'K', icon: 'task', module: 'projects', keywords: 'new create add task project plan to-do todo', run: () => set({ newTask: projectId ? { projectId } : {} }) },
    { id: 'new-work-order', group: 'Create', label: 'Work order', hint: 'Service work for a company', key: 'W', icon: 'task', module: 'projects', keywords: 'new create add work order service repair installation maintenance technician', run: () => set({ newWorkOrder: projectId ? { projectId } : companyId ? { companyId } : {} }) },
  ];
  const goTo: Command[] = [
    { id: 'go-overview', group: 'Go to', label: 'Overview', hint: 'Numbers and forecasts', icon: 'overview', keywords: 'dashboard reports', run: go(paths.overview) },
    { id: 'go-pipeline', group: 'Go to', label: 'Pipeline', hint: 'Deals by stage', icon: 'pipeline', keywords: 'deals board funnel', run: go(paths.pipeline) },
    { id: 'go-today', group: 'Go to', label: 'Today', hint: 'Tasks due and overdue', icon: 'task', keywords: 'tasks agenda', run: go(paths.today) },
    { id: 'go-calendar', group: 'Go to', label: 'Calendar', hint: 'Meetings by day, week and month', icon: 'calendar', keywords: 'meetings visits schedule agenda', run: go(paths.calendar()) },
    { id: 'go-visit-plans', group: 'Go to', label: 'Visit plans', hint: 'Customer visits per salesperson', icon: 'visitPlan', keywords: 'visits targets plan customers', run: go(paths.visitPlans) },
    { id: 'go-companies', group: 'Go to', label: 'Companies', hint: 'Every company', icon: 'company', keywords: 'organizations', run: go(paths.companies) },
    { id: 'go-contacts', group: 'Go to', label: 'Contacts', hint: 'Every person', icon: 'contact', keywords: 'people persons', run: go(paths.contacts) },
    { id: 'go-products', group: 'Go to', label: 'Products', hint: 'The catalog', icon: 'product', keywords: 'services catalog prices', run: go(paths.products) },
    // The role-gated page and the other modules' pages (CD-223): the sidebar shows one module at a time.
    ...(navFor(DEFAULT_MODULE, session.tenant.role, s.visitScope.seesTeam).some((n) => n.to === paths.reports())
      ? [{ id: 'go-reports', group: 'Go to' as const, label: 'Reports', hint: 'Visit-plan completion', icon: 'reports' as const, keywords: 'report visits completion targets', run: go(paths.reports()) }]
      : []),
    { id: 'go-projects', group: 'Go to', label: terms.Projects, hint: 'Projects · board and list', icon: 'project', keywords: 'projects delivery board', run: go(paths.projects) },
    { id: 'go-tasks', group: 'Go to', label: terms.Tasks, hint: 'Projects · kanban and table', icon: 'task', keywords: 'tasks project plan to-do todo kanban', run: go(paths.tasks) },
    { id: 'go-work-orders', group: 'Go to', label: 'Work orders', hint: 'Projects · kanban and table', icon: 'task', keywords: 'work orders service technician repair installation kanban', run: go(paths.workOrders) },
    { id: 'go-workload', group: 'Go to', label: 'Workload', hint: 'Projects · remaining hours per person', icon: 'reports', keywords: 'workload capacity load remaining hours estimate report people weeks', run: go(paths.workload) },
    { id: 'go-timesheet', group: 'Go to', label: 'Timesheet', hint: 'Workforce · your hours this week', icon: 'timesheet', keywords: 'workforce time hours log week submit', run: go(paths.timesheet()) },
    { id: 'go-org', group: 'Go to', label: 'Org structure', hint: 'Workforce · people and teams', icon: 'org', keywords: 'workforce people employees units departments teams chart', run: go(paths.org()) },
  ];
  const settings: Command[] = [
    { id: 'go-profile', group: 'Settings', label: 'Personal preferences', hint: 'Your profile', icon: 'profile', keywords: 'profile account start page', run: go(paths.profile) },
    { id: 'go-workspace', group: 'Settings', label: 'Workspace settings', hint: 'Name, currency, time zone', icon: 'settings', keywords: 'currency time zone fiscal year', run: go(paths.settings()) },
    { id: 'go-team', group: 'Settings', label: 'Team', hint: 'Members and invitations', icon: 'team', keywords: 'users invite members roles', run: go(paths.settings('team')) },
    { id: 'go-notifications', group: 'Settings', label: 'Notifications', hint: 'Emails you get', icon: 'bell', keywords: 'email digest', run: go(paths.settings('notifications')) },
    { id: 'go-project-types', group: 'Settings', label: `${terms.Project} types`, hint: `Stages of ${terms.projects}`, icon: 'project', keywords: 'project stages board', run: go(paths.settings('project-types')) },
    { id: 'go-funnels', group: 'Settings', label: 'Funnel builder', hint: 'Stages and playbooks', icon: 'pipeline', keywords: 'stages checklist playbook', run: go(paths.settings('funnel')) },
    { id: 'go-fields', group: 'Settings', label: 'Customize fields', hint: 'Custom fields', icon: 'settings', keywords: 'custom fields', run: go(paths.settings('fields')) },
    { id: 'go-templates', group: 'Settings', label: 'Document templates', hint: 'Proposals and contracts', icon: 'document', keywords: 'docx proposal contract', run: go(paths.settings('templates')) },
  ];
  return [...create, ...goTo, ...settings];
}
