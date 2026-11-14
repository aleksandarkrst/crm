import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { askConfirm } from '../components/ConfirmDialog';
import { GhostInput, GhostSelect, Modal, ModalHeader, RemoveButton, Switch } from '../components/ui';
import { Icon, type IconName } from '../components/icons';
import { Screen } from '../components/Layout';
import { MODULES, WORKSPACE_MODULES, enabledModules, type WorkspaceModule } from '../components/modules';
import { paths } from '../lib/paths';
import { canManageTemplates } from '../store/documents';
import { ACTIVITIES, CHANNEL_LABELS, CHANNELS, CURRENCIES, DOCS, FIELD_TYPES } from '../store/seed';
import { bonusRuleProblems } from '../store/dealMath';
import { currencySymbol, curOf, customFieldsOf, memberLabels, salesPeople } from '../store/selectors';

import type { BonusRule, CustomFieldDef, Stage, Workspace } from '../store/types';
import type { CustomFieldEntity } from '../lib/api';
import { useStore } from '../store/store';
import { TemplatesTab } from './DocumentTemplates';
import { EmployeeRecordTab, OrgLevelsTab, WorkingTimeBlocks } from './settings/EmployeesTab';
import { CompanyCard } from './settings/CompanyCard';
import { LeaveTab, TimeOffTab } from './settings/TimeOffSettings';
import { ApprovalsTab, HolidaysTab, TimeEntryBlocks } from './settings/WorkforceSettings';
import { ProjectHierarchyTab, ProjectTypesTab } from './settings/ProjectTypesTab';
import { TechniciansTab } from './settings/TechniciansTab';
import { LogoRow, NameRow } from './settings/WorkspaceInfo';
import { TimeZonePicker } from './settings/TimeZonePicker';
import { RolesTab } from './settings/RolesTab';
import { Block, MoveButton, RemoveX, Row, Rows, Segmented, Table, Unit } from './settings/parts';
import { useTerms } from '../store/terms';
import { targetOf } from '../lib/validate';

const TARGET_DAYS_PROBLEM = 'Use whole days from 1 to 365, or leave it empty.';

/**
 * A target-days field that saves when it is left (or on Enter), not per keystroke: typing 99999999
 * must not save its valid prefix 99 on the way. A value out of range or not a whole number stays
 * in the field with a message under it and is not saved (CD-487 QA: -5 used to become 1 silently).
 */
function TargetDaysInput({ value, onSave, disabled, placeholder, testId }: { value: number | null; onSave: (v: number | null) => void; disabled: boolean; placeholder: string; testId: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value === null ? '' : String(value));
    setBad(false);
  }, [value]);
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, maxWidth: '100%' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          className="form-input"
          data-testid={testId}
          type="number"
          disabled={disabled}
          min={1}
          max={365}
          step={1}
          value={text}
          placeholder={placeholder}
          aria-label="Target days"
          aria-invalid={bad}
          onChange={(e) => {
            setText(e.target.value);
            setBad(targetOf(e.target.value, e.target.validity.badInput) === undefined);
          }}
          onBlur={(e) => {
            const next = targetOf(e.target.value, e.target.validity.badInput);
            if (next !== undefined && next !== value) onSave(next);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          style={{ width: 130 }}
        />
        <Unit>days</Unit>
      </span>
      {bad && (
        <span className="ws-row-error" role="alert" data-testid={`${testId}-error`}>
          {TARGET_DAYS_PROBLEM}
        </span>
      )}
    </span>
  );
}

type TabDef = {
  k: string;
  group: (typeof GROUPS)[number];
  label: string;
  icon: IconName;
  description: string;
};

/**
 * The sections of Settings (CD-280), grouped by module in the left nav, each on its own route
 * (`/settings/<k>`). Since CD-524 they follow the design G-Settings: Company details, Organization
 * levels and Leave and absence are sections of their own (their settings were cards in General,
 * Employees and Policies); the working day and time entry are in General; a few sections take the
 * design's names. The design's Business trips, contract types and workspace deletion are not in the app.
 */
const TABS: readonly TabDef[] = [
  { k: 'workspace', group: 'Workspace', label: 'General', icon: 'preferences', description: 'Name, logo, currency, time zone and fiscal year of the workspace, the working day and how people log hours.' },
  { k: 'company', group: 'Workspace', label: 'Company details', icon: 'building', description: 'Printed on generated documents such as vacation decisions. Empty fields print as blanks.' },
  {
    k: 'modules',
    group: 'Workspace',
    label: 'Modules',
    icon: 'modules',
    description: 'The modules this workspace uses. A module that is off shows as "Not in this workspace" in the module switcher and its settings are hidden; its data is kept.',
  },
  { k: 'roles', group: 'Workspace', label: 'Roles & permissions', icon: 'lock', description: 'What owners, admins and members can do.' },
  { k: 'funnel', group: 'CRM', label: 'Funnels', icon: 'funnel', description: 'The stages opportunities move through, what happens in each and what must be done before they move on.' },
  { k: 'templates', group: 'CRM', label: 'Document templates', icon: 'template', description: 'Templates hold the fixed story; merge fields pull the rest from the opportunity when someone generates a document.' },
  { k: 'fields', group: 'CRM', label: 'Custom fields', icon: 'fields', description: 'Custom fields show on opportunities, companies and contacts, in their create forms and in CSV exports. Everyone can fill them in.' },
  { k: 'bonuses', group: 'CRM', label: 'Sales bonuses', icon: 'bonus', description: 'How salespeople earn bonuses on won opportunities.' },
  // The Names block explains the names; the subtitle says what the page holds (CD-489: not the same sentence twice).
  { k: 'project-hierarchy', group: 'Projects', label: 'Project hierarchy', icon: 'hierarchy', description: 'What projects and tasks are called in this workspace, and what happens when someone logs more hours than their limit.' },
  {
    k: 'project-types',
    group: 'Projects',
    label: 'Project types',
    icon: 'columns',
    description:
      "A project type is a set of stages for one kind of project, like a funnel in the CRM. Each project is on one board: it shows in that board's columns, and its tasks are grouped by the same stages in the plan. Complete and Cancel are always available and are not stages.",
  },
  { k: 'technicians', group: 'Projects', label: 'Technicians', icon: 'wrench', description: 'What each person can be given: project tasks, work orders or both.' },
  // Workforce's settings, grouped by the modules it was split into (CD-521). They stay here, not in the modules.
  { k: 'employees', group: 'Employees', label: 'Employee record', icon: 'employees', description: 'What is kept for every employee and what employees may change themselves.' },
  { k: 'org-levels', group: 'Employees', label: 'Organization levels', icon: 'hierarchy', description: 'The names of your levels, from the top down. The org structure and its units use them.' },
  { k: 'approvals', group: 'Timesheet', label: 'Submission and approval', icon: 'check', description: 'When timesheets are due, how managers approve them and who gets reminded.' },
  { k: 'timeoff', group: 'Time off', label: 'Vacation', icon: 'sun', description: 'Vacation policies and the decision sent when vacation is approved.' },
  { k: 'leave', group: 'Time off', label: 'Leave and absence', icon: 'leave', description: 'Paid leave, sick leave and other absence.' },
  { k: 'holidays', group: 'Time off', label: 'Holidays', icon: 'calendar', description: 'Days nobody is expected to work. They show in the Timesheet and move deadlines.' },
];
const GROUPS = ['Workspace', 'CRM', 'Projects', 'Employees', 'Timesheet', 'Time off'] as const;
/** The module each group belongs to (CD-488): a module turned off in Modules hides its settings too. */
const GROUP_MODULE: Record<(typeof GROUPS)[number], WorkspaceModule | null> = { Workspace: null, CRM: 'crm', Projects: 'projects', Employees: 'employees', Timesheet: 'timesheet', 'Time off': 'timeoff' };

export function Settings() {
  const { tab = 'workspace' } = useParams();
  const navigate = useNavigate();
  const { s, set, session, flash, canEditFields, canSeeBonuses, canEditWorkspace, canEditFunnels } = useStore();
  const modules = enabledModules(s.workspace.modules);
  const terms = useTerms();
  // "Project types" follows what the workspace calls projects (CD-143).
  const labelOf = (t: TabDef) => (t.k === 'project-types' ? `${terms.Project} types` : t.label);
  const [params] = useSearchParams();
  // Opening Settings or another section starts at the top, not where the last page was scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
  // Members moved to Employees → Team (CD-521): old links and bookmarks land there, `?invite=1` included.
  if (tab === 'team') return <Navigate to={paths.team(params.get('invite') === '1')} replace />;
  // Notifications are your own, not the workspace's (CD-489): they are a page of your account
  // (Profile settings → Notifications) for everyone. Old links (emails sent before, bookmarks) land there.
  if (tab === 'notifications') return <Navigate to={paths.myNotifications} replace />;
  // Members don't see the workspace settings at all (CD-523): any settings URL goes home. From here
  // on the viewer is an owner or admin.
  if (!canEditWorkspace) return <Navigate to="/" replace />;
  // The sales bonus rules (CD-17) need their permission; a module turned off hides its group (CD-488).
  const tabs = TABS.filter((t) => {
    const mod = GROUP_MODULE[t.group];
    return (t.k !== 'bonuses' || canSeeBonuses) && (mod === null || modules.includes(mod));
  });
  if (!tabs.some((t) => t.k === tab)) return <Navigate to={paths.settings()} replace />;
  const section = tabs.find((t) => t.k === tab)!;
  const current = section.k;
  const modulesOff = GROUPS.filter((g) => GROUP_MODULE[g] && !modules.includes(GROUP_MODULE[g])).length;

  const action =
    current === 'templates'
      ? { label: 'New template', onClick: () => (canManageTemplates(session.tenant.role) ? set({ templateOpen: true, templateEditing: null }) : flash('Only owners and admins can add templates')) }
      : current === 'fields'
        ? canEditFields
          ? { label: 'New field', onClick: () => set({ fieldOpen: true }) }
          : null
        : current === 'funnel' && canEditFunnels
          ? { label: 'New funnel', onClick: () => set({ personaOpen: true, personaBase: s.segment }), testId: 'new-funnel' }
          : null;

  return (
    <Screen title="Settings">
      <div className="settings-frame">
        <nav className="settings-nav ws-nav" aria-label="Settings" data-testid="settings-nav">
          <div className="ws-nav-head">
            <b>Workspace settings</b>
            <span title={s.workspace.name}>{s.workspace.name}</span>
          </div>
          {GROUPS.filter((g) => tabs.some((t) => t.group === g)).map((g) => (
            <div key={g} className="settings-nav-group" data-group={g}>
              <span className="caps-muted settings-nav-label">{g}</span>
              {tabs
                .filter((t) => t.group === g)
                .map((t) => (
                  <button key={t.k} type="button" className={'settings-nav-item' + (t.k === current ? ' on' : '')} aria-current={t.k === current ? 'page' : undefined} data-section={t.k} onClick={() => navigate(paths.settings(t.k))}>
                    <Icon name={t.icon} size={16} />
                    <span>{labelOf(t)}</span>
                  </button>
                ))}
            </div>
          ))}
          {modulesOff > 0 && (
            <p className="ws-nav-hidden" data-testid="settings-hidden-modules">
              {modulesOff === 1 ? '1 module is off, so its settings are hidden.' : `${modulesOff} modules are off, so their settings are hidden.`}{' '}
              {current !== 'modules' && (
                <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => navigate(paths.settings('modules'))}>
                  Turn them on in Modules
                </button>
              )}
            </p>
          )}
        </nav>
        <div className="settings-content ws-content" data-testid="settings-content" data-section={current}>
          <header className="ws-head">
            <div className="ws-head-text">
              <h2 className="settings-title">{labelOf(section)}</h2>
              <span className="settings-description">{section.description}</span>
            </div>
            {action && (
              <div className="ws-head-actions">
                <button type="button" className="btn btn-primary" data-testid={'testId' in action ? action.testId : undefined} onClick={action.onClick}>
                  {action.label}
                </button>
              </div>
            )}
          </header>

          {current === 'workspace' && <GeneralTab />}
          {current === 'company' && <CompanyCard />}
          {current === 'modules' && <ModulesTab />}
          {current === 'roles' && <RolesTab />}
          {current === 'employees' && <EmployeeRecordTab />}
          {current === 'org-levels' && <OrgLevelsTab />}
          {current === 'approvals' && <ApprovalsTab />}
          {current === 'holidays' && <HolidaysTab />}
          {current === 'timeoff' && <TimeOffTab />}
          {current === 'leave' && <LeaveTab />}
          {current === 'funnel' && <FunnelBuilder />}
          {current === 'project-hierarchy' && <ProjectHierarchyTab />}
          {current === 'project-types' && <ProjectTypesTab />}
          {current === 'technicians' && <TechniciansTab />}
          {current === 'templates' && <TemplatesTab />}
          {current === 'fields' && <FieldsTab />}
          {current === 'bonuses' && <BonusesTab />}
        </div>
      </div>
    </Screen>
  );
}

const CUSTOMER_EMAIL_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'sr', label: 'Srpski' },
] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((label, i) => ({ value: String(i + 1), label }));

/**
 * Settings → General (design G-Settings "general"): the workspace's name, logo, currency, time zone,
 * fiscal year and customer email language, the standard working day and weekly hours, time entry
 * (with their modules on), saved as they change, and Getting started. The country is in Company
 * details; creating projects from won opportunities is in Project hierarchy.
 */
function GeneralTab() {
  const { s, setWorkspace } = useStore();
  const w = s.workspace;
  const modules = enabledModules(w.modules);
  return (
    <>
      <Block title="Workspace">
        <Rows testId="workspace-fields">
          <LogoRow />
          <NameRow />
          <Row label="Currency" hint="Used for opportunity values, budgets and bonuses">
            <GhostSelect className="form-input" aria-label="Currency" value={w.currency} onChange={(e) => setWorkspace({ currency: e.target.value })} options={CURRENCIES} chevron />
          </Row>
          <Row label="Time zone" hint="Deadlines, reminders and the daily digest follow this">
            <TimeZonePicker value={w.timezone} onChange={(timezone) => setWorkspace({ timezone })} />
          </Row>
          <Row label="Fiscal year starts" hint="Budgets and targets follow your fiscal year">
            <GhostSelect className="form-input" aria-label="Fiscal year starts" value={String(w.fiscalMonth)} onChange={(e) => setWorkspace({ fiscalMonth: Number(e.target.value) })} options={MONTHS} chevron />
          </Row>
          <Row label="Customer emails" hint="Language of the fixed text in emails to customers, such as meeting minutes">
            <Segmented
              label="Customer email language"
              value={w.customerEmailLanguage}
              options={CUSTOMER_EMAIL_LANGUAGES}
              onChange={(v) => setWorkspace({ customerEmailLanguage: v as Workspace['customerEmailLanguage'] })}
              testId="customer-email-language"
            />
          </Row>
        </Rows>
      </Block>
      {/* The working day and time entry moved here from their own sections (CD-524 review); each still only with its module on (CD-488). */}
      {modules.includes('employees') && <WorkingTimeBlocks />}
      {modules.includes('timesheet') && <TimeEntryBlocks />}
      <GettingStartedBlock />
    </>
  );
}

/** Module tiles take the colour they have on Home (CD-288). */
const MODULE_TILE: Partial<Record<WorkspaceModule, string>> = { crm: 'var(--mod-crm)', projects: 'var(--mod-projects)', employees: 'var(--mod-employees)', timesheet: 'var(--mod-timesheet)', timeoff: 'var(--mod-timeoff)' };
/** The design's two groups: the modules used every day, and those used a few times a year. */
const DAILY: readonly WorkspaceModule[] = ['crm', 'projects', 'employees', 'timesheet', 'timeoff'];

/**
 * Settings → Workspace → Modules (CD-318, moved out of General): one row per module with its
 * description and a switch. Only owners and admins reach Settings (CD-523). A module
 * that is off shows as "Not in this workspace" in the module switcher; its data is kept.
 */
function ModulesTab() {
  const { s, setWorkspace } = useStore();
  const w = s.workspace;
  const row = (id: WorkspaceModule) => {
    const on = w.modules.includes(id);
    const def = MODULES.find((m) => m.id === id);
    const name = def?.name ?? id;
    const built = !!def && def.screens.length > 0;
    return (
      <Row
        key={id}
        data={{ 'data-module': id }}
        switchRow
        icon={
          <span className="ws-row-icon" aria-hidden style={MODULE_TILE[id] ? { background: MODULE_TILE[id] } : undefined}>
            {def && <Icon name={def.icon} size={17} />}
          </span>
        }
        label={name}
        hint={
          <>
            {def?.description}
            {!built && ' · Coming soon'}
          </>
        }
      >
        <Switch on={on} label={`${name} in this workspace`} onClick={() => setWorkspace({ modules: WORKSPACE_MODULES.filter((m) => (m === id ? !on : w.modules.includes(m))) })} />
      </Row>
    );
  };
  return (
    <div className="ws-stack" data-testid="workspace-modules">
      <Block title="Daily work">
        <Rows>{WORKSPACE_MODULES.filter((m) => DAILY.includes(m)).map(row)}</Rows>
      </Block>
      <Block title="Planning and management" desc="Used a few times a year.">
        <Rows>{WORKSPACE_MODULES.filter((m) => !DAILY.includes(m)).map(row)}</Rows>
      </Block>
    </div>
  );
}

/** Getting started (CD-68) for owners and admins: show the checklist again, load or remove sample data. */
function GettingStartedBlock() {
  const { s, setOnboardingDismissed, loadSampleData, removeSampleData } = useStore();
  const [busy, setBusy] = useState(false);
  const ob = s.onboarding;
  if (!ob) return null;
  const run = (fn: () => Promise<void>) => () => {
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };
  const c = ob.sampleData.counts;
  return (
    <Block title="Getting started" testId="sample-data-card">
      <Rows>
        <Row
          label={ob.sampleData.loaded ? 'Sample data is loaded' : 'Sample data'}
          hint={
            ob.sampleData.loaded
              ? `${c.company} companies, ${c.contact} contacts, ${c.product} products and ${c.deal} opportunities. Removing it deletes exactly those records; your own stay.`
              : 'Adds a few companies, contacts, products and opportunities (with tasks) to look around with. It is marked, so you can remove exactly those records again in one click.'
          }
        >
          {ob.sampleData.loaded ? (
            <button type="button" className="btn-plain" disabled={busy} onClick={run(removeSampleData)}>
              Remove sample data
            </button>
          ) : (
            <button type="button" className="btn-plain" disabled={busy} onClick={run(loadSampleData)}>
              Load sample data
            </button>
          )}
        </Row>
        {ob.dismissed && !ob.complete && (
          <Row label="Getting-started checklist" hint="You closed it before it was done. It comes back on the CRM's first page.">
            <button type="button" className="btn-plain" disabled={busy} onClick={run(() => setOnboardingDismissed(false))}>
              Show the getting-started checklist
            </button>
          </Row>
        )}
      </Rows>
    </Block>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Settings → CRM → Funnels (CD-318; design G-Settings "funnels" since CD-524): the funnels as cards,
 * the selected one's name, how they buy and default target days, its stages (each opens for its
 * activity, channel, document, win probability, owner, target days, to-dos and checks), the
 * proposal approval rule and Delete funnel. Picking a funnel here also makes it the Pipeline's
 * funnel, as before.
 */
function FunnelBuilder() {
  const store = useStore();
  const { s, set } = store;
  const funnel = s.funnels[s.segment] ?? Object.values(s.funnels)[0]!;
  const stages = funnel.stages;
  const [removing, setRemoving] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(stages[0]?.id ?? null);
  const editable = store.canEditFunnels;
  const dealsIn = (id: string) => s.leads.filter((l) => l.segment === id).length;
  const dealCount = dealsIn(funnel.id);
  const wonCount = stages.filter((st) => st.won).length;
  const select = (id: string) => set({ segment: id });
  const approvers = [...memberLabels(s)].sort((a, b) => a[1].localeCompare(b[1]));
  const canDelete = dealCount === 0 && Object.keys(s.funnels).length > 1;

  return (
    <div className="ws-stack" data-testid="funnel-builder">
      {!editable && (
        <span data-testid="funnels-read-only" className="ws-block-desc">
          Only owners and admins can change funnels, stages and their to-dos.
        </span>
      )}

      <div className="ws-choices">
        {Object.values(s.funnels).map((f) => (
          <button key={f.id} type="button" className={'choice' + (f.id === funnel.id ? ' on' : '')} aria-pressed={f.id === funnel.id} data-testid="funnel-choice" onClick={() => select(f.id)}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{f.label}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              {plural(f.stages.length, 'stage')} · {plural(dealsIn(f.id), 'opportunity', 'opportunities')}
            </span>
          </button>
        ))}
      </div>

      <div className="ws-stack" data-testid="funnel-card">
        <Block title="Funnel">
          <Rows>
            <Row label="Name">
              <input className="form-input" aria-label="Funnel name" value={funnel.label} disabled={!editable} onChange={(e) => store.patchFunnel(funnel.id, { label: e.target.value })} />
            </Row>
            <Row label="How they buy" hint="Helps the team pick the right funnel for a new opportunity">
              <input
                className="form-input wide"
                aria-label="How they buy"
                value={funnel.note}
                disabled={!editable}
                placeholder="Who decides, how long it takes, what slows it down"
                onChange={(e) => store.patchFunnel(funnel.id, { note: e.target.value })}
              />
            </Row>
            <Row label="Default target days" hint="How long an opportunity may sit in a stage before it is flagged as stuck. A stage can set its own.">
              <TargetDaysInput testId="funnel-target-days" disabled={!editable} value={funnel.targetDays ?? null} placeholder="No target" onSave={(v) => store.patchFunnel(funnel.id, { targetDays: v })} />
            </Row>
          </Rows>
        </Block>

        <Block title="Stages" desc="Opportunities move from top to bottom. Open a stage to edit it.">
          <div className="card ws-stages">
            {stages.map((st, idx) => (
              <div key={st.id}>
                <FunnelStageRow
                  idx={idx}
                  stage={st}
                  defaultTarget={funnel.targetDays ?? null}
                  deals={s.leads.filter((l) => l.stage === st.id).length}
                  editable={editable}
                  open={open === st.id}
                  first={idx === 0}
                  last={idx === stages.length - 1}
                  removable={!(st.won && wonCount === 1) && stages.length > 1}
                  onToggle={() => setOpen(open === st.id ? null : st.id)}
                  onRemove={() => setRemoving(idx)}
                />
                {idx < stages.length - 1 && <span className="ws-stage-link" aria-hidden="true" />}
              </div>
            ))}
            {editable && (
              <div className="ws-stages-foot">
                <button type="button" className="btn-plain" data-testid="add-stage" onClick={store.addStage}>
                  New stage
                </button>
                <span className="ws-row-hint">New stages go before the won stage. An opportunity can be marked lost from any stage.</span>
              </div>
            )}
          </div>
        </Block>

        {/* One approval rule for the whole funnel, below its stages (CD-120). */}
        <Block title="Proposal approval" desc="One rule for the whole funnel, not per stage. The approver gets an email and a task when approval is requested; owners and admins can approve too." testId="funnel-approval">
          <Rows>
            <Row label="Proposals need approval before they are sent" hint={funnel.proposalApproval ? 'Proposals wait for the approver before they can be sent' : 'Off: proposals go out as soon as they are generated'} switchRow>
              <Switch on={funnel.proposalApproval} disabled={!editable} label="Proposals in this funnel need approval before they are sent" onClick={() => store.patchFunnel(funnel.id, { proposalApproval: !funnel.proposalApproval })} />
            </Row>
            {funnel.proposalApproval && (
              <Row label="Approver" error={!funnel.approverId ? 'Pick the approver to switch approval on.' : undefined}>
                <select
                  className="form-input"
                  data-testid="funnel-approver"
                  aria-label="Approver"
                  disabled={!editable}
                 
                  value={funnel.approverId ?? ''}
                  onChange={(e) => store.patchFunnel(funnel.id, { approverId: e.target.value || null })}
                >
                  <option value="">Pick the approver</option>
                  {approvers.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </Row>
            )}
          </Rows>
        </Block>

        {editable && Object.keys(s.funnels).length > 1 && (
          <Block title="Danger zone">
            <Rows danger>
              <Row
                label="Delete funnel"
                hint={dealCount ? `${plural(dealCount, 'opportunity uses', 'opportunities use')} this funnel. Move them to another funnel first.` : 'No opportunities use this funnel. Its stages, activities and to-dos are deleted with it.'}
              >
                <button
                  type="button"
                  className="btn-danger-quiet"
                  data-testid="delete-funnel"
                  disabled={!canDelete}
                  onClick={() =>
                    // Asked first, in the app's own dialog (CD-488).
                    void askConfirm({
                      title: `Delete the funnel "${funnel.label}"?`,
                      message: `Its ${plural(stages.length, 'stage', 'stages')} and their activities and to-dos are deleted too. This can't be undone.`,
                      confirmLabel: 'Delete funnel',
                      danger: true,
                    }).then((ok) => {
                      if (ok) void store.deleteFunnel(funnel.id);
                    })
                  }
                >
                  Delete funnel
                </button>
              </Row>
            </Rows>
          </Block>
        )}
      </div>

      {removing !== null && stages[removing] && <RemoveStageModal idx={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

/**
 * One stage of the funnel: its number, name (edited in place), a summary and its checks as tags,
 * its opportunities, and the move and delete buttons; the chevron opens its activity, channel,
 * document on entry, win probability, owner, target days, to-dos and the checks before moving on.
 */
function FunnelStageRow({
  idx,
  stage: st,
  defaultTarget,
  deals,
  editable,
  open,
  first,
  last,
  removable,
  onToggle,
  onRemove,
}: {
  idx: number;
  stage: Stage;
  defaultTarget: number | null;
  deals: number;
  editable: boolean;
  open: boolean;
  first: boolean;
  last: boolean;
  removable: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const store = useStore();
  const members = [...memberLabels(store.s)].sort((a, b) => a[1].localeCompare(b[1]));
  const target = st.won ? null : (st.targetDays ?? null);
  const summary = [
    st.activity,
    CHANNEL_LABELS[st.channel as keyof typeof CHANNEL_LABELS] ?? st.channel,
    `${st.prob === '' ? 0 : st.prob}%`,
    st.won ? null : target ? `${target} days` : defaultTarget ? `${defaultTarget} days (funnel default)` : 'no target',
    plural(st.checklist.length, 'to-do'),
  ]
    .filter(Boolean)
    .join(' · ');
  const removeTitle = removable ? 'Remove stage' : st.won ? 'The won stage stays' : 'A funnel needs at least one stage';
  return (
    <div className={'ws-stage' + (open ? ' on' : '') + (st.won ? ' won' : '')} data-testid="funnel-stage" data-open={open || undefined}>
      <div className="ws-stage-head">
        <div className="ws-stage-main" style={{ cursor: 'default' }}>
          <span className="ws-stage-n">{idx + 1}</span>
          <span className="ws-stage-text">
            <input
              className="ghost ghost-sm"
              value={st.name}
              disabled={!editable}
              aria-label="Stage name"
              onChange={(e) => store.editStage(idx, 'name', e.target.value)}
              style={{ fontWeight: 600, fontSize: 13.5, padding: '2px 6px', margin: '0 -6px' }}
            />
            <span className="ws-row-hint">{summary}</span>
            {(st.won || st.gateTodos || st.gateDocs) && (
              <span className="ws-stage-tags">
                {st.won && (
                  <span className="badge badge-brand" title="Opportunities are won by reaching this stage">
                    Won stage
                  </span>
                )}
                {!st.won && st.gateTodos && <span className="badge badge-warn">To-dos must be done</span>}
                {!st.won && st.gateDocs && <span className="badge badge-neutral">Documentation required</span>}
              </span>
            )}
          </span>
          <span className="ws-stage-opps funnel-stage-meta">{plural(deals, 'opportunity', 'opportunities')}</span>
        </div>
        <span className="ws-stage-actions">
          {editable && (
            <>
              <MoveButton dir="up" label="Move up" disabled={first} onClick={() => store.moveStage(idx, -1)} />
              <MoveButton dir="down" label="Move down" disabled={last} onClick={() => store.moveStage(idx, 1)} />
              <RemoveX label="Remove stage" title={removeTitle} disabled={!removable} onClick={onRemove} />
            </>
          )}
          <button type="button" className="ws-x plain" aria-label={open ? 'Hide stage details' : 'Show stage details'} aria-expanded={open} data-testid="funnel-stage-toggle" onClick={onToggle}>
            <span className="ws-stage-chev">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </button>
        </span>
      </div>
      {open && (
        <div className="ws-stage-editor">
          <Row label="Activity" hint="Started for the stage owner when an opportunity enters">
            <select className="form-input" aria-label="Activity" disabled={!editable} value={st.activity} onChange={(e) => store.editStage(idx, 'activity', e.target.value)}>
              {ACTIVITIES.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Row>
          <Row label="Channel">
            <select className="form-input" aria-label="Channel" disabled={!editable} value={st.channel} onChange={(e) => store.editStage(idx, 'channel', e.target.value)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Document on entry" hint="Generated from its template when an opportunity enters">
            <select className="form-input" aria-label="Document on entry" disabled={!editable} value={st.doc} onChange={(e) => store.editStage(idx, 'doc', e.target.value)}>
              {DOCS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Row>
          <Row label="Win probability" hint="Used for the weighted pipeline">
            <input className="form-input" aria-label="Win probability" type="number" disabled={!editable} min={0} max={100} step={5} value={st.prob} onChange={(e) => store.editProb(idx, e.target.value)} style={{ width: 90 }} />
            <Unit>%</Unit>
          </Row>
          {!st.won && (
            <>
              <Row label="Stage owner" hint="Who gets the activity and the to-dos">
                <select
                  className="form-input"
                  data-testid="stage-owner-select"
                  aria-label="Stage owner"
                  disabled={!editable}
                 
                  value={st.ownerId ?? ''}
                  onChange={(e) => store.setStageRule(idx, { ownerId: e.target.value || null })}
                >
                  <option value="">The opportunity's owner</option>
                  {members.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Target days" hint={defaultTarget ? `Leave empty to use the funnel default of ${defaultTarget} days` : 'Leave empty for no target'}>
                <TargetDaysInput testId="stage-target-days" disabled={!editable} value={st.targetDays ?? null} placeholder="Funnel default" onSave={(v) => store.setStageRule(idx, { targetDays: v })} />
              </Row>
            </>
          )}
          <div className="ws-stage-sec">To-dos</div>
          <span className="ws-row-hint ws-stage-sub">Created for the stage owner when an opportunity enters.</span>
          <div className="ws-chips" style={{ padding: '8px 16px 4px' }}>
            {st.checklist.map((c, gi) => (
              <span key={st.checklistIds[gi] ?? gi} className="ws-chip gate-chip">
                <input value={c} aria-label="To-do" disabled={!editable} onChange={(e) => store.renameGate(idx, gi, e.target.value)} style={{ width: Math.max(9, Math.min(34, c.length + 1)) + 'ch' }} />
                {editable && <RemoveX plain label={`Delete to-do ${c}`} title="Delete to-do" onClick={() => store.removeGate(idx, gi)} />}
              </span>
            ))}
            {!st.checklist.length && <span className="ws-row-hint">No to-dos yet.</span>}
            {editable && (
              <button type="button" className="btn-plain" style={{ padding: '5px 11px', fontSize: 12.5 }} onClick={() => store.addGate(idx)}>
                Add to-do
              </button>
            )}
          </div>
          {!st.won && (
            // Advance gates (CD-363): what has to be done before an opportunity moves on from this stage.
            <>
              <div className="ws-stage-sec">Before moving on</div>
              <Row
                label="All to-dos must be done"
                switchRow
                hint={
                  // Its own switch, never turned on by adding a to-do; say what it does now (CD-488).
                  <span data-testid="stage-gate-todos-note">
                    {!st.gateTodos
                      ? 'Off: the to-dos above are reminders, opportunities move on without them.'
                      : st.checklist.length
                        ? `On: an opportunity moves on only when ${st.checklist.length === 1 ? 'the to-do above is' : `all ${st.checklist.length} to-dos above are`} done.`
                        : 'On, with no to-dos yet: nothing blocks moving on, but opportunities can’t skip this stage. New stages start with it on.'}
                  </span>
                }
              >
                <Switch on={st.gateTodos} disabled={!editable} label="All to-dos must be done" onClick={() => store.setStageRule(idx, { gateTodos: !st.gateTodos })} />
              </Row>
              <Row label="Needs documentation complete" hint={st.gateDocs ? 'On: the opportunity moves on only with its documentation complete' : 'Off: no documentation is needed to move on'} switchRow>
                <Switch on={st.gateDocs} disabled={!editable} label="Needs documentation complete" onClick={() => store.setStageRule(idx, { gateDocs: !st.gateDocs })} />
              </Row>
            </>
          )}
          {editable && (
            <div className="ws-stage-foot">
              <span className="ws-row-hint">{removable ? (deals ? `${plural(deals, 'opportunity is', 'opportunities are')} in this stage. You choose where they go.` : 'No opportunities are in this stage.') : removeTitle}</span>
              <button type="button" className="btn-danger-quiet" disabled={!removable} onClick={onRemove}>
                Delete stage
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Removing a stage (CD-9). Its deals, lost ones included, move to the stage picked here; the
 * move shows in each deal's history. Lost deals can't go to the won stage.
 */
function RemoveStageModal({ idx, onClose }: { idx: number; onClose: () => void }) {
  const store = useStore();
  const { s } = store;
  const stages = s.funnels[s.segment]!.stages;
  const st = stages[idx]!;
  const deals = s.leads.filter((l) => l.stage === st.id);
  const hasLost = deals.some((l) => l.outcome === 'lost');
  const targets = stages.filter((x) => x.id !== st.id && !(hasLost && x.won));
  const [target, setTarget] = useState(stages[idx - 1]?.id && targets.some((x) => x.id === stages[idx - 1]!.id) ? stages[idx - 1]!.id : (targets[0]?.id ?? ''));
  const blocked = deals.length > 0 && !target;
  return (
    <Modal maxWidth={480} onBackdrop={onClose}>
      <ModalHeader title={`Remove ${st.name}?`} sub="The stage leaves this funnel. Opportunities keep their stage history, including the time they spent here." />
      {deals.length > 0 ? (
        <label className="form-label">
          Move its {deals.length} {deals.length === 1 ? 'opportunity' : 'opportunities'} to
          <select className="form-input" value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="hint-box">No opportunities are in this stage.</div>
      )}
      {hasLost && <div className="hint-box">Lost opportunities can't go to the won stage, so it isn't offered.</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={blocked ? 'btn btn-disabled' : 'btn btn-primary'}
          disabled={blocked}
          onClick={() => {
            store.removeStage(idx, deals.length ? target : undefined);
            onClose();
          }}
        >
          Remove stage
        </button>
      </div>
    </Modal>
  );
}

/** The built-in fields of each record type, listed next to the custom ones. */
const STANDARD_FIELDS: Record<CustomFieldEntity, string[]> = {
  deal: ['Company', 'Contacts', 'Owner', 'Opportunity value', 'Currency', 'Closing date', 'Funnel', 'Source', 'Discovery notes'],
  company: ['Name', 'Industry', 'HQ', 'Team size', 'Source', 'Owner'],
  contact: ['Full name', 'Role', 'Company', 'Role in the decision', 'Email', 'Phone', 'LinkedIn', 'Owner'],
};
const ENTITIES: { k: CustomFieldEntity; label: string; one: string; desc: string }[] = [
  { k: 'deal', label: 'Opportunities', one: 'opportunity', desc: 'Shown on the opportunity record and in the New opportunity form.' },
  { k: 'company', label: 'Companies', one: 'company', desc: 'Shown on the company record.' },
  { k: 'contact', label: 'Contacts', one: 'contact', desc: 'Shown on the contact record and in the New contact form.' },
];
const TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((t) => [t.value, t.label])) as Record<string, string>;

/** Custom fields per record type (CD-15). Owners and admins change them; members see the list. */
function FieldsTab() {
  const { s, set, canEditFields } = useStore();
  return (
    <>
      {!canEditFields && <span className="ws-block-desc">Only owners and admins can add or change custom fields. You can fill them in on each record.</span>}
      {ENTITIES.map((ent) => {
        const fields = customFieldsOf(s, ent.k);
        return (
          <Block
            key={ent.k}
            title={ent.label}
            desc={ent.desc}
            actions={
              canEditFields && (
                <button type="button" className="btn-plain" onClick={() => set((x) => ({ fieldOpen: true, newField: { ...x.newField, entity: ent.k } }))}>
                  New {ent.one} field
                </button>
              )
            }
          >
            <Rows testId={'fields-' + ent.k}>
              <Row label="Standard fields" hint="Always there, can't be removed">
                <span className="ws-chips" style={{ justifyContent: 'flex-end', maxWidth: 420 }}>
                  {STANDARD_FIELDS[ent.k].map((f) => (
                    <span key={f} className="ws-chip">
                      {f}
                    </span>
                  ))}
                </span>
              </Row>
              {fields.length === 0 && <Row label="Custom fields" hint="No custom fields yet." />}
              {fields.map((fl, i) => (
                <FieldDefRow key={fl.id} field={fl} first={i === 0} last={i === fields.length - 1} />
              ))}
            </Rows>
          </Block>
        );
      })}
    </>
  );
}

const REQUIRED_OPTIONS = [
  { value: 'optional', label: 'Optional' },
  { value: 'required', label: 'Required' },
] as const;

function FieldDefRow({ field: fl, first, last }: { field: CustomFieldDef; first: boolean; last: boolean }) {
  const { canEditFields, updateCustomField, moveCustomField, deleteCustomField } = useStore();
  const [editing, setEditing] = useState<{ id?: string; label: string }[] | null>(null);
  const entityLabel = { deal: 'opportunity', company: 'company', contact: 'contact' }[fl.entity];
  const onDelete = () => {
    const message = `It disappears from every ${entityLabel}, from the ${entityLabel} forms and from CSV exports. Values already entered are kept in the records but no longer shown, and the field can't be brought back from here.`;
    void askConfirm({ title: `Delete the field "${fl.label}"?`, message, confirmLabel: 'Delete', danger: true }).then((ok) => ok && deleteCustomField(fl.id));
  };
  const saveOptions = () => {
    const options = (editing ?? []).map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
    if (!options.length) return;
    updateCustomField(fl.id, { options });
    setEditing(null);
  };
  const typeLine = [TYPE_LABEL[fl.type] ?? fl.type, fl.type === 'select' && !editing ? fl.options.map((o) => o.label).join(' · ') : ''].filter(Boolean).join(' · ');
  return (
    <div className="ws-row" data-testid="custom-field" style={{ alignItems: 'flex-start' }}>
      <div className="ws-row-text">
        {canEditFields ? (
          <GhostInput aria-label="Field name" value={fl.label} onChange={(e) => updateCustomField(fl.id, { label: e.target.value })} style={{ fontSize: 13.5, fontWeight: 600, padding: '2px 6px', margin: '0 -6px', maxWidth: 280 }} />
        ) : (
          <span className="ws-row-label">{fl.label}</span>
        )}
        <span className="ws-row-hint">{typeLine}</span>
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6 }}>
            <span className="ws-row-hint">Renaming an option keeps it on every record. An option in use can't be removed.</span>
            {editing.map((o, i) => (
              <div key={o.id ?? 'new' + i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <GhostInput className="ghost-sm" aria-label="Option" value={o.label} onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} style={{ width: 220 }} />
                <RemoveButton title="Remove option" onClick={() => setEditing(editing.filter((_, j) => j !== i))} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-plain" style={{ fontSize: 12 }} onClick={() => setEditing([...editing, { label: '' }])}>
                Add option
              </button>
              <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={saveOptions}>
                Save options
              </button>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="ws-row-control">
        <Segmented label={`${fl.label}: required or optional`} value={fl.required ? 'required' : 'optional'} options={REQUIRED_OPTIONS} disabled={!canEditFields} onChange={(v) => updateCustomField(fl.id, { required: v === 'required' })} />
        {canEditFields && (
          <>
            {fl.type === 'select' && !editing && (
              <button type="button" className="btn-plain" style={{ fontSize: 12.5, padding: '6px 11px' }} onClick={() => setEditing(fl.options.map((o) => ({ ...o })))}>
                Edit options
              </button>
            )}
            <MoveButton dir="up" label="Move up" disabled={first} onClick={() => moveCustomField(fl.id, -1)} />
            <MoveButton dir="down" label="Move down" disabled={last} onClick={() => moveCustomField(fl.id, 1)} />
            <button type="button" className="btn-danger-quiet" style={{ fontSize: 12.5, padding: '6px 11px' }} onClick={onDelete}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const BONUS_TRIGGERS = [
  { value: 'On contract signed', label: 'On contract signed' },
  { value: 'When fully billed', label: 'When fully billed' },
] as const;

/**
 * Sales bonus rules (CD-17), saved in the workspace. Only owners and admins see this tab; the
 * API returns 403 to members. Overview computes each salesperson's bonuses from these rules.
 */
function BonusesTab() {
  const { s, setBonusTrigger, setBonusRule } = useStore();
  const symbol = currencySymbol(curOf(s));
  const rules = s.bonusRules ?? {};
  const people = salesPeople(s).filter((p) => s.team.some((m) => m.status === 'Active' && m.id === p.value));
  return (
    <>
      <Rows>
        <Row label="Bonus earned" hint="When a won opportunity counts toward a bonus">
          <Segmented label="Bonus earned" value={s.bonusTrigger as (typeof BONUS_TRIGGERS)[number]['value']} options={BONUS_TRIGGERS} onChange={(v) => setBonusTrigger(v)} />
        </Row>
      </Rows>
      <Block
        title="Rules"
        desc={`The rate applies to the net value of each won opportunity. Below the minimum, the flat amount is paid instead. The minimum and the flat amount are in ${s.workspace.currency}; opportunities in another currency earn the rate only. Only owners and admins see these rules and the bonus figures on Overview.`}
      >
        <Table
          cols={[{ label: 'Salesperson' }, { label: 'Rate %', align: 'num' }, { label: `Minimum (${symbol})`, align: 'num' }, { label: `Flat under min (${symbol})`, align: 'num' }]}
          minWidth={560}
          empty={people.length ? undefined : 'No active salespeople yet.'}
        >
          {people.map((p) => {
            const r = rules[p.value] ?? { rate: '', floor: '', fixed: '' };
            // A refused number stays in its field with a red message under it and is not saved (CD-479 QA).
            const bad = bonusRuleProblems(r);
            const field = (key: keyof BonusRule, label: string, width: number) => (
              <td className="num">
                <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <input
                    className="form-input"
                    aria-label={`${label} for ${p.label}`}
                    inputMode="decimal"
                    placeholder="0"
                    aria-invalid={!!bad[key] || undefined}
                    value={r[key]}
                    onChange={(e) => setBonusRule(p.value, key, e.target.value)}
                    style={{ width, textAlign: 'right', padding: '7px 10px' }}
                  />
                  {bad[key] && (
                    <span className="ws-row-error" role="alert" data-testid="bonus-error" style={{ maxWidth: 200, textAlign: 'right' }}>
                      {bad[key]}
                    </span>
                  )}
                </span>
              </td>
            );
            return (
              <tr key={p.value} data-testid="bonus-rule">
                <td>
                  <b>{p.label}</b>
                </td>
                {field('rate', 'Rate', 72)}
                {field('floor', 'Minimum', 100)}
                {field('fixed', 'Flat amount', 100)}
              </tr>
            );
          })}
        </Table>
      </Block>
    </>
  );
}
