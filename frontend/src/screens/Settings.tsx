import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FieldRow, GhostInput, GhostSelect, Modal, ModalHeader, RemoveButton, Switch } from '../components/ui';
import { Screen } from '../components/Layout';
import { MODULES, WORKSPACE_MODULES } from '../components/modules';
import { paths } from '../lib/paths';
import { canManageTemplates } from '../store/documents';
import { ACTIVITIES, CHANNEL_LABELS, CHANNELS, CURRENCIES, DOCS, FIELD_TYPES, TEAM_ROLES } from '../store/seed';
import { currencySymbol, curOf, customFieldsOf, funnelOptions, initialsOf, salesPeople } from '../store/selectors';
import type { CustomFieldDef, Workspace } from '../store/types';
import type { CustomFieldEntity } from '../lib/api';
import { useStore } from '../store/store';
import { TemplatesTab } from './DocumentTemplates';
import { EmployeesTab } from './settings/EmployeesTab';
import { ProjectTypesTab } from './settings/ProjectTypesTab';
import { TechniciansTab } from './settings/TechniciansTab';
import { RolesTab } from './settings/RolesTab';
import type { TeamMember } from '../store/types';

/**
 * The sections of Settings (CD-280), grouped by module in the left nav. Each has its own route
 * (`/settings/<k>`). The design names General, Members, Funnels, Project types and Cost rates; the
 * other sections the app already had keep their content in the group they belong to. Cost rates
 * comes when there are rates to set (a Linear follow-up).
 */
const TABS = [
  { k: 'workspace', group: 'Workspace', label: 'General', description: 'Name, currency, time zone and the modules this workspace uses.' },
  { k: 'team', group: 'Workspace', label: 'Members', description: 'Who works in this workspace, their roles and the invitations still open.' },
  { k: 'roles', group: 'Workspace', label: 'Roles & permissions', description: 'What owners, admins and members can do.' },
  { k: 'notifications', group: 'Workspace', label: 'Notifications', description: 'The emails you get from this workspace.' },
  { k: 'funnel', group: 'CRM', label: 'Funnels', description: 'The stages deals move through, with their activities and to-dos.' },
  { k: 'templates', group: 'CRM', label: 'Document templates', description: 'Templates hold the fixed story; merge fields pull the rest from the deal when someone generates a document.' },
  { k: 'fields', group: 'CRM', label: 'Customize fields', description: 'Custom fields show on deals, companies and contacts, in their create forms and in CSV exports. Everyone can fill them in.' },
  { k: 'bonuses', group: 'CRM', label: 'Sales bonuses', description: 'How salespeople earn bonuses on won deals.' },
  {
    k: 'project-types',
    group: 'Projects',
    label: 'Project types',
    description:
      "A project type is a set of stages for one kind of project, like a funnel in the CRM. Each project is on one board: it shows in that board's columns, and its tasks are grouped by the same stages in the plan. Complete and Cancel are always available and are not stages.",
  },
  { k: 'technicians', group: 'Projects', label: 'Technicians', description: 'What each person can be given: project tasks, work orders or both.' },
  { k: 'employees', group: 'Workforce', label: 'Employees', description: 'What new employees start with and what employees may change themselves.' },
] as const;
type Tab = (typeof TABS)[number]['k'];
const GROUPS = ['Workspace', 'CRM', 'Projects', 'Workforce'] as const;

export function Settings() {
  const { tab = 'workspace' } = useParams();
  const navigate = useNavigate();
  const { s, set, session, flash, canEditFields, canSeeBonuses, canEditWorkspace } = useStore();
  // `?invite=1` (Team tab): the Invite dialog opens, e.g. from "Invite a colleague" in a meeting's guests (CD-221).
  const [params] = useSearchParams();
  const [inviteOpen, setInviteOpen] = useState(() => tab === 'team' && params.get('invite') === '1' && session.tenant.role !== 'member');
  // Members don't see the sales bonus rules (CD-17): no tab, and its route goes back to Settings.
  // Settings → Employees (CD-215) is for Admins (workspace owners and admins).
  const tabs = TABS.filter((t) => (t.k !== 'bonuses' || canSeeBonuses) && (t.k !== 'employees' || canEditWorkspace) && (t.k !== 'technicians' || canEditWorkspace));
  if (!tabs.some((t) => t.k === tab)) return <Navigate to={paths.settings()} replace />;
  const current = tab as Tab;
  const section = tabs.find((t) => t.k === current)!;

  const action =
    current === 'templates'
      ? { label: 'New template', onClick: () => (canManageTemplates(session.tenant.role) ? set({ templateOpen: true }) : flash('Only owners and admins can add templates')), meta: '' }
      : current === 'fields'
        ? canEditFields
          ? { label: 'New field', onClick: () => set({ fieldOpen: true }), meta: '' }
          : null
        : current === 'team'
          ? {
              label: 'Invite member',
              onClick: () => (session.tenant.role === 'member' ? flash('Only owners and admins can invite people') : setInviteOpen(true)),
              meta: `${s.team.filter((m) => m.status === 'Active').length} active · ${s.team.filter((m) => m.status === 'Invited').length} invited`,
            }
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
                    {t.label}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="settings-content" data-testid="settings-content">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 320px', minWidth: 0 }}>
              <h2 className="settings-title">{section.label}</h2>
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

          {current === 'workspace' && <WorkspaceTab />}
          {current === 'workspace' && <GettingStartedCard />}
          {current === 'team' && <TeamTab />}
          {current === 'roles' && <RolesTab />}
          {current === 'employees' && <EmployeesTab />}
          {current === 'funnel' && <FunnelBuilder />}
          {current === 'project-types' && <ProjectTypesTab />}
          {current === 'technicians' && <TechniciansTab />}
          {current === 'templates' && <TemplatesTab />}
          {current === 'fields' && <FieldsTab />}
          {current === 'bonuses' && <BonusesTab />}
          {current === 'notifications' && <NotificationsTab />}
        </div>
      </div>
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
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
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Workspace
      </div>
      <FieldRow label="Name">
        <GhostInput value={w.name} disabled={ro} onChange={(e) => setWorkspace({ name: e.target.value })} />
      </FieldRow>
      <FieldRow label="Currency">
        <GhostSelect value={w.currency} disabled={ro} onChange={(e) => setWorkspace({ currency: e.target.value })} options={CURRENCIES} />
      </FieldRow>
      <FieldRow label="Time zone">
        <GhostSelect value={w.timezone} disabled={ro} onChange={(e) => setWorkspace({ timezone: e.target.value })} options={TIME_ZONES} />
      </FieldRow>
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
      <FieldRow label="Modules">
        <span data-testid="workspace-modules" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', padding: '6px 0' }}>
          {WORKSPACE_MODULES.map((id) => {
            const on = w.modules.includes(id);
            const name = MODULES.find((m) => m.id === id)?.name ?? id;
            return (
              <span key={id} data-module={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Switch on={on} disabled={ro} label={`${name} in this workspace`} onClick={() => setWorkspace({ modules: WORKSPACE_MODULES.filter((m) => (m === id ? !on : w.modules.includes(m))) })} />
                <span style={{ fontSize: 13 }}>{name}</span>
              </span>
            );
          })}
        </span>
      </FieldRow>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: '2px 0 0' }}>Modules that are off show as "Not in this workspace" in the module switcher. Their data is kept.</span>
      <FieldRow label="Projects">
        <span data-testid="auto-create-projects" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <Switch on={w.autoCreateProjects} disabled={ro} onClick={() => setWorkspace({ autoCreateProjects: !w.autoCreateProjects })} label="Create a project when a deal is won" />
          <span style={{ fontSize: 13 }}>Create a project when a deal is won</span>
        </span>
      </FieldRow>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: '2px 0 0' }}>The project takes the deal's title and company, the first project type, and the deal owner as lead, who gets an email. Once per deal.</span>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 8 }}>
        {ro ? 'Only owners and admins can change the workspace settings.' : 'Changes are saved as you make them.'}
      </span>
    </div>
  );
}

/** A small text button (Resend, Copy link) under an invitation. */
const linkButton = { border: 0, background: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 500, color: 'var(--brand)' } as const;

/** How an invitation's email is doing (CD-7), as a short line under its address. */
function inviteEmailLine(invite: NonNullable<TeamMember['invite']>): { text: string; danger: boolean } {
  if (invite.emailStatus === 'sent') return { text: 'Email sent' + (invite.emailSentAt ? ' ' + new Date(invite.emailSentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''), danger: false };
  if (invite.emailStatus === 'queued') return invite.emailError ? { text: 'Sending failed, trying again…', danger: true } : { text: 'Sending email…', danger: false };
  if (invite.emailStatus === 'failed') return { text: 'Email not delivered' + (invite.emailError ? ': ' + invite.emailError : ''), danger: true };
  return { text: 'Not emailed', danger: false };
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
          ? `Sample data is loaded: ${c.company} companies, ${c.contact} contacts, ${c.product} products and ${c.deal} deals. Removing it deletes exactly those records; your own stay.`
          : 'Sample data adds a few companies, contacts, products and deals (with tasks) to look around with. It is marked, so you can remove exactly those records again in one click.'}
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

function TeamTab() {
  const { s, session, setMemberRole, removeMember, revokeInvitation, resendInvitation, copyInvitationLink, refreshTeam } = useStore();
  const cols = '1.4fr 1.4fr 0.9fr 0.7fr 0.7fr 40px';
  // Removing someone else asks whether they also left the company (spec 4.8).
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const canManage = session.tenant.role !== 'member';
  const isOwner = session.tenant.role === 'owner';
  // While an invitation email is on its way, check back every few seconds (for up to 2 minutes).
  const sending = s.team.some((m) => m.invite?.emailStatus === 'queued');
  useEffect(() => {
    if (!sending) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 120_000) clearInterval(timer);
      else void refreshTeam();
    }, 3000);
    return () => clearInterval(timer);
  }, [sending, refreshTeam]);
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="table-head th" style={{ gridTemplateColumns: cols }}>
        <span>Member</span>
        <span>Email</span>
        <span>Role</span>
        <span>Status</span>
        <span>Employee</span>
        <span />
      </div>
      {s.team.map((m) => {
        const self = m.id === session.userId;
        const invited = m.status === 'Invited';
        // Owners manage everyone; admins can't touch owners or hand out the owner role.
        const editable = !invited && canManage && (isOwner || m.role !== 'Owner');
        const removable = invited ? canManage : self || (canManage && (isOwner || m.role !== 'Owner'));
        return (
          <div key={m.id} className="table-row" style={{ gridTemplateColumns: cols, padding: '11px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
              <span className="avatar" style={{ width: 26, height: 26, fontSize: 10 }}>
                {invited ? '@' : initialsOf(m.name)}
              </span>
              <span style={{ fontWeight: 600 }}>
                {invited ? 'Invitation sent' : m.name}
                {self && <span style={{ fontWeight: 400, color: 'var(--muted)' }}> (you)</span>}
              </span>
            </div>
            {invited && m.invite ? (
              <div data-invite-email={m.email} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ color: 'var(--text-2)' }}>{m.email}</span>
                <span className="invite-email-status" style={{ fontSize: 12, color: inviteEmailLine(m.invite).danger ? 'var(--danger)' : 'var(--muted)' }}>
                  {inviteEmailLine(m.invite).text}
                </span>
                {canManage && m.invite.hasLink && (
                  <span style={{ display: 'flex', gap: 12 }}>
                    <button type="button" style={linkButton} disabled={m.invite.emailStatus === 'queued' && !m.invite.emailError} onClick={() => void resendInvitation(m.id)}>
                      Resend
                    </button>
                    <button type="button" style={linkButton} onClick={() => void copyInvitationLink(m.id)}>
                      Copy link
                    </button>
                  </span>
                )}
              </div>
            ) : (
              <span style={{ color: 'var(--text-2)' }}>{m.email}</span>
            )}
            {editable ? (
              <GhostSelect
                className="ghost-sm"
                value={m.role}
                onChange={(e) => setMemberRole(m.id, e.target.value.toLowerCase() as 'owner' | 'admin' | 'member')}
                options={isOwner ? [...TEAM_ROLES] : ['Admin', 'Member']}
                style={{ padding: '5px 8px' }}
              />
            ) : (
              <span style={{ color: 'var(--text-2)', padding: '5px 8px' }}>{m.role}</span>
            )}
            <span className={invited ? 'badge badge-warn' : 'badge badge-brand'} style={{ justifySelf: 'start' }}>
              {m.status}
            </span>
            {m.employeeId ? (
              <Link className="team-employee-link" to={paths.employee(m.employeeId)} data-testid="team-employee-link">
                Employee card
              </Link>
            ) : (
              <span />
            )}
            {removable ? (
              <RemoveButton
                title={invited ? 'Withdraw invitation' : self ? 'Leave workspace' : 'Remove from workspace'}
                style={{ justifySelf: 'end' }}
                onClick={() => {
                  if (invited) return revokeInvitation(m.id);
                  if (!self) return setRemoving(m);
                  if (window.confirm(`Leave ${session.tenant.name}? You will need a new invitation to come back.`)) removeMember(m.id);
                }}
              />
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {removing && <RemoveMemberDialog member={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

/**
 * "Remove from workspace" (spec 4.8): the employee record stays Active with "No account", unless
 * they also left the company: then the employee card's Deactivate dialog takes over (it removes
 * the membership too, and moves their reports).
 */
function RemoveMemberDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const { session, removeMember } = useStore();
  const navigate = useNavigate();
  const [left, setLeft] = useState(false);
  const go = () => {
    onClose();
    if (left && member.employeeId) navigate(paths.employee(member.employeeId, { deactivate: true }));
    else removeMember(member.id);
  };
  return (
    <Modal maxWidth={480}>
      <ModalHeader title={`Remove ${member.name}?`} sub={`They lose access to ${session.tenant.name}. Their employee record stays, with no account.`} />
      {member.employeeId && (
        <label className="emp-check" style={{ fontSize: 13 }}>
          <input type="checkbox" name="alsoLeft" checked={left} onChange={(e) => setLeft(e.target.checked)} />
          {member.name} also left the company
        </label>
      )}
      {left && <div className="hint-box">Next, the employee card asks for their last working day and who their reports move to.</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={go}>
          {left ? 'Continue to Deactivate' : 'Remove'}
        </button>
      </div>
    </Modal>
  );
}

/** Invite by email: the worker emails the link (CD-7); the link is also shown to copy as a fallback. */
function InviteModal({ onClose }: { onClose: () => void }) {
  const { session, inviteMember } = useStore();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const send = async () => {
    setBusy(true);
    setLink(await inviteMember(email.trim(), role));
    setBusy(false);
  };
  const copy = () =>
    navigator.clipboard
      .writeText(link!)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  return (
    <Modal maxWidth={520}>
      <ModalHeader title="Invite a teammate" sub={`They join ${session.tenant.name} and see the same pipeline. The link works once, for this email address, for 7 days.`} />
      {!link ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 12 }}>
            <label className="form-label">
              Email
              <input className="form-input" type="email" autoFocus placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="form-label">
              Role
              <select className="form-input" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={email.includes('@') && !busy ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!email.includes('@') || busy} onClick={() => void send()}>
              {busy ? 'Inviting…' : 'Send invitation'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="hint-box">We are emailing an invitation to {email.trim()}. The Team list shows when it has been sent, and you can resend it or copy the link from there.</div>
          <label className="form-label">
            Or send them the link yourself
            <input className="form-input" readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function FunnelBuilder() {
  const store = useStore();
  const { s, set } = store;
  const funnel = s.funnels[s.segment] ?? Object.values(s.funnels)[0]!;
  const stages = funnel.stages;
  const [removing, setRemoving] = useState<number | null>(null);
  const editable = store.canEditFunnels;
  const dealCount = s.leads.filter((l) => l.segment === funnel.id).length;
  const wonCount = stages.filter((st) => st.won).length;
  const smallBtn = { border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11.5, padding: '6px 10px', borderRadius: 6 } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <select
          value={funnel.id}
          onChange={(e) => {
            const v = e.target.value;
            set((x) => ({ segment: v, filters: { ...x.filters, audience: v } }));
          }}
          style={{ border: '1px solid var(--border)', background: 'var(--white)', borderRadius: 8, padding: '9px 11px', fontSize: 13, color: 'var(--ink)' }}
        >
          {funnelOptions(s).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {editable && (
          <button type="button" className="btn btn-primary" style={{ flex: '0 0 auto' }} onClick={() => set({ personaOpen: true, personaBase: funnel.id })}>
            New funnel
          </button>
        )}
      </div>

      <div className="card" style={{ padding: '16px 17px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
        <label className="form-label">
          Funnel name
          <input className="form-input" value={funnel.label} disabled={!editable} onChange={(e) => store.patchFunnel(funnel.id, { label: e.target.value })} />
        </label>
        <label className="form-label">
          How they buy
          <input className="form-input" value={funnel.note} disabled={!editable} placeholder="Who decides, how long it takes, what slows it down" onChange={(e) => store.patchFunnel(funnel.id, { note: e.target.value })} />
        </label>
        {!editable && (
          <div data-testid="funnels-read-only" style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-2)' }}>
            Only owners and admins can change funnels, stages and their to-dos.
          </div>
        )}
        {editable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-2)' }}>
            <span>
              {dealCount} deal{dealCount === 1 ? '' : 's'} in this funnel · {stages.length} stage{stages.length === 1 ? '' : 's'}
            </span>
            {dealCount === 0 && Object.keys(s.funnels).length > 1 && (
              <button type="button" style={{ ...smallBtn, marginLeft: 'auto' }} onClick={() => void store.deleteFunnel(funnel.id)}>
                Delete funnel
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {stages.map((st, idx) => (
          <div key={st.id} className="card" style={{ padding: '16px 17px', display: 'grid', gridTemplateColumns: '34px 1fr', gap: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', paddingTop: 4 }}>{String(idx + 1).padStart(2, '0')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <input className="ghost" value={st.name} disabled={!editable} onChange={(e) => store.editStage(idx, 'name', e.target.value)} style={{ fontSize: 15, fontWeight: 600, padding: '3px 7px', marginLeft: -7, minWidth: 180, width: 'auto' }} />
                {editable && (
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <button type="button" title="Move up" disabled={idx === 0} onClick={() => store.moveStage(idx, -1)} style={{ ...smallBtn, opacity: idx === 0 ? 0.4 : 1 }}>
                      ↑
                    </button>
                    <button type="button" title="Move down" disabled={idx === stages.length - 1} onClick={() => store.moveStage(idx, 1)} style={{ ...smallBtn, opacity: idx === stages.length - 1 ? 0.4 : 1 }}>
                      ↓
                    </button>
                    {st.won && wonCount === 1 ? (
                      <span className="caps-muted" style={{ alignSelf: 'center' }} title="Deals are won by reaching this stage">
                        Won stage
                      </span>
                    ) : (
                      stages.length > 1 && (
                        <button type="button" onClick={() => setRemoving(idx)} style={smallBtn}>
                          Remove
                        </button>
                      )
                    )}
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
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
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span className="caps">To-Do</span>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {st.checklist.map((c, gi) => (
                    <span key={st.checklistIds[gi] ?? gi} className="gate-chip">
                      <input value={c} disabled={!editable} onChange={(e) => store.renameGate(idx, gi, e.target.value)} style={{ border: 0, outline: 0, background: 'transparent', fontSize: 12, color: 'var(--ink)', width: Math.max(9, Math.min(34, c.length + 1)) + 'ch' }} />
                      {editable && <button type="button" className="pill-x" title="Delete to-do" onClick={() => store.removeGate(idx, gi)}>
                        ×
                      </button>}
                    </span>
                  ))}
                  {editable && <button type="button" onClick={() => store.addGate(idx)} style={{ fontSize: 12, border: '1px dashed var(--dashed)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', borderRadius: 20, padding: '6px 11px' }}>
                    + to-do
                  </button>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editable && (
        <button type="button" onClick={store.addStage} style={{ alignSelf: 'flex-start', border: '1px dashed var(--dashed)', background: 'transparent', color: 'var(--brand)', cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: '12px 18px', borderRadius: 9 }}>
          + Add stage to this funnel
        </button>
      )}
      {removing !== null && stages[removing] && <RemoveStageModal idx={removing} onClose={() => setRemoving(null)} />}
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
      <ModalHeader title={`Remove ${st.name}?`} sub="The stage leaves this funnel. Deals keep their stage history, including the time they spent here." />
      {deals.length > 0 ? (
        <label className="form-label">
          Move its {deals.length} deal{deals.length === 1 ? '' : 's'} to
          <select className="form-input" value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="hint-box">No deals are in this stage.</div>
      )}
      {hasLost && <div className="hint-box">Lost deals can't go to the won stage, so it isn't offered.</div>}
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
  deal: 'Company, Contacts, Owner, Deal value, Currency, Closing date, Funnel, Source, discovery notes',
  company: 'Name, Industry, HQ, Team size, Source, Owner',
  contact: 'Full name, Role, Company, Role in the decision, Email, Phone, LinkedIn, Owner',
};
const ENTITIES: { k: CustomFieldEntity; label: string; desc: string }[] = [
  { k: 'deal', label: 'Deals', desc: 'Shown on the deal record and in the New deal form.' },
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
  const entityLabel = { deal: 'deal', company: 'company', contact: 'contact' }[fl.entity];
  const onDelete = () => {
    const question = `Delete the field "${fl.label}"? It disappears from every ${entityLabel}, from the ${entityLabel} forms and from CSV exports. Values already entered are kept in the records but no longer shown, and the field can't be brought back from here.`;
    if (window.confirm(question)) deleteCustomField(fl.id);
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
          Only owners and admins can see these rules and the bonus figures on Overview. A won deal earns the rate on its net value; a deal under the minimum earns the flat amount instead. The minimum and the flat amount are in {s.workspace.currency}; deals in another currency earn the rate only. Changes are saved as you make them.
        </span>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 560 }}>
          <div className="table-head th" style={{ gridTemplateColumns: BONUS_COLS }}>
            <span>Salesperson</span>
            <span>Rate %</span>
            <span>Min deal ({symbol})</span>
            <span>Flat under min ({symbol})</span>
          </div>
          {salesPeople(s)
            .filter((p) => s.team.some((m) => m.status === 'Active' && m.id === p.value))
            .map((p) => {
              const r = rules[p.value];
              return (
                <div key={p.value} data-testid="bonus-rule" className="table-row" style={{ gridTemplateColumns: BONUS_COLS, padding: '8px 16px' }}>
                  <span style={{ fontWeight: 600 }}>{p.label}</span>
                  <GhostInput className="ghost-sm" aria-label={'Rate for ' + p.label} inputMode="decimal" placeholder="0" value={r?.rate ?? ''} onChange={(e) => setBonusRule(p.value, 'rate', e.target.value)} />
                  <GhostInput className="ghost-sm" aria-label={'Minimum for ' + p.label} inputMode="decimal" placeholder="0" value={r?.floor ?? ''} onChange={(e) => setBonusRule(p.value, 'floor', e.target.value)} />
                  <GhostInput className="ghost-sm" aria-label={'Flat amount for ' + p.label} inputMode="decimal" placeholder="0" value={r?.fixed ?? ''} onChange={(e) => setBonusRule(p.value, 'fixed', e.target.value)} />
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

/**
 * Your own notification settings for this workspace (CD-16, CD-207), saved on your membership.
 * Only what the app actually sends is listed.
 */
function NotificationsTab() {
  const { s, session, patchProfile } = useStore();
  const p = s.profile;
  const rows = [
    {
      id: 'digest',
      label: 'Daily digest email',
      desc: `Every morning at 8:00 (${s.workspace.timezone}): your overdue tasks, tasks due today and your open deals with no next step. Not sent when there is nothing to report.`,
      on: p.digest,
      toggle: () => patchProfile({ digest: !p.digest }),
    },
    { id: 'assigned', label: 'Deal assigned to you', desc: 'An email when someone else makes you the owner of a deal.', on: p.dealAssigned, toggle: () => patchProfile({ dealAssigned: !p.dealAssigned }) },
    {
      id: 'meetings',
      label: 'Meeting invitations',
      desc: "An email with a calendar file when someone else adds you to a meeting, or changes or cancels one you're in.",
      on: p.meetingInvites,
      toggle: () => patchProfile({ meetingInvites: !p.meetingInvites }),
    },
    { id: 'visit-plans', label: 'Visit plans', desc: 'An email when someone else creates or changes your visit plan.', on: p.visitPlans, toggle: () => patchProfile({ visitPlans: !p.visitPlans }) },
    { id: 'task-assignments', label: 'Task assignments', desc: 'An email when someone else assigns you to a task.', on: p.taskAssigned, toggle: () => patchProfile({ taskAssigned: !p.taskAssigned }) },
    {
      id: 'org-changes',
      label: 'Org changes',
      desc: 'An email when someone else changes who you report to, or gives you a new direct report.',
      on: p.orgChanges,
      toggle: () => patchProfile({ orgChanges: !p.orgChanges }),
    },
  ];
  const row = { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--divider)' } as const;
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((n) => (
        <div key={n.id} data-notification={n.id} style={row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{n.label}</span>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{n.desc}</span>
          </div>
          <Switch on={n.on} onClick={n.toggle} label={n.label} />
        </div>
      ))}
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 12 }}>
        Emails go to {p.email || 'your sign-in address'}. These settings are yours and apply to {session.tenant.name} only; changes are saved as you make them.
      </span>
    </div>
  );
}
