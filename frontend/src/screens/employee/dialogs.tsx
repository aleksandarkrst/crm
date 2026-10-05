import { useEffect, useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import type { ApiEmployeeCard, ApiLinkCandidate, LeavingReason } from '../../lib/api';
import { LEAVING_REASON_LABEL } from '../../store/employeeCard';
import { useStore } from '../../store/store';
import { todayIso } from './parts';

/** Dialogs of the employee card (CD-140): Invite to Pultly, Link to member, Deactivate, Reactivate. */

function Actions({ onCancel, label, busy, disabled, onConfirm, danger }: { onCancel: () => void; label: string; busy: boolean; disabled?: boolean; onConfirm: () => void; danger?: boolean }) {
  const off = busy || disabled;
  return (
    <div className="modal-actions">
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className={off ? 'btn btn-disabled' : danger ? 'btn emp-danger' : 'btn btn-primary'} disabled={off} onClick={onConfirm}>
        {busy ? 'Working…' : label}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Invite to Pultly (spec 4.7)

export function InviteDialog({ card, onClose, onLinkInstead }: { card: ApiEmployeeCard; onClose: () => void; onLinkInstead: () => void }) {
  const { session, employeeCard } = useStore();
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkInstead, setLinkInstead] = useState<{ userId: string; memberName: string; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await employeeCard.invite(card.id, role);
    setBusy(false);
    if ('link' in r) setLink(r.link);
    else if ('linkInstead' in r) setLinkInstead(r.linkInstead);
    else setError(r.error);
  };
  const linkNow = async () => {
    if (!linkInstead) return;
    setBusy(true);
    const r = await employeeCard.link(card.id, linkInstead.userId);
    setBusy(false);
    if ('error' in r) setError(r.error);
    else onClose();
  };
  return (
    <Modal maxWidth={520}>
      <ModalHeader title="Invite to Pultly" sub={`They join ${session.tenant.name}. The link works once, for this email address, for 7 days.`} />
      {link ? (
        <>
          <div className="hint-box">We are emailing an invitation to {card.workEmail}. When they join, they are linked to the employee record of {card.fullName}.</div>
          <label className="form-label">
            Or send them the link yourself
            <input className="form-input" readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : linkInstead ? (
        <>
          <div className="hint-box">{linkInstead.message}</div>
          {error && <div className="emp-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-secondary" onClick={onLinkInstead}>
              Choose another member
            </button>
            <button type="button" className={busy ? 'btn btn-disabled' : 'btn btn-primary'} disabled={busy} onClick={() => void linkNow()}>
              Link instead of invite
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="emp-dialog-grid">
            <label className="form-label">
              Email
              <input className="form-input" readOnly value={card.workEmail ?? ''} title="The work email; edit the card to change it" />
            </label>
            <label className="form-label">
              Role
              <select className="form-input" name="role" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <div className="hint-box">They will be linked to the employee record of {card.fullName}.</div>
          {error && <div className="emp-error">{error}</div>}
          <Actions onCancel={onClose} label="Send invitation" busy={busy} disabled={!card.workEmail} onConfirm={() => void send()} />
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Link to member (spec 4.6)

export function LinkDialog({ card, onClose }: { card: ApiEmployeeCard; onClose: () => void }) {
  const { employeeCard } = useStore();
  const [candidates, setCandidates] = useState<ApiLinkCandidate[] | null>(null);
  const [pick, setPick] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = employeeCard.linkCandidates;
  useEffect(() => {
    void load(card.id).then((c) => setCandidates(c ?? []));
  }, [card.id, load]);
  const link = async () => {
    setBusy(true);
    const r = await employeeCard.link(card.id, pick);
    setBusy(false);
    if ('error' in r) setError(r.error);
    else onClose();
  };
  return (
    <Modal maxWidth={560}>
      <ModalHeader title="Link to member" sub={`${card.fullName} becomes this member's employee record. Their own record, made when they joined, is merged into this one.`} />
      {candidates === null ? (
        <span className="emp-note">Loading members…</span>
      ) : (
        <div className="emp-pick-list" role="radiogroup" aria-label="Member">
          {candidates.map((c) => (
            <label key={c.userId} className={c.mergeable ? 'emp-pick' : 'emp-pick emp-pick-off'}>
              <input type="radio" name="member" value={c.userId} disabled={!c.mergeable} checked={pick === c.userId} onChange={() => setPick(c.userId)} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span className="emp-note">
                  {c.email}
                  {!c.mergeable && ` · their record has ${c.blockers.join(', ')}, so it can't be merged`}
                </span>
              </span>
            </label>
          ))}
          {candidates.length === 0 && <span className="emp-note">No members to link.</span>}
        </div>
      )}
      {error && <div className="emp-error">{error}</div>}
      <Actions onCancel={onClose} label="Link" busy={busy} disabled={!pick} onConfirm={() => void link()} />
    </Modal>
  );
}

// ------------------------------------------------------------------ Deactivate (spec 4.8)

const REASONS = Object.entries(LEAVING_REASON_LABEL) as [LeavingReason, string][];

export function DeactivateDialog({ card, onClose }: { card: ApiEmployeeCard; onClose: () => void }) {
  const { s, employeeCard } = useStore();
  const ensure = employeeCard.ensurePickers;
  useEffect(() => void ensure(), [ensure]);
  const people = (s.peoplePickers?.employees ?? []).filter((e) => e.id !== card.id && e.status !== 'inactive');
  const [lastDay, setLastDay] = useState(todayIso());
  const [reason, setReason] = useState<LeavingReason | ''>('');
  // Default: the leaving person's own manager (skip level), else nobody.
  const [manager, setManager] = useState<string>(card.manager?.id ?? '');
  const [leads, setLeads] = useState<Record<string, string>>({});
  const [heads, setHeads] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const future = lastDay > todayIso();
  const options = people.map((p) => (
    <option key={p.id} value={p.id}>
      {p.jobTitle ? `${p.fullName} · ${p.jobTitle}` : p.fullName}
    </option>
  ));
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await employeeCard.deactivate(card.id, {
      lastWorkingDay: lastDay,
      reason: reason || null,
      ...(card.directReports.length ? { reportsManagerId: manager || null } : {}),
      teamLeads: card.leadsTeams.map((t) => ({ teamId: t.id, employeeId: leads[t.id] || null })),
      departmentHeads: card.headsDepartments.map((d) => ({ departmentId: d.id, employeeId: heads[d.id] || null })),
    });
    setBusy(false);
    if ('error' in r) setError(r.error);
    else onClose();
  };
  return (
    <Modal maxWidth={560}>
      <ModalHeader title={`Deactivate ${card.fullName}`} sub="For someone leaving the company. Their access ends and their reports move to a new manager." />
      <div className="emp-dialog-grid">
        <label className="form-label">
          Last working day
          <input className="form-input" type="date" name="lastWorkingDay" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
        </label>
        <label className="form-label">
          Reason
          <select className="form-input" name="reason" value={reason} onChange={(e) => setReason(e.target.value as LeavingReason | '')}>
            <option value="">Not given</option>
            {REASONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {card.directReports.length > 0 && (
        <label className="form-label">
          New manager for {card.directReports.length === 1 ? card.directReports[0]!.fullName : `${card.directReports.length} direct reports`}
          <select className="form-input" name="reportsManagerId" value={manager} onChange={(e) => setManager(e.target.value)}>
            <option value="">No manager</option>
            {card.manager && !people.some((p) => p.id === card.manager!.id) && <option value={card.manager.id}>{card.manager.fullName}</option>}
            {options}
          </select>
        </label>
      )}
      {card.leadsTeams.map((t) => (
        <label key={t.id} className="form-label">
          New team lead of {t.name}
          <select className="form-input" value={leads[t.id] ?? ''} onChange={(e) => setLeads((x) => ({ ...x, [t.id]: e.target.value }))}>
            <option value="">Nobody</option>
            {options}
          </select>
        </label>
      ))}
      {card.headsDepartments.map((d) => (
        <label key={d.id} className="form-label">
          New head of {d.name}
          <select className="form-input" value={heads[d.id] ?? ''} onChange={(e) => setHeads((x) => ({ ...x, [d.id]: e.target.value }))}>
            <option value="">Nobody</option>
            {options}
          </select>
        </label>
      ))}
      <div className="hint-box">
        {future
          ? `${card.fullName} keeps access and stays the manager of their reports until then. The changes apply at 00:05 the day after the last working day.`
          : `${card.fullName} becomes inactive now${card.account === 'linked' ? ' and loses access to the workspace' : ''}.`}
      </div>
      {error && <div className="emp-error">{error}</div>}
      <Actions onCancel={onClose} label={future ? 'Schedule' : 'Deactivate'} busy={busy} disabled={!lastDay} danger onConfirm={() => void submit()} />
    </Modal>
  );
}

// ------------------------------------------------------------------ Reactivate (spec 4.8)

export function ReactivateDialog({ card, onClose }: { card: ApiEmployeeCard; onClose: () => void }) {
  const { employeeCard } = useStore();
  const inactive = card.status === 'inactive';
  const [start, setStart] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    const r = await employeeCard.reactivate(card.id, inactive ? start : undefined);
    setBusy(false);
    if ('error' in r) setError(r.error);
    else onClose();
  };
  return (
    <Modal maxWidth={480}>
      <ModalHeader
        title={inactive ? `Reactivate ${card.fullName}` : `Cancel ${card.fullName}'s leaving`}
        sub={inactive ? 'For a rehire. The previous period stays in the history. They have no account until you invite them again.' : 'They stay active; nothing changes on their last working day.'}
      />
      {inactive && (
        <label className="form-label">
          New employment start date
          <input className="form-input" type="date" name="employmentStartDate" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
      )}
      {error && <div className="emp-error">{error}</div>}
      <Actions onCancel={onClose} label={inactive ? 'Reactivate' : 'Cancel leaving'} busy={busy} disabled={inactive && !start} onConfirm={() => void submit()} />
    </Modal>
  );
}
