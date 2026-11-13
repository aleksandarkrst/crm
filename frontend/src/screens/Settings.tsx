import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { askConfirm } from '../components/ConfirmDialog';
import { FieldRow, GhostInput, GhostSelect, Modal, ModalHeader, RemoveButton, Switch } from '../components/ui';
import { Icon } from '../components/icons';
import { Screen } from '../components/Layout';
import { MODULES, WORKSPACE_MODULES } from '../components/modules';
import { paths } from '../lib/paths';
import { canManageTemplates } from '../store/documents';
import { ACTIVITIES, CHANNEL_LABELS, CHANNELS, CURRENCIES, DOCS, FIELD_TYPES } from '../store/seed';
import { bonusRuleProblems } from '../store/dealMath';
import { currencySymbol, curOf, customFieldsOf, memberLabels, salesPeople } from '../store/selectors';

import type { BonusRule, CustomFieldDef, Stage, Workspace } from '../store/types';
import type { CustomFieldEntity } from '../lib/api';
import { useStore } from '../store/store';
import { TemplatesTab } from './DocumentTemplates';
import { EmployeesTab } from './settings/EmployeesTab';
import { CompanyCard, COUNTRY_OPTIONS } from './settings/CompanyCard';
import { TimeOffTab } from './settings/TimeOffSettings';
import { ApprovalsTab, HolidaysTab } from './settings/WorkforceSettings';
import { ProjectHierarchyTab, ProjectTypesTab } from './settings/ProjectTypesTab';
import { TechniciansTab } from './settings/TechniciansTab';
import { WorkspaceInfo } from './settings/WorkspaceInfo';
import { RolesTab } from './settings/RolesTab';
import { NotificationsTab } from './settings/NotificationsTab';
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
    <>
      <span style={{ display: 'flex', alignItems: 'center', border: `1px solid ${bad ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 7, background: 'var(--white)', padding: '0 10px 0 0' }}>
        <input
          data-testid={testId}
          type="number"
          disabled={disabled}
          min={1}
          max={365}
          step={1}
          value={text}
          placeholder={placeholder}
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
          style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', padding: '9px 4px 9px 10px', fontSize: 13, color: 'var(--ink)', textTransform: 'none', letterSpacing: 0 }}
        />
        <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-2)', letterSpacing: 0 }}>days</span>
      </span>
      {bad && (
        <span className="emp-error" role="alert" data-testid={`${testId}-error`} style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
          {TARGET_DAYS_PROBLEM}
        </span>
      )}
    </>
  );
}

/**
 * The sections of Settings (CD-280), grouped by module in the left nav. Each has its own route
 * (`/settings/<k>`). The design names General, Members, Funnels, Project types and Cost rates; the
 * other sections the app already had keep their content in the group they belong to. Cost rates
 * comes when there are rates to set (a Linear follow-up).
 */
const TABS = [
  { k: 'workspace', group: 'Workspace', label: 'General', description: 'Name, currency, time zone, fiscal year and the language of customer emails.' },
  { k: 'modules', group: 'Workspace', label: 'Modules', description: 'The modules this workspace uses. A module that is off shows as "Not in this workspace" in the module switcher; its data is kept.' },
  { k: 'roles', group: 'Workspace', label: 'Roles & permissions', description: 'What owners, admins and members can do.' },
  { k: 'notifications', group: 'Workspace', label: 'Notifications', description: 'The emails you get from this workspace.' },
  { k: 'funnel', group: 'CRM', label: 'Funnels', description: 'The stages opportunities move through, with their activities and to-dos.' },
  { k: 'templates', group: 'CRM', label: 'Document templates', description: 'Templates hold the fixed story; merge fields pull the rest from the opportunity when someone generates a document.' },
  { k: 'fields', group: 'CRM', label: 'Customize fields', description: 'Custom fields show on opportunities, companies and contacts, in their create forms and in CSV exports. Everyone can fill them in.' },
  { k: 'bonuses', group: 'CRM', label: 'Sales bonuses', description: 'How salespeople earn bonuses on won opportunities.' },
  {
    k: 'project-hierarchy',
    group: 'Projects',
    label: 'Project hierarchy',
    description: 'What this workspace calls projects and tasks, e.g. Job and Activity. The names show everywhere: the sidebar, pages, buttons and emails.',
  },
  {
    k: 'project-types',
    group: 'Projects',
    label: 'Project types',
    description:
      "A project type is a set of stages for one kind of project, like a funnel in the CRM. Each project is on one board: it shows in that board's columns, and its tasks are grouped by the same stages in the plan. Complete and Cancel are always available and are not stages.",
  },
  { k: 'technicians', group: 'Projects', label: 'Technicians', description: 'What each person can be given: project tasks, work orders or both.' },
  // Workforce's settings, grouped by the modules it was split into (CD-521). They stay here, not in the modules.
  { k: 'employees', group: 'Employees', label: 'Employees', description: 'What new employees start with and what employees may change themselves.' },
  { k: 'approvals', group: 'Timesheet', label: 'Approvals', description: 'When timesheets are due, how managers approve them and who gets reminded.' },
  { k: 'timeoff', group: 'Time off', label: 'Policies', description: 'Vacation policies: how many days employees get per year, extra days by work experience, and how unused days carry over.' },
  { k: 'holidays', group: 'Time off', label: 'Holidays', description: 'Days nobody is expected to work. They show in the Timesheet and move deadlines.' },
] as const;
type Tab = (typeof TABS)[number]['k'];
const GROUPS = ['Workspace', 'CRM', 'Projects', 'Employees', 'Timesheet', 'Time off'] as const;

export function Settings() {
  const { tab = 'workspace' } = useParams();
  const navigate = useNavigate();
  const { set, session, flash, canEditFields, canSeeBonuses, canEditWorkspace } = useStore();
  const terms = useTerms();
  // "Project types" follows what the workspace calls projects (CD-143).
  const labelOf = (t: (typeof TABS)[number]) => (t.k === 'project-types' ? `${terms.Project} types` : t.label);
  const [params] = useSearchParams();
  // Members moved to Employees → Team (CD-521): old links and bookmarks land there, `?invite=1` included.
  if (tab === 'team') return <Navigate to={paths.team(params.get('invite') === '1')} replace />;
  // Members don't see the workspace settings at all (CD-523): any settings URL goes home, except
  // Notifications (your own emails, linked from the digest), which is on Personal preferences for them.
  if (!canEditWorkspace) return <Navigate to={tab === 'notifications' ? paths.myNotifications : '/'} replace />;
  // Settings → Employees (CD-215) and the sales bonus rules (CD-17) are for owners and admins.
  const tabs = TABS.filter((t) => (t.k !== 'bonuses' || canSeeBonuses) && (!['employees', 'approvals', 'holidays', 'timeoff'].includes(t.k) || canEditWorkspace) && (t.k !== 'technicians' || canEditWorkspace));
  if (!tabs.some((t) => t.k === tab)) return <Navigate to={paths.settings()} replace />;
  const current = tab as Tab;
  const section = tabs.find((t) => t.k === current)!;

  const action =
    current === 'templates'
      ? { label: 'New template', onClick: () => (canManageTemplates(session.tenant.role) ? set({ templateOpen: true, templateEditing: null }) : flash('Only owners and admins can add templates')), meta: '' }
      : current === 'fields'
        ? canEditFields
          ? { label: 'New field', onClick: () => set({ fieldOpen: true }), meta: '' }
          : null
        : null;

  return (
    <Screen title="Settings">
      <div className="settings-frame">
        <nav className="settings-nav" aria-label="Settings" data-testid="settings-nav">
          {GROUPS.filter((g) => tabs.some((t) => t.group === g)).map((g) => (
            <div key={g} className="settings-nav-group" data-group={g}>
              <span className="caps-muted settings-nav-label">{g}</span>
              {tabs
                .filter((t) => t.group === g)
                .map((t) => (
                  <button key={t.k} type="button" className={'settings-nav-item' + (t.k === current ? ' on' : '')} aria-current={t.k === current ? 'page' : undefined} data-section={t.k} onClick={() => navigate(paths.settings(t.k))}>
                    {labelOf(t)}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="settings-content" data-testid="settings-content">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 320px', minWidth: 0 }}>
              <h2 className="settings-title">{labelOf(section)}</h2>
              <span className="settings-description">{section.description}</span>
            </div>
            {action && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
                {action.meta && <span style={{ fontSize: 12.5, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{action.meta}</span>}
                {'soon' in action && action.soon ? (
                  <ComingSoonButton label={action.label} />
                ) : (
                  <button type="button" className="btn btn-primary" style={{ flex: '0 0 auto' }} onClick={action.onClick}>
                    {action.label}
                  </button>
                )}
              </span>
            )}
          </div>

          {current === 'workspace' && <WorkspaceInfo />}
          {current === 'workspace' && <WorkspaceTab />}
          {current === 'workspace' && <CompanyCard />}
          {current === 'workspace' && <GettingStartedCard />}
          {current === 'modules' && <ModulesTab />}
          {current === 'roles' && <RolesTab />}
          {current === 'employees' && <EmployeesTab />}
          {current === 'approvals' && <ApprovalsTab />}
          {current === 'holidays' && <HolidaysTab />}
          {current === 'timeoff' && <TimeOffTab />}
          {current === 'funnel' && <FunnelBuilder />}
          {current === 'project-hierarchy' && <ProjectHierarchyTab />}
          {current === 'project-types' && <ProjectTypesTab />}
          {current === 'technicians' && <TechniciansTab />}
          {current === 'templates' && <TemplatesTab />}
          {current === 'fields' && <FieldsTab />}
          {current === 'bonuses' && <BonusesTab />}
          {current === 'notifications' && <NotificationsTab />}
        </div>
      </div>
    </Screen>
  );
}

/** A primary action whose feature has no backend yet: shown, disabled, and labelled as such. */
function ComingSoonButton({ label }: { label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, flex: '0 0 auto' }}>
      <span className="caps-muted">Coming soon</span>
      <button type="button" className="btn btn-disabled" disabled title={`${label}: coming soon`}>
        {label}
      </button>
    </span>
  );
}

const CUSTOMER_EMAIL_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'sr', label: 'Srpski' },
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((label, i) => ({ value: String(i + 1), label }));
/** Every IANA time zone the browser knows. */
const TIME_ZONES = (() => {
  const zones = Intl.supportedValuesOf('timeZone');
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
})();

/** Saved per workspace. Owners and admins edit; members see the values read-only. */
function WorkspaceTab() {
  const { s, setWorkspace, canEditWorkspace } = useStore();
  const w = s.workspace;
  const ro = !canEditWorkspace;
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 18 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Workspace
      </div>
      <FieldRow label="Currency">
        <GhostSelect value={w.currency} disabled={ro} onChange={(e) => setWorkspace({ currency: e.target.value })} options={CURRENCIES} />
      </FieldRow>
      <FieldRow label="Time zone">
        <GhostSelect value={w.timezone} disabled={ro} onChange={(e) => setWorkspace({ timezone: e.target.value })} options={TIME_ZONES} />
      </FieldRow>
      <FieldRow label="Country">
        <GhostSelect aria-label="Country" value={w.country ?? ''} disabled={ro} onChange={(e) => setWorkspace({ country: e.target.value || null })} options={COUNTRY_OPTIONS} data-testid="workspace-country" />
      </FieldRow>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: '2px 0 0' }}>Serbia turns on the vacation decision document (rešenje) sent when vacation is approved.</span>
      <FieldRow label="Fiscal year starts">
        <GhostSelect value={String(w.fiscalMonth)} disabled={ro} onChange={(e) => setWorkspace({ fiscalMonth: Number(e.target.value) })} options={MONTHS} />
      </FieldRow>
      <FieldRow label="Customer email language">
        <GhostSelect
          aria-label="Customer email language"
          value={w.customerEmailLanguage}
          disabled={ro}
          onChange={(e) => setWorkspace({ customerEmailLanguage: e.target.value as Workspace['customerEmailLanguage'] })}
          options={CUSTOMER_EMAIL_LANGUAGES}
        />
      </FieldRow>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: '2px 0 0' }}>Language of the fixed text in emails to customers, such as meeting minutes.</span>
      <FieldRow label="Projects">
        <span data-testid="auto-create-projects" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <Switch on={w.autoCreateProjects} disabled={ro} onClick={() => setWorkspace({ autoCreateProjects: !w.autoCreateProjects })} label="Create a project when an opportunity is won" />
          <span style={{ fontSize: 13 }}>Create a project when an opportunity is won</span>
        </span>
      </FieldRow>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: '2px 0 0' }}>The project takes the opportunity's title and company, the first project type, and the opportunity owner as lead, who gets an email. Once per opportunity.</span>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 8 }}>
        {ro ? 'Only owners and admins can change the workspace settings.' : 'Changes are saved as you make them.'}
      </span>
    </div>
  );
}

/**
 * Settings → Workspace → Modules (CD-318, moved out of General): one row per module with its
 * description and a switch. Owners and admins change them; members see them read-only. A module
 * that is off shows as "Not in this workspace" in the module switcher; its data is kept.
 */
function ModulesTab() {
  const { s, setWorkspace, canEditWorkspace } = useStore();
  const w = s.workspace;
  const ro = !canEditWorkspace;
  return (
    <div className="card" data-testid="workspace-modules" style={{ padding: '4px 18px' }}>
      {WORKSPACE_MODULES.map((id) => {
        const on = w.modules.includes(id);
        const def = MODULES.find((m) => m.id === id);
        const name = def?.name ?? id;
        const built = !!def && def.screens.length > 0;
        return (
          <div key={id} data-module={id} className="module-row">
            <span className="module-row-icon" aria-hidden>
              {def && <Icon name={def.icon} size={18} />}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                {def?.description}
                {!built && ' · Coming soon'}
              </span>
            </span>
            <Switch on={on} disabled={ro} label={`${name} in this workspace`} onClick={() => setWorkspace({ modules: WORKSPACE_MODULES.filter((m) => (m === id ? !on : w.modules.includes(m))) })} />
          </div>
        );
      })}
      <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, padding: '12px 0 10px' }}>
        {ro ? 'Only owners and admins can turn modules on or off.' : 'Changes are saved as you make them.'}
      </span>
    </div>
  );
}

/** Getting started (CD-68) for owners and admins: show the checklist again, load or remove sample data. */
function GettingStartedCard() {
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
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }} data-testid="sample-data-card">
      <div className="card-title">Getting started and sample data</div>
      <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
        {ob.sampleData.loaded
          ? `Sample data is loaded: ${c.company} companies, ${c.contact} contacts, ${c.product} products and ${c.deal} opportunities. Removing it deletes exactly those records; your own stay.`
          : 'Sample data adds a few companies, contacts, products and opportunities (with tasks) to look around with. It is marked, so you can remove exactly those records again in one click.'}
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ob.sampleData.loaded ? (
          <button type="button" className="btn-outline" disabled={busy} onClick={run(removeSampleData)}>
            Remove sample data
          </button>
        ) : (
          <button type="button" className="btn-outline" disabled={busy} onClick={run(loadSampleData)}>
            Load sample data
          </button>
        )}
        {ob.dismissed && !ob.complete && (
          <button type="button" className="btn-outline" disabled={busy} onClick={run(() => setOnboardingDismissed(false))}>
            Show the getting-started checklist
          </button>
        )}
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Settings → CRM → Funnels (CD-318, laid out like Project types): the funnels on the left, the
 * selected one on the right with its name, how they buy, its stages (each opens for its activity,
 * channel, document, win probability and to-dos), a preview of the stage bar and Delete funnel.
 * Picking a funnel here also makes it the Pipeline's funnel, as before.
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="funnel-builder">
      {!editable && (
        <span data-testid="funnels-read-only" style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Only owners and admins can change funnels, stages and their to-dos.
        </span>
      )}

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 240px', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.values(s.funnels).map((f) => (
            <button key={f.id} type="button" className={'choice' + (f.id === funnel.id ? ' on' : '')} data-testid="funnel-choice" onClick={() => select(f.id)}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{f.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {plural(f.stages.length, 'stage')} · {plural(dealsIn(f.id), 'opportunity', 'opportunities')}
              </span>
            </button>
          ))}
          {editable && (
            <button type="button" className="btn-dashed" data-testid="new-funnel" onClick={() => set({ personaOpen: true, personaBase: funnel.id })}>
              New funnel
            </button>
          )}
        </div>

        <div className="card" data-testid="funnel-card" style={{ flex: '999 1 460px', minWidth: 0, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <label className="form-label">
              Funnel name
              <input className="form-input" value={funnel.label} disabled={!editable} onChange={(e) => store.patchFunnel(funnel.id, { label: e.target.value })} />
            </label>
            <label className="form-label">
              How they buy
              <input className="form-input" value={funnel.note} disabled={!editable} placeholder="Who decides, how long it takes, what slows it down" onChange={(e) => store.patchFunnel(funnel.id, { note: e.target.value })} />
            </label>
            <label className="form-label">
              Default target days
              <TargetDaysInput testId="funnel-target-days" disabled={!editable} value={funnel.targetDays ?? null} placeholder="No target" onSave={(v) => store.patchFunnel(funnel.id, { targetDays: v })} />
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="caps">Stages</span>
            {stages.map((st, idx) => (
              <FunnelStageRow
                key={st.id}
                idx={idx}
                stage={st}
                deals={s.leads.filter((l) => l.stage === st.id).length}
                editable={editable}
                open={open === st.id}
                first={idx === 0}
                last={idx === stages.length - 1}
                removable={!(st.won && wonCount === 1) && stages.length > 1}
                onToggle={() => setOpen(open === st.id ? null : st.id)}
                onRemove={() => setRemoving(idx)}
              />
            ))}
            {editable && (
              <button type="button" className="btn-dashed" style={{ alignSelf: 'flex-start', whiteSpace: 'nowrap' }} data-testid="add-stage" onClick={store.addStage}>
                New stage
              </button>
            )}
          </div>

          {/* One approval rule for the whole funnel, below its stages (CD-120). */}
          <div className="card" data-testid="funnel-approval" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'none' }}>
            <span className="caps">Proposal approval</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <Switch on={funnel.proposalApproval} disabled={!editable} label="Proposals in this funnel need approval before they are sent" onClick={() => store.patchFunnel(funnel.id, { proposalApproval: !funnel.proposalApproval })} />
              Proposals in this funnel need approval before they are sent
            </span>
            {funnel.proposalApproval && (
              <label className="form-label" style={{ maxWidth: 360 }}>
                Approver
                <select className="form-input" data-testid="funnel-approver" disabled={!editable} style={{ padding: '9px 10px' }} value={funnel.approverId ?? ''} onChange={(e) => store.patchFunnel(funnel.id, { approverId: e.target.value || null })}>
                  <option value="">Pick the approver</option>
                  {approvers.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                {!funnel.approverId && (
                  <span style={{ fontSize: 12, color: 'var(--warn)', textTransform: 'none', letterSpacing: 0 }}>
                    Pick the approver to switch approval on.
                  </span>
                )}
              </label>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>One rule for the whole funnel, not per stage. The approver gets an email and a task when approval is requested; owners and admins can approve too.</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="caps">Preview</span>
            <div className="stage-bar" data-testid="funnel-preview">
              {stages.map((st, i) => (
                <button key={st.id} type="button" className={'stage-chev' + (i === 0 ? ' current' : '')} disabled>
                  {st.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-2)' }}>
            <span>{dealCount ? `${plural(dealCount, 'opportunity', 'opportunities')} in this funnel` : 'No opportunities in this funnel yet'}</span>
            {editable && dealCount === 0 && Object.keys(s.funnels).length > 1 && (
              <button type="button" className="btn btn-secondary" style={{ marginLeft: 'auto', padding: '6px 10px', fontSize: 12 }} onClick={() => void store.deleteFunnel(funnel.id)}>
                Delete funnel
              </button>
            )}
          </div>
        </div>
      </div>

      {removing !== null && stages[removing] && <RemoveStageModal idx={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

/**
 * One stage of the funnel: a row with its number, name, deals, and the move and delete buttons
 * (like a project type's stage); the chevron opens its activity, channel, document on entry, win
 * probability and to-dos.
 */
function FunnelStageRow({
  idx,
  stage: st,
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
  const arrow = (d: string) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
  return (
    <div data-testid="funnel-stage" data-open={open || undefined} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '6px 8px 6px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', width: 18 }}>{idx + 1}</span>
        <input className="ghost ghost-sm" value={st.name} disabled={!editable} aria-label="Stage name" onChange={(e) => store.editStage(idx, 'name', e.target.value)} style={{ flex: 1, minWidth: 0, fontWeight: 500 }} />
        {st.won && (
          <span className="caps-muted funnel-stage-meta" title="Opportunities are won by reaching this stage">
            Won stage
          </span>
        )}
        <span className="funnel-stage-meta" style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
          {plural(deals, 'opportunity', 'opportunities')}
        </span>
        {editable && (
          <>
            <button type="button" className="icon-btn icon-btn-plain" aria-label="Move up" title="Move up" disabled={first} style={{ opacity: first ? 0.35 : 1 }} onClick={() => store.moveStage(idx, -1)}>
              {arrow('M6 15l6-6 6 6')}
            </button>
            <button type="button" className="icon-btn icon-btn-plain" aria-label="Move down" title="Move down" disabled={last} style={{ opacity: last ? 0.35 : 1 }} onClick={() => store.moveStage(idx, 1)}>
              {arrow('M6 9l6 6 6-6')}
            </button>
            <button type="button" className="icon-btn" aria-label="Remove stage" title={removable ? 'Remove stage' : st.won ? 'The won stage stays' : 'A funnel needs at least one stage'} disabled={!removable} style={{ opacity: removable ? 1 : 0.35 }} onClick={onRemove}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </>
        )}
        <button type="button" className="icon-btn icon-btn-plain" aria-label={open ? 'Hide stage details' : 'Show stage details'} aria-expanded={open} data-testid="funnel-stage-toggle" onClick={onToggle}>
          {arrow(open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6')}
        </button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '10px 4px 8px 26px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
            <label className="form-label">
              Activity
              <select className="form-input" disabled={!editable} style={{ padding: '9px 10px' }} value={st.activity} onChange={(e) => store.editStage(idx, 'activity', e.target.value)}>
                {ACTIVITIES.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Channel
              <select className="form-input" disabled={!editable} style={{ padding: '9px 10px' }} value={st.channel} onChange={(e) => store.editStage(idx, 'channel', e.target.value)}>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Document on entry
              <select className="form-input" disabled={!editable} style={{ padding: '9px 10px' }} value={st.doc} onChange={(e) => store.editStage(idx, 'doc', e.target.value)}>
                {DOCS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Win probability
              <span style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--white)', padding: '0 10px 0 0' }}>
                <input type="number" disabled={!editable} min={0} max={100} step={5} value={st.prob} onChange={(e) => store.editProb(idx, e.target.value)} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', padding: '9px 4px 9px 10px', fontSize: 13, color: 'var(--ink)', textTransform: 'none', letterSpacing: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-2)', letterSpacing: 0 }}>%</span>
              </span>
            </label>
            {!st.won && (
              <>
                <label className="form-label">
                  Stage owner
                  <select className="form-input" data-testid="stage-owner-select" disabled={!editable} style={{ padding: '9px 10px' }} value={st.ownerId ?? ''} onChange={(e) => store.setStageRule(idx, { ownerId: e.target.value || null })}>
                    <option value="">The opportunity's owner</option>
                    {members.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Target days
                  <TargetDaysInput testId="stage-target-days" disabled={!editable} value={st.targetDays ?? null} placeholder="Funnel default" onSave={(v) => store.setStageRule(idx, { targetDays: v })} />
                </label>
              </>
            )}
          </div>
          {!st.won && (
            // Advance gates (CD-363): what has to be done before an opportunity moves on from this stage.
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="caps">Before moving on</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <Switch on={st.gateTodos} disabled={!editable} label="All to-dos must be done" onClick={() => store.setStageRule(idx, { gateTodos: !st.gateTodos })} />
                All to-dos must be done
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <Switch on={st.gateDocs} disabled={!editable} label="Needs documentation complete" onClick={() => store.setStageRule(idx, { gateDocs: !st.gateDocs })} />
                Needs documentation complete
              </span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span className="caps">To-do</span>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {st.checklist.map((c, gi) => (
                <span key={st.checklistIds[gi] ?? gi} className="gate-chip">
                  <input value={c} disabled={!editable} onChange={(e) => store.renameGate(idx, gi, e.target.value)} style={{ border: 0, outline: 0, background: 'transparent', fontSize: 12, color: 'var(--ink)', width: Math.max(9, Math.min(34, c.length + 1)) + 'ch' }} />
                  {editable && (
                    <button type="button" className="pill-x" title="Delete to-do" onClick={() => store.removeGate(idx, gi)}>
                      ×
                    </button>
                  )}
                </span>
              ))}
              {editable && (
                <button type="button" className="btn-dashed" style={{ borderRadius: 20, padding: '6px 11px', fontSize: 12 }} onClick={() => store.addGate(idx)}>
                  + to-do
                </button>
              )}
            </div>
          </div>
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
const STANDARD_FIELDS: Record<CustomFieldEntity, string> = {
  deal: 'Company, Contacts, Owner, Opportunity value, Currency, Closing date, Funnel, Source, discovery notes',
  company: 'Name, Industry, HQ, Team size, Source, Owner',
  contact: 'Full name, Role, Company, Role in the decision, Email, Phone, LinkedIn, Owner',
};
const ENTITIES: { k: CustomFieldEntity; label: string; desc: string }[] = [
  { k: 'deal', label: 'Opportunities', desc: 'Shown on the opportunity record and in the New opportunity form.' },
  { k: 'company', label: 'Companies', desc: 'Shown on the company record.' },
  { k: 'contact', label: 'Contacts', desc: 'Shown on the contact record and in the New contact form.' },
];
const TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((t) => [t.value, t.label])) as Record<string, string>;

/** Custom fields per record type (CD-15). Owners and admins change them; members see the list. */
function FieldsTab() {
  const { s, set, canEditFields } = useStore();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {!canEditFields && <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Only owners and admins can add or change custom fields. You can fill them in on each record.</span>}
      {ENTITIES.map((ent) => {
        const fields = customFieldsOf(s, ent.k);
        return (
          <div key={ent.k} className="card" data-testid={'fields-' + ent.k} style={{ overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 220 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{ent.label}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{ent.desc}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>Standard fields: {STANDARD_FIELDS[ent.k]}</span>
              </div>
              {canEditFields && (
                <button type="button" className="btn-plain" onClick={() => set((x) => ({ fieldOpen: true, newField: { ...x.newField, entity: ent.k } }))}>
                  + New {ent.label.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')} field
                </button>
              )}
            </div>
            {fields.length === 0 && <div style={{ padding: '13px 18px', fontSize: 12.5, color: 'var(--muted)' }}>No custom fields yet.</div>}
            {fields.map((fl, i) => (
              <FieldDefRow key={fl.id} field={fl} first={i === 0} last={i === fields.length - 1} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function FieldDefRow({ field: fl, first, last }: { field: CustomFieldDef; first: boolean; last: boolean }) {
  const { canEditFields, updateCustomField, moveCustomField, deleteCustomField } = useStore();
  const [editing, setEditing] = useState<{ id?: string; label: string }[] | null>(null);
  const pill = (on: boolean) => ({ cursor: canEditFields ? 'pointer' : 'default', border: `1px solid ${on ? '#14503C' : '#E2E8E4'}`, background: on ? '#E7F2EE' : '#FFFFFF', color: on ? '#14503C' : '#475750', fontSize: 12, padding: '6px 11px', borderRadius: 6 });
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
  return (
    <div data-testid="custom-field" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '11px 18px', borderBottom: '1px solid var(--divider-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {canEditFields ? (
          <GhostInput aria-label="Field name" value={fl.label} onChange={(e) => updateCustomField(fl.id, { label: e.target.value })} style={{ fontSize: 13.5, fontWeight: 600, width: 200 }} />
        ) : (
          <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 150 }}>{fl.label}</span>
        )}
        <span style={{ fontSize: 12.5, color: 'var(--text-2)', minWidth: 80 }}>{TYPE_LABEL[fl.type] ?? fl.type}</span>
        {fl.type === 'select' && !editing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fl.options.map((o) => o.label).join(' · ')}</span>}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" disabled={!canEditFields} onClick={() => updateCustomField(fl.id, { required: !fl.required })} style={pill(fl.required)}>
            {fl.required ? 'Required' : 'Optional'}
          </button>
          {canEditFields && (
            <>
              {fl.type === 'select' && !editing && (
                <button type="button" className="btn-plain" style={{ fontSize: 12 }} onClick={() => setEditing(fl.options.map((o) => ({ ...o })))}>
                  Edit options
                </button>
              )}
              <button type="button" title="Move up" disabled={first} onClick={() => moveCustomField(fl.id, -1)} style={{ ...pill(false), opacity: first ? 0.4 : 1 }}>
                ↑
              </button>
              <button type="button" title="Move down" disabled={last} onClick={() => moveCustomField(fl.id, 1)} style={{ ...pill(false), opacity: last ? 0.4 : 1 }}>
                ↓
              </button>
              <button type="button" onClick={onDelete} style={{ cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--danger)', fontSize: 12, padding: '6px 11px', borderRadius: 6 }}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Renaming an option keeps it on every record. An option in use can't be removed.</span>
          {editing.map((o, i) => (
            <div key={o.id ?? 'new' + i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <GhostInput className="ghost-sm" aria-label="Option" value={o.label} onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} style={{ width: 220 }} />
              <RemoveButton title="Remove option" onClick={() => setEditing(editing.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-plain" style={{ fontSize: 12 }} onClick={() => setEditing([...editing, { label: '' }])}>
              + Add option
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
  );
}

const BONUS_COLS = 'minmax(0,1.6fr) 110px 150px 150px';

/**
 * Sales bonus rules (CD-17), saved in the workspace. Only owners and admins see this tab; the
 * API returns 403 to members. Overview computes each salesperson's bonuses from these rules.
 */
function BonusesTab() {
  const { s, setBonusTrigger, setBonusRule } = useStore();
  const symbol = currencySymbol(curOf(s));
  const rules = s.bonusRules ?? {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>
          Sales bonuses
        </div>
        <FieldRow label="Bonus earned">
          <GhostSelect value={s.bonusTrigger} onChange={(e) => setBonusTrigger(e.target.value)} options={['On contract signed', 'When fully billed']} />
        </FieldRow>
        <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 8 }}>
          Only owners and admins can see these rules and the bonus figures on Overview. A won opportunity earns the rate on its net value; an opportunity under the minimum earns the flat amount instead. The minimum and the flat amount are in {s.workspace.currency}; opportunities in another currency earn the rate only. Changes are saved as you make them.
        </span>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 560 }}>
          <div className="table-head th" style={{ gridTemplateColumns: BONUS_COLS }}>
            <span>Salesperson</span>
            <span>Rate %</span>
            <span>Minimum ({symbol})</span>
            <span>Flat under min ({symbol})</span>
          </div>
          {salesPeople(s)
            .filter((p) => s.team.some((m) => m.status === 'Active' && m.id === p.value))
            .map((p) => {
              const r = rules[p.value] ?? { rate: '', floor: '', fixed: '' };
              // A refused number stays in its field with a red message under it and is not saved (CD-479 QA).
              const bad = bonusRuleProblems(r);
              const field = (key: keyof BonusRule, label: string) => (
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <GhostInput className="ghost-sm" aria-label={`${label} for ${p.label}`} inputMode="decimal" placeholder="0" aria-invalid={!!bad[key] || undefined} value={r[key]} onChange={(e) => setBonusRule(p.value, key, e.target.value)} />
                  {bad[key] && (
                    <span className="subform-hint" role="alert" data-testid="bonus-error" style={{ color: 'var(--danger)', padding: '0 8px' }}>
                      {bad[key]}
                    </span>
                  )}
                </span>
              );
              return (
                <div key={p.value} data-testid="bonus-rule" className="table-row" style={{ gridTemplateColumns: BONUS_COLS, padding: '8px 16px' }}>
                  <span style={{ fontWeight: 600 }}>{p.label}</span>
                  {field('rate', 'Rate')}
                  {field('floor', 'Minimum')}
                  {field('fixed', 'Flat amount')}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
