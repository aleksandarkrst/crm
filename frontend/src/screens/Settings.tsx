import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from '../components/icons';
import { MODULES, WORKSPACE_MODULES, enabledModules, type WorkspaceModule } from '../components/modules';
import { paths } from '../lib/paths';
import { useStore } from '../store/store';
import { CrmPage } from './settings/CrmPage';
import { EmployeesPage } from './settings/EmployeesPage';
import { GeneralPage } from './settings/GeneralPage';
import { ProjectsPage } from './settings/ProjectsPage';
import { TimeOffPage } from './settings/TimeOffPage';
import { TimesheetPage } from './settings/TimesheetPage';
import { Card, Confirm, Disabled, GlassConfirmHost, Row, Switch } from './settings/parts';
import { GlassShell, NavRow } from './settings/Shell';

type PageKey = 'general' | 'crm' | 'projects' | 'employees' | 'timesheet' | 'timeoff';

/**
 * The pages of Workspace settings (CD-524 spec, section 1): six items, each one long page with all
 * its sections. A module page starts with the module's switch; with the module off the page stays
 * in the sidebar (an "Off" pill) and its settings are visible but disabled.
 */
const PAGES: readonly { k: PageKey; label: string; icon: IconName; module: WorkspaceModule | null }[] = [
  { k: 'general', label: 'General', icon: 'preferences', module: null },
  { k: 'crm', label: 'CRM', icon: 'crm', module: 'crm' },
  { k: 'projects', label: 'Projects', icon: 'modules', module: 'projects' },
  { k: 'employees', label: 'Employees', icon: 'employees', module: 'employees' },
  { k: 'timesheet', label: 'Timesheet', icon: 'clock', module: 'timesheet' },
  { k: 'timeoff', label: 'Time off', icon: 'calendar', module: 'timeoff' },
];

/** The sections' old routes (CD-280 to the first CD-524) land on the page that has them now. */
const OLD: Record<string, PageKey> = {
  workspace: 'general',
  company: 'general',
  modules: 'general',
  roles: 'general',
  funnel: 'crm',
  templates: 'crm',
  fields: 'crm',
  bonuses: 'crm',
  'project-hierarchy': 'projects',
  'project-types': 'projects',
  technicians: 'projects',
  'org-levels': 'employees',
  'working-time': 'employees',
  approvals: 'timesheet',
  'time-entry': 'timesheet',
  leave: 'timeoff',
  holidays: 'timeoff',
};

/** A module's name as the app shows it, and its tile colour (as on Home, CD-288). */
export const moduleName = (id: WorkspaceModule) => MODULES.find((m) => m.id === id)?.name ?? id;
export const MODULE_TILE: Partial<Record<WorkspaceModule, string>> = { crm: 'var(--mod-crm)', projects: 'var(--mod-projects)', employees: 'var(--mod-employees)', timesheet: 'var(--mod-timesheet)', timeoff: 'var(--mod-timeoff)' };

/**
 * Turning a module on or off, from its page or from Modules on General (one setting, CD-524 spec
 * 1): on needs no confirm; off asks first. Both say what happened in a toast.
 */
export function useModuleSwitch() {
  const { s, setWorkspace } = useStore();
  const [asking, setAsking] = useState<WorkspaceModule | null>(null);
  const on = (id: WorkspaceModule) => s.workspace.modules.includes(id);
  const apply = (id: WorkspaceModule, next: boolean) => setWorkspace({ modules: WORKSPACE_MODULES.filter((m) => (m === id ? next : s.workspace.modules.includes(m))) }, `${moduleName(id)} is ${next ? 'on' : 'off'}`);
  const flip = (id: WorkspaceModule) => (on(id) ? setAsking(id) : apply(id, true));
  const dialog = asking && (
    <Confirm
      title={`Turn off ${moduleName(asking)}?`}
      text={`${moduleName(asking)} disappears for everyone in ${s.workspace.name}, and its settings are hidden. Its data is kept, and everything comes back when you turn it on again.`}
      confirmLabel={`Turn off ${moduleName(asking)}`}
      icon="lock"
      onCancel={() => setAsking(null)}
      onConfirm={() => {
        apply(asking, false);
        setAsking(null);
      }}
      testId="module-off-confirm"
    />
  );
  return { on, flip, dialog };
}

export function Settings() {
  const { tab = 'general' } = useParams();
  const navigate = useNavigate();
  const { s, canEditWorkspace, settingsToasts } = useStore();
  const [params] = useSearchParams();
  const modules = enabledModules(s.workspace.modules);
  const sw = useModuleSwitch();
  // Opening Settings or another page starts at the top, not where the last page was scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
  // Every save in Workspace settings says so in a toast (CD-524 spec 5).
  useEffect(() => {
    settingsToasts(true);
    return () => settingsToasts(false);
  }, [settingsToasts]);
  // Members moved to Employees → Team (CD-521): old links and bookmarks land there, `?invite=1` included.
  if (tab === 'team') return <Navigate to={paths.team(params.get('invite') === '1')} replace />;
  // Notifications are your own, not the workspace's (CD-489): Profile settings → Notifications.
  if (tab === 'notifications') return <Navigate to={paths.myNotifications} replace />;
  // Members don't see the workspace settings at all (CD-523): any settings URL goes home.
  if (!canEditWorkspace) return <Navigate to="/" replace />;
  if (OLD[tab]) return <Navigate to={paths.settings(OLD[tab])} replace />;
  const page = PAGES.find((p) => p.k === tab);
  if (!page) return <Navigate to={paths.settings()} replace />;
  const off = page.module !== null && !modules.includes(page.module);

  return (
    <GlassShell
      label="Settings"
      testId="settings-nav"
      head={
        <span className="gs-side-ws" title={s.workspace.name} data-testid="settings-workspace-name">
          {s.workspace.name}
        </span>
      }
      nav={PAGES.map((p) => (
        <NavRow key={p.k} k={p.k} label={p.label} icon={p.icon} on={p.k === page.k} pill={p.module !== null && !modules.includes(p.module) && <span className="gs-off-pill">Off</span>} onClick={() => navigate(paths.settings(p.k))} />
      ))}
      title={page.label}
      after={sw.dialog}
    >
      <div className="gs-page" data-testid="settings-content" data-section={page.k}>
        {page.module && (
          <div className={'gs-modcard' + (off ? ' off' : '')} data-testid="module-switch-card">
            <Card>
              <Row
                label={`${moduleName(page.module)} module`}
                desc={off ? `Off for everyone. These settings are kept, but nothing below applies until you turn ${moduleName(page.module)} on.` : `On for everyone in ${s.workspace.name}.`}
                icon={
                  <span className="gs-tile" aria-hidden="true" style={MODULE_TILE[page.module] ? { background: MODULE_TILE[page.module] } : undefined}>
                    <Icon name={page.icon} size={17} />
                  </span>
                }
                switchRow
              >
                <Switch on={!off} label={`${moduleName(page.module)} in this workspace`} onChange={() => sw.flip(page.module!)} />
              </Row>
            </Card>
          </div>
        )}
        <Disabled off={off}>
          <div className="gs-page" style={{ padding: 0 }}>
            {page.k === 'general' && <GeneralPage />}
            {page.k === 'crm' && <CrmPage />}
            {page.k === 'projects' && <ProjectsPage />}
            {page.k === 'employees' && <EmployeesPage />}
            {page.k === 'timesheet' && <TimesheetPage />}
            {page.k === 'timeoff' && <TimeOffPage />}
          </div>
        </Disabled>
        <GlassConfirmHost />
      </div>
    </GlassShell>
  );
}
