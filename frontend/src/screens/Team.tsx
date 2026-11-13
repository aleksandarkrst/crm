import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { askConfirm } from '../components/ConfirmDialog';
import { GhostSelect, Modal, ModalHeader, RemoveButton } from '../components/ui';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { TEAM_ROLES } from '../store/seed';
import { initialsOf } from '../store/selectors';
import { useStore } from '../store/store';
import type { TeamMember } from '../store/types';

/**
 * Employees → Team (CD-521; Settings → Members before): who works in this workspace, their roles
 * and the invitations still open. Owners and admins only, as in Settings (CD-523): anyone else goes
 * home. `?invite=1` opens the Invite dialog, e.g. from "Invite a colleague" in a meeting's guests (CD-221).
 */
export function Team() {
  const { s, canEditWorkspace } = useStore();
  const [params] = useSearchParams();
  const [inviteOpen, setInviteOpen] = useState(() => params.get('invite') === '1');
  if (!canEditWorkspace) return <Navigate to="/" replace />;
  const active = s.team.filter((m) => m.status === 'Active').length;
  const invited = s.team.filter((m) => m.status === 'Invited').length;
  return (
    <Screen title="Team">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <span className="settings-description" style={{ flex: '1 1 320px', minWidth: 0 }}>
          Who works in this workspace, their roles and the invitations still open.
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
            {active} active · {invited} invited
          </span>
          <button type="button" className="btn btn-primary" style={{ flex: '0 0 auto' }} onClick={() => setInviteOpen(true)}>
            Invite member
          </button>
        </span>
      </div>
      <TeamTab />
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
    </Screen>
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

function TeamTab() {
  const { s, session, setMemberRole, setInvitationRole, removeMember, revokeInvitation, resendInvitation, fetchInvitationLink, copyInvitationLink, refreshTeam } = useStore();
  const cols = '1.4fr 1.4fr 0.9fr 0.7fr 0.7fr 40px';
  // Removing someone else asks whether they also left the company (spec 4.8).
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  /** Invitation id → link shown under the pending row (CD-487). */
  const [shownLinks, setShownLinks] = useState<Record<string, string>>({});
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
  const showInviteLink = async (id: string) => {
    const link = await fetchInvitationLink(id);
    if (link) setShownLinks((prev) => ({ ...prev, [id]: link }));
  };
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
        // Pending invitations: admins can change Admin/Member before the invitee joins (CD-487).
        const editable = canManage && (invited ? true : isOwner || m.role !== 'Owner');
        const removable = invited ? canManage : self || (canManage && (isOwner || m.role !== 'Owner'));
        return (
          <div key={m.id} className="table-row" style={{ gridTemplateColumns: cols, padding: '11px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
              <span className="avatar" style={{ width: 26, height: 26, fontSize: 10 }}>
                {invited ? '@' : initialsOf(m.name)}
              </span>
              <span style={{ fontWeight: 600 }}>
                {invited && m.name === m.email ? 'Invitation sent' : m.name}
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
                  <>
                    <span style={{ display: 'flex', gap: 12 }}>
                      <button type="button" style={linkButton} disabled={m.invite.emailStatus === 'queued' && !m.invite.emailError} onClick={() => void resendInvitation(m.id)}>
                        Resend
                      </button>
                      {shownLinks[m.id] ? (
                        <button type="button" style={linkButton} onClick={() => void copyInvitationLink(m.id)}>
                          Copy link
                        </button>
                      ) : (
                        <button type="button" style={linkButton} onClick={() => void showInviteLink(m.id)}>
                          Show link
                        </button>
                      )}
                    </span>
                    {shownLinks[m.id] && (
                      <input className="form-input" readOnly value={shownLinks[m.id]} data-testid="pending-invite-link" onFocus={(e) => e.target.select()} style={{ fontSize: 12, padding: '6px 8px' }} />
                    )}
                  </>
                )}
              </div>
            ) : (
              <span style={{ color: 'var(--text-2)' }}>{m.email}</span>
            )}
            {editable ? (
              <GhostSelect
                className="ghost-sm"
                value={m.role}
                onChange={(e) => {
                  const role = e.target.value.toLowerCase() as 'owner' | 'admin' | 'member';
                  if (invited) setInvitationRole(m.id, role === 'owner' ? 'admin' : role);
                  else setMemberRole(m.id, role);
                }}
                options={invited ? ['Admin', 'Member'] : isOwner ? [...TEAM_ROLES] : ['Admin', 'Member']}
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
                  void askConfirm({
                    title: `Leave ${session.tenant.name}?`,
                    message: 'You will need a new invitation to come back.',
                    confirmLabel: 'Leave',
                    danger: true,
                  }).then((ok) => ok && removeMember(m.id));
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
    <Modal maxWidth={480} onClose={onClose}>
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
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const send = async () => {
    setBusy(true);
    setLink(await inviteMember(email.trim(), role, { firstName: firstName.trim(), lastName: lastName.trim() }));
    setBusy(false);
  };
  const ready = email.includes('@') && !!firstName.trim() && !!lastName.trim();
  const copy = () =>
    navigator.clipboard
      .writeText(link!)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  return (
    <Modal maxWidth={520} onClose={onClose}>
      <ModalHeader title="Invite a teammate" sub={`They join ${session.tenant.name} and see the same pipeline. The email greets them by first name; the link works once, for this email address, for 7 days.`} />
      {!link ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              First name
              <input className="form-input" autoFocus placeholder="Ana" value={firstName} maxLength={100} onChange={(e) => setFirstName(e.target.value)} data-testid="invite-first-name" />
            </label>
            <label className="form-label">
              Last name
              <input className="form-input" placeholder="Petrović" value={lastName} maxLength={100} onChange={(e) => setLastName(e.target.value)} data-testid="invite-last-name" />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 12 }}>
            <label className="form-label">
              Email
              <input className="form-input" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
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
            <button type="button" className={ready && !busy ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!ready || busy} onClick={() => void send()}>
              {busy ? 'Inviting…' : 'Send invitation'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="hint-box">We are emailing an invitation to {email.trim()}. The Team list shows when it has been sent, and you can resend it or copy the link from there.</div>
          <label className="form-label">
            Or send them the link yourself
            <input className="form-input" readOnly value={link} data-testid="invite-link" onFocus={(e) => e.target.select()} />
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
