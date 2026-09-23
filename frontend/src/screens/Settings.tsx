import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { FieldRow, GhostInput, GhostSelect, Modal, ModalHeader, RemoveButton, Switch } from '../components/ui';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { ACTIVITIES, CHANNEL_LABELS, CHANNELS, DOCS, TEAM_ROLES } from '../store/seed';
import { initialsOf } from '../store/selectors';
import { useStore } from '../store/store';
import type { SegKey, Workspace as WorkspaceT } from '../store/types';

const TABS = [
  { k: 'workspace', label: 'Workspace' },
  { k: 'team', label: 'Team' },
  { k: 'roles', label: 'Roles & permissions' },
  { k: 'funnel', label: 'Funnel builder' },
  { k: 'templates', label: 'Document templates' },
  { k: 'fields', label: 'Customize Fields' },
  { k: 'notifications', label: 'Notifications' },
  { k: 'integrations', label: 'Integrations' },
  { k: 'billing', label: 'Billing' },
] as const;
type Tab = (typeof TABS)[number]['k'];

export function Settings() {
  const { tab = 'workspace' } = useParams();
  const navigate = useNavigate();
  const { s, set, session, flash } = useStore();
  const [inviteOpen, setInviteOpen] = useState(false);
  if (!TABS.some((t) => t.k === tab)) return <Navigate to={paths.settings()} replace />;
  const current = tab as Tab;

  const action =
    current === 'templates'
      ? { label: 'New template', onClick: () => set({ templateOpen: true }), meta: 'Templates hold the fixed story; merge fields pull the rest from the lead record.' }
      : current === 'fields'
        ? { label: 'New field', onClick: () => set({ fieldOpen: true }), meta: 'Standard fields can be made optional or hidden; custom fields can be removed.' }
        : current === 'team'
          ? {
              label: 'Invite member',
              onClick: () => (session.tenant.role === 'member' ? flash('Only owners and admins can invite people') : setInviteOpen(true)),
              meta: `${s.team.filter((m) => m.status === 'Active').length} active · ${s.team.filter((m) => m.status === 'Invited').length} invited`,
            }
          : null;

  return (
    <Screen title="Settings">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6, background: 'var(--segment)', padding: 4, borderRadius: 9, width: 'fit-content', flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => navigate(paths.settings(t.k))}
              style={{ border: 0, cursor: 'pointer', padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500, background: t.k === current ? 'var(--white)' : 'transparent', color: t.k === current ? 'var(--ink)' : 'var(--text-2)' }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {action && (
          <>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)', marginLeft: 'auto', maxWidth: 520, textAlign: 'right', lineHeight: 1.45 }}>{action.meta}</span>
            <button type="button" className="btn btn-primary" style={{ flex: '0 0 auto' }} onClick={action.onClick}>
              {action.label}
            </button>
          </>
        )}
      </div>

      {current === 'workspace' && <WorkspaceTab />}
      {current === 'team' && <TeamTab />}
      {current === 'roles' && <RolesTab />}
      {current === 'funnel' && <FunnelBuilder />}
      {current === 'templates' && <TemplatesTab />}
      {current === 'fields' && <FieldsTab />}
      {current === 'notifications' && <ToggleList kind="notifs" />}
      {current === 'integrations' && <IntegrationsTab />}
      {current === 'billing' && <BillingTab />}
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
    </Screen>
  );
}

function WorkspaceTab() {
  const { s, set } = useStore();
  const w = s.workspace;
  const setW = (k: keyof WorkspaceT) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value;
    set((x) => ({ workspace: { ...x.workspace, [k]: v } }));
  };
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Workspace
      </div>
      <FieldRow label="Name">
        <GhostInput value={w.name} onChange={setW('name')} />
      </FieldRow>
      <FieldRow label="Currency">
        <GhostSelect value={w.currency} onChange={setW('currency')} options={['EUR (€)', 'RSD (дин)', 'USD ($)', 'GBP (£)']} />
      </FieldRow>
      <FieldRow label="Time zone">
        <GhostSelect value={w.timezone} onChange={setW('timezone')} options={['Europe/Belgrade', 'Europe/Berlin', 'Europe/London', 'UTC']} />
      </FieldRow>
      <FieldRow label="Fiscal year starts">
        <GhostSelect value={w.fiscal} onChange={setW('fiscal')} options={['January', 'April', 'July', 'October']} />
      </FieldRow>
      <FieldRow label="Sales bonus earned">
        <GhostSelect value={w.bonusTrigger || 'On contract signed'} onChange={setW('bonusTrigger')} options={['On contract signed', 'When fully billed']} />
      </FieldRow>
    </div>
  );
}

function TeamTab() {
  const { s, session, setMemberRole, removeMember, revokeInvitation } = useStore();
  const cols = '1.4fr 1.4fr 0.9fr 0.7fr 40px';
  const canManage = session.tenant.role !== 'member';
  const isOwner = session.tenant.role === 'owner';
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="table-head th" style={{ gridTemplateColumns: cols }}>
        <span>Member</span>
        <span>Email</span>
        <span>Role</span>
        <span>Status</span>
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
            <span style={{ color: 'var(--text-2)' }}>{m.email}</span>
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
            {removable ? (
              <RemoveButton
                title={invited ? 'Withdraw invitation' : self ? 'Leave workspace' : 'Remove from workspace'}
                style={{ justifySelf: 'end' }}
                onClick={() => {
                  if (invited) return revokeInvitation(m.id);
                  const question = self ? `Leave ${session.tenant.name}? You will need a new invitation to come back.` : `Remove ${m.name} from ${session.tenant.name}?`;
                  if (window.confirm(question)) removeMember(m.id);
                }}
              />
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** What each role may do. Enforced by the API; roles are fixed for now. */
const ROLE_RULES: { label: string; roles: (typeof TEAM_ROLES)[number][] }[] = [
  { label: 'View and edit deals, companies, contacts and products', roles: ['Owner', 'Admin', 'Member'] },
  { label: 'Delete deals, companies, contacts and products', roles: ['Owner', 'Admin'] },
  { label: 'Edit funnels and stages', roles: ['Owner', 'Admin'] },
  { label: 'Invite members and change their roles', roles: ['Owner', 'Admin'] },
  { label: 'Make someone an owner or remove an owner', roles: ['Owner'] },
];

function RolesTab() {
  const cols = '1.8fr repeat(3, 90px)';
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 560 }}>
        <div className="table-head th" style={{ gridTemplateColumns: cols }}>
          <span>Permission</span>
          {TEAM_ROLES.map((r) => (
            <span key={r} style={{ justifySelf: 'center' }}>
              {r}
            </span>
          ))}
        </div>
        {ROLE_RULES.map((p) => (
          <div key={p.label} className="table-row" style={{ gridTemplateColumns: cols, padding: '11px 16px' }}>
            <span>{p.label}</span>
            {TEAM_ROLES.map((r) => {
              const on = p.roles.includes(r);
              return (
                <span
                  key={r}
                  style={{ justifySelf: 'center', width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${on ? '#14503C' : '#D0D5DD'}`, background: on ? '#14503C' : '#FFFFFF', color: '#F5F6F8', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {on ? '✓' : ''}
                </span>
              );
            })}
          </div>
        ))}
        <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-2)' }}>Every workspace keeps at least one owner. Anyone can leave a workspace from the Team tab.</div>
      </div>
    </div>
  );
}

/** Invite by email; the link is shown once to copy and send (email delivery comes later). */
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
              {busy ? 'Creating…' : 'Create invite link'}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="form-label">
            Invite link for {email.trim()}
            <input className="form-input" readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
          <div className="hint-box">Send this link to them yourself for now. It is shown only once; if it gets lost, invite them again.</div>
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
  const stages = s.funnels[s.segment].stages;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <select
          value={s.segment}
          onChange={(e) => {
            const v = e.target.value as SegKey;
            set((x) => ({ segment: v, filters: { ...x.filters, audience: x.funnels[v].label } }));
          }}
          style={{ border: '1px solid var(--border)', background: 'var(--white)', borderRadius: 8, padding: '9px 11px', fontSize: 13, color: 'var(--ink)' }}
        >
          <option value="smb">{s.funnels.smb.label}</option>
          <option value="ent">{s.funnels.ent.label}</option>
        </select>
        <button type="button" className="btn btn-primary" onClick={() => set({ personaOpen: true })}>
          New pipeline
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {stages.map((st, idx) => (
          <div key={st.id} className="card" style={{ padding: '16px 17px', display: 'grid', gridTemplateColumns: '34px 1fr', gap: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', paddingTop: 4 }}>{String(idx + 1).padStart(2, '0')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <input className="ghost" value={st.name} onChange={(e) => store.editStage(idx, 'name', e.target.value)} style={{ fontSize: 15, fontWeight: 600, padding: '3px 7px', marginLeft: -7, minWidth: 180, width: 'auto' }} />
                <button type="button" onClick={() => store.removeStage(idx)} style={{ border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11.5, padding: '6px 10px', borderRadius: 6 }}>
                  Remove
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                <label className="form-label">
                  Activity
                  <select className="form-input" style={{ padding: '9px 10px' }} value={st.activity} onChange={(e) => store.editStage(idx, 'activity', e.target.value)}>
                    {ACTIVITIES.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Channel
                  <select className="form-input" style={{ padding: '9px 10px' }} value={st.channel} onChange={(e) => store.editStage(idx, 'channel', e.target.value)}>
                    {CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Document on entry
                  <select className="form-input" style={{ padding: '9px 10px' }} value={st.doc} onChange={(e) => store.editStage(idx, 'doc', e.target.value)}>
                    {DOCS.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Win probability
                  <span style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--white)', padding: '0 10px 0 0' }}>
                    <input type="number" min={0} max={100} step={5} value={st.prob} onChange={(e) => store.editProb(idx, e.target.value)} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', padding: '9px 4px 9px 10px', fontSize: 13, color: 'var(--ink)', textTransform: 'none', letterSpacing: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-2)', letterSpacing: 0 }}>%</span>
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span className="caps">To-Do</span>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {st.checklist.map((c, gi) => (
                    <span key={gi} className="gate-chip">
                      <input value={c} onChange={(e) => store.renameGate(idx, gi, e.target.value)} style={{ border: 0, outline: 0, background: 'transparent', fontSize: 12, color: 'var(--ink)', width: Math.max(9, Math.min(34, c.length + 1)) + 'ch' }} />
                      <button type="button" className="pill-x" title="Delete to-do" onClick={() => store.removeGate(idx, gi)}>
                        ×
                      </button>
                    </span>
                  ))}
                  <button type="button" onClick={() => store.addGate(idx)} style={{ fontSize: 12, border: '1px dashed var(--dashed)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', borderRadius: 20, padding: '6px 11px' }}>
                    + to-do
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button type="button" onClick={store.addStage} style={{ alignSelf: 'flex-start', border: '1px dashed var(--dashed)', background: 'transparent', color: 'var(--brand)', cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: '12px 18px', borderRadius: 9 }}>
        + Add stage to this funnel
      </button>
    </div>
  );
}

function TemplatesTab() {
  const { s, flash, openDoc } = useStore();
  const lead = s.leads[0];
  const templates = [
    { name: 'Proposal v4', meta: 'Used 38 times · owner: Mila', state: 'live', desc: "Eight sections. Scope, timeline and pricing are assembled from the lead's service lines.", fields: ['{{company}}', '{{need}}', '{{lines}}', '{{total}}'], cta: 'Preview with a lead', preview: () => lead && openDoc(lead.id) },
    { name: 'Quote / estimate', meta: 'Used 12 times · owner: Mila', state: 'live', desc: 'Single-page rate card estimate for leads that ask for a number before a full proposal.', fields: ['{{lines}}', '{{validUntil}}'], cta: 'Preview', preview: () => flash('Quote template preview is not in this prototype yet.') },
    { name: 'Services contract', meta: 'Draft · owner: legal', state: 'draft', desc: 'Standard terms with a phased payment schedule. Waiting on legal review before it goes live.', fields: ['{{company}}', '{{total}}', '{{startDate}}'], cta: 'Preview', preview: () => flash('Contract template is still in legal review.') },
    { name: 'First invoice', meta: 'Not configured', state: 'setup', desc: 'Fires when a contract is signed. Needs the accounting connection before it can generate.', fields: ['{{total}}', '{{poNumber}}'], cta: 'Set up', preview: () => flash('Connect accounting to enable invoices.') },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
      {templates.map((t) => (
        <div key={t.name} className="card" style={{ padding: 17, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{t.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{t.meta}</span>
            </div>
            <span className="tag" style={{ padding: '4px 6px', background: t.state === 'live' ? '#E7F2EE' : t.state === 'draft' ? '#FDF0E4' : '#F1F3F6', color: t.state === 'live' ? '#14503C' : t.state === 'draft' ? '#B4531B' : '#475467' }}>
              {t.state}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>{t.desc}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {t.fields.map((f) => (
              <span key={f} className="merge-tag">
                {f}
              </span>
            ))}
          </div>
          <button type="button" className="btn-outline" style={{ alignSelf: 'flex-start' }} onClick={t.preview}>
            {t.cta}
          </button>
        </div>
      ))}
    </div>
  );
}

function FieldsTab() {
  const { s, set, flash } = useStore();
  const toggle = (id: string, key: 'required' | 'visible') => set((x) => ({ fields: x.fields.map((y) => (y.id === id ? { ...y, [key]: !y[key] } : y)) }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {(['Leads', 'Contacts'] as const).map((ent) => (
        <div key={ent} className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--divider)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{ent}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{ent === 'Leads' ? 'Shown on the lead record and in the new lead form.' : 'Shown on the contact record and in the new contact form.'}</span>
          </div>
          {s.fields
            .filter((fl) => fl.entity === ent)
            .map((fl) => (
              <div key={fl.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '13px 18px', borderBottom: '1px solid var(--divider-2)' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 150 }}>{fl.label}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)', minWidth: 80 }}>{fl.type}</span>
                <span className={fl.system ? 'badge badge-neutral' : 'badge badge-warn'} style={{ padding: '4px 9px' }}>
                  {fl.system ? 'Standard' : 'Custom'}
                </span>
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => toggle(fl.id, 'required')} style={{ cursor: 'pointer', border: `1px solid ${fl.required ? '#14503C' : '#E4E7EC'}`, background: fl.required ? '#E7F2EE' : '#FFFFFF', color: fl.required ? '#14503C' : '#475467', fontSize: 12, padding: '6px 11px', borderRadius: 6 }}>
                    {fl.required ? 'Required' : 'Optional'}
                  </button>
                  <button type="button" onClick={() => toggle(fl.id, 'visible')} style={{ cursor: 'pointer', border: `1px solid ${fl.visible ? '#101828' : '#E4E7EC'}`, background: fl.visible ? '#101828' : '#FFFFFF', color: fl.visible ? '#F5F6F8' : '#475467', fontSize: 12, padding: '6px 11px', borderRadius: 6 }}>
                    {fl.visible ? 'Visible' : 'Hidden'}
                  </button>
                  {!fl.system && (
                    <button
                      type="button"
                      onClick={() => {
                        set((x) => ({ fields: x.fields.filter((y) => y.id !== fl.id) }));
                        flash(fl.label + ' removed');
                      }}
                      style={{ cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--danger)', fontSize: 12, padding: '6px 11px', borderRadius: 6 }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function ToggleList({ kind }: { kind: 'notifs' }) {
  const { s, set } = useStore();
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
      {s[kind].map((n) => (
        <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--divider)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{n.label}</span>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{n.desc}</span>
          </div>
          <Switch on={n.on} onClick={() => set((x) => ({ [kind]: x[kind].map((y) => (y.id === n.id ? { ...y, on: !y.on } : y)) }))} />
        </div>
      ))}
    </div>
  );
}

function IntegrationsTab() {
  const { s, set } = useStore();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
      {s.integrations.map((i) => (
        <div key={i.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{i.name}</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45, flex: 1 }}>{i.desc}</span>
          <button
            type="button"
            onClick={() => set((x) => ({ integrations: x.integrations.map((y) => (y.id === i.id ? { ...y, on: !y.on } : y)) }))}
            style={{ alignSelf: 'flex-start', cursor: 'pointer', border: '1px solid #14503C', background: i.on ? '#FFFFFF' : '#14503C', color: i.on ? '#14503C' : '#F5F6F8', fontSize: 12.5, fontWeight: 500, padding: '7px 12px', borderRadius: 7 }}
          >
            {i.on ? 'Connected' : 'Connect'}
          </button>
        </div>
      ))}
    </div>
  );
}

function BillingTab() {
  const { s } = useStore();
  const seats = s.team.length;
  const invoices = [
    { id: 'INV-0148', date: '01 Sep 2026', amount: '€116', state: 'Paid' },
    { id: 'INV-0139', date: '01 Aug 2026', amount: '€116', state: 'Paid' },
    { id: 'INV-0131', date: '01 Jul 2026', amount: '€87', state: 'Paid' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>
          Plan
        </div>
        <FieldRow label="Current plan">
          <span style={{ fontSize: 13.5 }}>Studio · €29 per seat / month</span>
        </FieldRow>
        <FieldRow label="Seats in use">
          <span style={{ fontSize: 13.5 }}>
            {seats} · €{seats * 29} / month
          </span>
        </FieldRow>
        <FieldRow label="Renews">
          <span style={{ fontSize: 13.5 }}>12 Oct 2026</span>
        </FieldRow>
      </div>
      <div className="card card-pad">
        <div className="card-title" style={{ marginBottom: 6 }}>
          Invoices
        </div>
        {invoices.map((inv) => (
          <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--divider)', fontSize: 13 }}>
            <span style={{ flex: 1 }}>{inv.id}</span>
            <span style={{ color: 'var(--text-2)' }}>{inv.date}</span>
            <span>{inv.amount}</span>
            <span className="badge badge-brand">{inv.state}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
