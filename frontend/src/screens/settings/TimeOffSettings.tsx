import { useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { Switch } from '../../components/ui';
import { type ApiExperienceRule, type ApiPolicyInput, type ApiTimeOffPolicy, type ApiTimeOffReason, type ApiTimeOffSettings, carryOverLabel, experienceSummary, type ReasonKind, timeOffApi } from '../../lib/timeOffApi';
import { projectError, useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';
import { DecisionRecipientsCard } from '../timeoff/Decisions';

/** The Labor Law's minimum (spec 3.3, A1) and the most a policy can give. */
const MIN_BASE_DAYS = 20;
const MAX_BASE_DAYS = 60;

interface PolicyDraft {
  name: string;
  baseDays: string;
  maxDays: string;
  carryOver: boolean;
  carryOverCap: string;
  note: string;
  rules: { fromYears: string; extraDays: string }[];
}

const draftOf = (p?: ApiTimeOffPolicy): PolicyDraft => ({
  name: p?.name ?? '',
  baseDays: String(p?.baseDays ?? MIN_BASE_DAYS),
  maxDays: p?.maxDays === null || p?.maxDays === undefined ? '' : String(p.maxDays),
  carryOver: p?.carryOver ?? true,
  carryOverCap: p?.carryOverCap === null || p?.carryOverCap === undefined ? '' : String(p.carryOverCap),
  note: p?.note ?? '',
  rules: (p?.experienceRules ?? []).map((r) => ({ fromYears: String(r.fromYears), extraDays: String(r.extraDays) })),
});

const int = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** The draft as the API takes it, or why it can't be saved. */
function inputOf(d: PolicyDraft): ApiPolicyInput | string {
  const name = d.name.trim();
  if (!name) return 'A name is needed';
  const baseDays = int(d.baseDays);
  if (baseDays === null || baseDays < MIN_BASE_DAYS || baseDays > MAX_BASE_DAYS) return `Base days are between ${MIN_BASE_DAYS} (the Labor Law's minimum) and ${MAX_BASE_DAYS}`;
  const maxDays = d.maxDays.trim() === '' ? null : int(d.maxDays);
  if (d.maxDays.trim() !== '' && (maxDays === null || maxDays < baseDays || maxDays > 100)) return 'The maximum is at least the base days and at most 100';
  const carryOverCap = d.carryOverCap.trim() === '' ? null : int(d.carryOverCap);
  if (d.carryOverCap.trim() !== '' && (carryOverCap === null || carryOverCap > 60)) return 'The carry-over cap is 0 to 60 days';
  const experienceRules: ApiExperienceRule[] = [];
  for (const r of d.rules) {
    const fromYears = int(r.fromYears);
    const extraDays = int(r.extraDays);
    if (fromYears === null || fromYears < 1 || fromYears > 50) return 'Experience rows start from 1 to 50 years';
    if (extraDays === null || extraDays < 1 || extraDays > 20) return 'Experience rows add 1 to 20 days';
    if (experienceRules.some((x) => x.fromYears === fromYears)) return `Two experience rows start at ${fromYears} years`;
    experienceRules.push({ fromYears, extraDays });
  }
  return { name, baseDays, maxDays, carryOver: d.carryOver, carryOverCap: d.carryOver ? carryOverCap : null, note: d.note.trim() || null, experienceRules };
}

/** The policy form (spec 5.2), for a new policy or an existing one; Cancel / Save. */
function PolicyEditor({ policy, onDone }: { policy?: ApiTimeOffPolicy; onDone: (saved: boolean) => void }) {
  const { flash } = useStore();
  const [d, setD] = useState<PolicyDraft>(() => draftOf(policy));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<PolicyDraft>) => setD((x) => ({ ...x, ...patch }));
  const setRule = (i: number, patch: Partial<PolicyDraft['rules'][number]>) => set({ rules: d.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = async () => {
    const input = inputOf(d);
    if (typeof input === 'string') return setProblem(input);
    setBusy(true);
    setProblem(null);
    try {
      if (policy) {
        const res = await timeOffApi.policies.update(policy.id, input);
        flash(res.recalculated ? `Saved. The vacation days of ${res.recalculated} ${res.recalculated === 1 ? 'employee' : 'employees'} changed.` : 'Saved');
      } else {
        await timeOffApi.policies.create(input);
        flash(`${input.name} added`);
      }
      onDone(true);
    } catch (err) {
      setProblem(projectError(err));
      setBusy(false);
    }
  };
  return (
    <div className="policy-editor" data-testid="policy-editor">
      <label className="policy-field">
        <span className="th">Name</span>
        <input className="form-input" value={d.name} maxLength={100} placeholder="e.g. Standard" onChange={(e) => set({ name: e.target.value })} data-testid="policy-name" />
      </label>
      <div className="policy-field-row">
        <label className="policy-field">
          <span className="th">Base days</span>
          <input className="form-input" inputMode="numeric" value={d.baseDays} onChange={(e) => set({ baseDays: e.target.value })} aria-describedby="policy-base-hint" data-testid="policy-base-days" />
        </label>
        <label className="policy-field">
          <span className="th">Maximum total days</span>
          <input className="form-input" inputMode="numeric" value={d.maxDays} placeholder="No cap" onChange={(e) => set({ maxDays: e.target.value })} data-testid="policy-max-days" />
        </label>
      </div>
      <span className="emp-note" id="policy-base-hint">
        Working days per calendar year. The Labor Law's minimum is {MIN_BASE_DAYS}. The maximum caps base, experience and individual days together.
      </span>

      <div className="policy-field">
        <span className="th">Extra days by work experience</span>
        {d.rules.length === 0 && <span className="emp-note">None. Rows don't add up: the highest row the employee reaches applies.</span>}
        {d.rules.map((r, i) => (
          <div key={i} className="policy-rule" data-testid="policy-rule">
            <span style={{ fontSize: 13 }}>From</span>
            <input className="form-input" inputMode="numeric" value={r.fromYears} onChange={(e) => setRule(i, { fromYears: e.target.value })} aria-label="From years" />
            <span style={{ fontSize: 13 }}>years of experience: +</span>
            <input className="form-input" inputMode="numeric" value={r.extraDays} onChange={(e) => setRule(i, { extraDays: e.target.value })} aria-label="Extra days" />
            <span style={{ fontSize: 13 }}>days</span>
            <button type="button" className="btn-plain" onClick={() => set({ rules: d.rules.filter((_, j) => j !== i) })} aria-label="Remove row">
              Remove
            </button>
          </div>
        ))}
        <span>
          <button type="button" className="btn-plain" onClick={() => set({ rules: [...d.rules, { fromYears: '', extraDays: '' }] })} data-testid="policy-add-rule">
            Add row
          </button>
        </span>
      </div>

      <div className="policy-field">
        <span className="th">Carry-over</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Switch on={d.carryOver} onClick={() => set({ carryOver: !d.carryOver })} label="Carry-over" />
          <span style={{ fontSize: 13 }}>Unused days can be used until 30 June of the next year</span>
        </div>
        {d.carryOver && (
          <label className="policy-field" style={{ maxWidth: 260 }}>
            <span className="emp-note">At most (days; empty: all unused days)</span>
            <input className="form-input" inputMode="numeric" value={d.carryOverCap} placeholder="All unused days" onChange={(e) => set({ carryOverCap: e.target.value })} data-testid="policy-carry-cap" />
          </label>
        )}
      </div>

      <label className="policy-field">
        <span className="th">Note</span>
        <textarea className="form-input" rows={2} maxLength={2000} value={d.note} placeholder="e.g. the rulebook article this follows" onChange={(e) => set({ note: e.target.value })} />
      </label>

      {problem && (
        <span className="emp-error" role="alert" data-testid="policy-problem">
          {problem}
        </span>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={() => onDone(false)} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy} data-testid="policy-save">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/** One policy in the list, or its editor. */
function PolicyRow({ policy, onChanged }: { policy: ApiTimeOffPolicy; onChanged: () => void }) {
  const { flash } = useStore();
  const [editing, setEditing] = useState(false);
  const makeDefault = async () => {
    try {
      await timeOffApi.policies.makeDefault(policy.id);
      flash(`${policy.name} is the default policy`);
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
  };
  const remove = async () => {
    if (!(await askConfirm({ title: `Delete ${policy.name}?`, message: 'Nobody is on this policy. Its history stays in the audit log.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await timeOffApi.policies.remove(policy.id);
      flash(`${policy.name} deleted`);
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
  };
  if (editing)
    return (
      <div className="policy-row policy-row-editing">
        <PolicyEditor
          policy={policy}
          onDone={(saved) => {
            setEditing(false);
            if (saved) onChanged();
          }}
        />
      </div>
    );
  const exp = experienceSummary(policy.experienceRules);
  return (
    <div className="policy-row" data-testid="policy-row" data-name={policy.name}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{policy.name}</span>
          {policy.isDefault && <span className="badge badge-brand">Default</span>}
        </span>
        {policy.note && <span className="emp-note">{policy.note}</span>}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
        <span>
          {policy.baseDays} days{policy.maxDays !== null ? `, at most ${policy.maxDays}` : ''}
        </span>
        {exp && <span className="emp-note">{exp}</span>}
      </span>
      <span style={{ fontSize: 13 }}>{carryOverLabel(policy)}</span>
      <span style={{ fontSize: 13 }} data-testid="policy-employees">
        {policy.employees}
      </span>
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn-outline" onClick={() => setEditing(true)} data-testid="policy-edit">
          Edit
        </button>
        {!policy.isDefault && (
          <button type="button" className="btn-plain" onClick={() => void makeDefault()} data-testid="policy-make-default">
            Make default
          </button>
        )}
        {!policy.isDefault && policy.employees === 0 && (
          <button type="button" className="btn-plain" onClick={() => void remove()} data-testid="policy-delete">
            Delete
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Settings → Workforce → Time off (CD-163, spec 5.5): the workspace's vacation policies, with how
 * many employees are on each; New policy, Edit, Make default and Delete (only a policy nobody is
 * on). Admins only (the section is hidden from members and the API answers 403).
 */
export function TimeOffTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PoliciesCard />
      <ReasonsCard kind="paid_leave" />
      <ReasonsCard kind="other_absence" />
      <DecisionRecipientsCard />
    </div>
  );
}

function PoliciesCard() {
  const { data, error, reload } = useProjectsRead<ApiTimeOffPolicy[]>(true, () => timeOffApi.policies.list(), 'timeoff:policies', 'timeOffRev');
  const [adding, setAdding] = useState(false);
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="timeoff-policies">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 320px' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Vacation policies</span>
          <span className="emp-note">
            How many vacation days employees get per year and how unused days carry over. New employees get the default policy; an employee's policy is changed on their card. Editing a policy
            recalculates this year's days where no vacation was approved yet, and later years for everyone on it.
          </span>
        </div>
        {!adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)} data-testid="policy-new">
            New policy
          </button>
        )}
      </div>
      {adding && (
        <div className="policy-row policy-row-editing" data-testid="policy-new-editor">
          <PolicyEditor
            onDone={(saved) => {
              setAdding(false);
              if (saved) void reload();
            }}
          />
        </div>
      )}
      <div className="policy-row policy-head">
        <span className="th">Policy</span>
        <span className="th">Days per year</span>
        <span className="th">Carry-over</span>
        <span className="th">Employees</span>
        <span />
      </div>
      {error && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</span>}
      {data?.map((p) => <PolicyRow key={`${p.id}:${p.updatedAt}`} policy={p} onChanged={() => void reload()} />)}
    </div>
  );
}

const KIND_TEXT: Record<ReasonKind, { title: string; text: string }> = {
  paid_leave: { title: 'Paid leave reasons', text: 'A paid leave request names one of these. The days per case and the yearly limit (for the reasons that count toward it) are warnings to the employee and the approver, never blocks: contracts may grant more.' },
  other_absence: { title: 'Other absence reasons', text: 'Long absences Admins record for an employee: maternity leave, child care leave, military service. No approval and no balance. "Paid by employer" is shown to payroll.' },
};

/** One reason, shown or edited inline (name, days per case, counts toward the limit or paid by the employer, active). */
function ReasonRow({ reason, onChanged }: { reason: ApiTimeOffReason; onChanged: () => void }) {
  const { flash } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: reason.name, maxDays: reason.maxDays === null ? '' : String(reason.maxDays), countsTowardLimit: reason.countsTowardLimit, paidByEmployer: reason.paidByEmployer });
  const paid = reason.kind === 'paid_leave';
  const save = async () => {
    if (!draft.name.trim()) return flash('Enter a name');
    const maxDays = draft.maxDays.trim() === '' ? null : /^\d+$/.test(draft.maxDays.trim()) ? Number(draft.maxDays.trim()) : NaN;
    if (Number.isNaN(maxDays) || (maxDays !== null && (maxDays < 1 || maxDays > 60))) return flash('Days per case are 1 to 60, or empty for no limit');
    try {
      await timeOffApi.reasons.update(reason.id, { name: draft.name.trim(), ...(paid ? { maxDays, countsTowardLimit: draft.countsTowardLimit } : { paidByEmployer: draft.paidByEmployer }) });
      flash('Saved');
      setEditing(false);
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
  };
  const toggleActive = async () => {
    try {
      await timeOffApi.reasons.update(reason.id, { active: !reason.active });
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
  };
  const remove = async () => {
    if (!(await askConfirm({ title: `Delete ${reason.name}?`, message: 'No request uses it. A used reason can only be deactivated.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await timeOffApi.reasons.remove(reason.id);
      flash(`${reason.name} deleted`);
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
  };
  if (editing)
    return (
      <div className="reason-row" data-testid="reason-row">
        <input className="form-input" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" />
        {paid ? <input className="form-input" inputMode="numeric" value={draft.maxDays} placeholder="No limit" onChange={(e) => setDraft({ ...draft, maxDays: e.target.value })} aria-label="Days per case" /> : <span />}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          {paid ? (
            <>
              <input type="checkbox" checked={draft.countsTowardLimit} onChange={(e) => setDraft({ ...draft, countsTowardLimit: e.target.checked })} /> Counts toward the yearly limit
            </>
          ) : (
            <>
              <input type="checkbox" checked={draft.paidByEmployer} onChange={(e) => setDraft({ ...draft, paidByEmployer: e.target.checked })} /> Paid by employer
            </>
          )}
        </label>
        <span />
        <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} data-testid="reason-save">
            Save
          </button>
        </span>
      </div>
    );
  return (
    <div className="reason-row" data-testid="reason-row" data-name={reason.name} data-active={reason.active}>
      <span style={{ fontSize: 13, fontWeight: 500, color: reason.active ? undefined : 'var(--muted)' }}>
        {reason.name}
        {!reason.active && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>Inactive</span>}
      </span>
      <span style={{ fontSize: 13 }}>{paid ? (reason.maxDays === null ? 'No limit' : `${reason.maxDays} ${reason.maxDays === 1 ? 'day' : 'days'}`) : ''}</span>
      <span style={{ fontSize: 13 }}>{paid ? (reason.countsTowardLimit ? 'Counts toward the limit' : '') : reason.paidByEmployer ? 'Paid by employer' : 'Not paid by employer'}</span>
      <span className="emp-note">{reason.used ? `${reason.used} ${reason.used === 1 ? 'request' : 'requests'}` : 'Not used'}</span>
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn-outline" onClick={() => setEditing(true)} data-testid="reason-edit">
          Edit
        </button>
        <button type="button" className="btn-plain" onClick={() => void toggleActive()} data-testid="reason-toggle">
          {reason.active ? 'Deactivate' : 'Activate'}
        </button>
        {!reason.used && (
          <button type="button" className="btn-plain" onClick={() => void remove()} data-testid="reason-delete">
            Delete
          </button>
        )}
      </span>
    </div>
  );
}

/** Settings → Time off → Paid leave reasons / Other absence reasons (CD-165, spec 7.2, 7.3), with the yearly limit for paid leave. */
function ReasonsCard({ kind }: { kind: ReasonKind }) {
  const { flash } = useStore();
  const { data, error, reload } = useProjectsRead<ApiTimeOffReason[]>(true, () => timeOffApi.reasons.list(kind), `timeoff:reasons:${kind}`, 'timeOffRev');
  const { data: settings, set: setSettings } = useProjectsRead<ApiTimeOffSettings>(kind === 'paid_leave', () => timeOffApi.settings(), 'timeoff:settings', 'timeOffRev');
  const [name, setName] = useState('');
  const [limit, setLimit] = useState<string | null>(null);
  const add = async () => {
    if (!name.trim()) return flash('Enter a name');
    try {
      const r = await timeOffApi.reasons.create({ kind, name: name.trim() });
      flash(`${r.name} added`);
      setName('');
      await reload();
    } catch (err) {
      flash(projectError(err));
    }
  };
  const saveLimit = async () => {
    const n = limit !== null && /^\d+$/.test(limit.trim()) ? Number(limit.trim()) : NaN;
    if (Number.isNaN(n) || n > 60) return flash('The yearly limit is 0 to 60 days');
    try {
      setSettings(await timeOffApi.updateSettings({ paidLeaveYearlyLimit: n }));
      setLimit(null);
      flash('Saved');
    } catch (err) {
      flash(projectError(err));
    }
  };
  const paid = kind === 'paid_leave';
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid={`timeoff-reasons-${kind}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{KIND_TEXT[kind].title}</span>
        <span className="emp-note">{KIND_TEXT[kind].text}</span>
      </div>
      {paid && settings && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
          <span>Yearly limit for the reasons that count toward it:</span>
          {limit === null ? (
            <>
              <strong data-testid="paid-leave-limit">{settings.paidLeaveYearlyLimit} days</strong>
              <button type="button" className="btn-plain" onClick={() => setLimit(String(settings.paidLeaveYearlyLimit))}>
                Change
              </button>
            </>
          ) : (
            <>
              <input className="form-input timeoff-num" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Yearly limit" />
              <button type="button" className="btn btn-secondary" onClick={() => setLimit(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveLimit()}>
                Save
              </button>
            </>
          )}
        </div>
      )}
      <div className="reason-row reason-head">
        <span className="th">Reason</span>
        <span className="th">{paid ? 'Days per case' : ''}</span>
        <span className="th">{paid ? 'Yearly limit' : 'Pay'}</span>
        <span className="th">Used</span>
        <span />
      </div>
      {error && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</span>}
      {data?.map((r) => <ReasonRow key={`${r.id}:${r.name}:${r.maxDays}:${r.countsTowardLimit}:${r.paidByEmployer}:${r.active}`} reason={r} onChanged={() => void reload()} />)}
      <div className="reason-row">
        <input className="form-input" value={name} maxLength={100} placeholder="New reason" onChange={(e) => setName(e.target.value)} aria-label="New reason" data-testid={`reason-add-${kind}`} />
        <span />
        <span />
        <span />
        <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary" onClick={() => void add()} data-testid={`reason-add-go-${kind}`}>
            Add reason
          </button>
        </span>
      </div>
    </div>
  );
}
