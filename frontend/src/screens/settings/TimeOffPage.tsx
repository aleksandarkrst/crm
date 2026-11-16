import { useState } from 'react';
import { type DateRange, DateRangePicker, rangeText } from '../../components/DateRangePicker';
import { type ApiHoliday, holidaysApi, shortHours } from '../../lib/timesheetApi';
import { type ApiExperienceRule, type ApiPolicyInput, type ApiSickLeaveType, type ApiTimeOffPolicy, type ApiTimeOffReason, type ApiTimeOffSettings, carryOverLabel, experienceSummary, type ReasonKind, timeOffApi } from '../../lib/timeOffApi';
import { projectError, useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';
import { useCompanyField } from './CompanyCard';
import { askGlassConfirm, Badge, Block, Card, Modal, RemoveX, Row, RowMenu, Section, Segmented, Switch, Table, TextField, Unit } from './parts';

/** The Labor Law's minimum (spec 3.3, A1) and the most a policy can give. */
const MIN_BASE_DAYS = 20;
const MAX_BASE_DAYS = 60;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * Workspace settings → Time off (CD-524 spec 2, design G-Settings-TimeOff): Vacation (policies and
 * vacation decisions), Leave and absence, and Holidays. Not built because the app doesn't have them:
 * the request rules (approver, notice, half days).
 */
export function TimeOffPage() {
  return (
    <>
      <VacationSection />
      <LeaveSection />
      <HolidaysSection />
    </>
  );
}

// ---------------------------------------------------------------- Vacation

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
  maxDays: p?.maxDays == null ? '' : String(p.maxDays),
  carryOver: p?.carryOver ?? true,
  carryOverCap: p?.carryOverCap == null ? '' : String(p.carryOverCap),
  note: p?.note ?? '',
  rules: (p?.experienceRules ?? []).map((r) => ({ fromYears: String(r.fromYears), extraDays: String(r.extraDays) })),
});

const int = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** The draft as the API takes it, or why it can't be saved (`name` is the name's own message). */
function inputOf(d: PolicyDraft): ApiPolicyInput | { name?: string; other?: string } {
  const name = d.name.trim();
  if (!name) return { name: 'Give the policy a name, like Management.' };
  const baseDays = int(d.baseDays);
  if (baseDays === null || baseDays < MIN_BASE_DAYS || baseDays > MAX_BASE_DAYS) return { other: `Base days are between ${MIN_BASE_DAYS} (the Labor Law's minimum) and ${MAX_BASE_DAYS}.` };
  const maxDays = d.maxDays.trim() === '' ? null : int(d.maxDays);
  if (d.maxDays.trim() !== '' && (maxDays === null || maxDays < baseDays || maxDays > 100)) return { other: 'The maximum is at least the base days and at most 100.' };
  const carryOverCap = d.carryOverCap.trim() === '' ? null : int(d.carryOverCap);
  if (d.carryOverCap.trim() !== '' && (carryOverCap === null || carryOverCap > 60)) return { other: 'The carry-over cap is 0 to 60 days.' };
  const experienceRules: ApiExperienceRule[] = [];
  for (const r of d.rules) {
    const fromYears = int(r.fromYears);
    const extraDays = int(r.extraDays);
    if (fromYears === null || fromYears < 1 || fromYears > 50) return { other: 'Experience rows start from 1 to 50 years.' };
    if (extraDays === null || extraDays < 1 || extraDays > 20) return { other: 'Experience rows add 1 to 20 days.' };
    if (experienceRules.some((x) => x.fromYears === fromYears)) return { other: `Two experience rows start at ${fromYears} years.` };
    experienceRules.push({ fromYears, extraDays });
  }
  return { name, baseDays, maxDays, carryOver: d.carryOver, carryOverCap: d.carryOver ? carryOverCap : null, note: d.note.trim() || null, experienceRules };
}
const isInput = (x: ReturnType<typeof inputOf>): x is ApiPolicyInput => 'baseDays' in x;

/** Time off → Vacation: the vacation policies (CD-163) and the vacation decisions (CD-167). */
function VacationSection() {
  const { data, error, reload } = useProjectsRead<ApiTimeOffPolicy[]>(true, () => timeOffApi.policies.list(), 'timeoff:policies', 'timeOffRev');
  const [editing, setEditing] = useState<ApiTimeOffPolicy | 'new' | null>(null);
  return (
    <Section title="Vacation" desc="Vacation policies and the decision sent when vacation is approved.">
      <Block
        title="Vacation policies"
        desc="New employees get the default policy; an employee's policy is changed on their card. Editing a policy recalculates this year's days where no vacation was approved yet, and later years for everyone on it."
        actions={
          <button type="button" className="gs-btn" data-testid="policy-new" onClick={() => setEditing('new')}>
            New policy
          </button>
        }
        testId="timeoff-policies"
      >
        {error && <span className="gs-error">{error}</span>}
        <Table cols={[{ label: 'Policy' }, { label: 'Days', align: 'num' }, { label: 'Extra' }, { label: 'Carry over' }, { label: 'People', align: 'num' }, { label: '', align: 'end' }]} minWidth={640}>
          {data?.map((p) => (
            <tr key={`${p.id}:${p.updatedAt}`} data-testid="policy-row" data-name={p.name}>
              <td>
                <span className="gs-cell">
                  <b>{p.name}</b>
                  {p.isDefault && <span className="gs-sub">Default</span>}
                </span>
              </td>
              <td className="num">
                {p.baseDays}
                {p.maxDays !== null ? `, at most ${p.maxDays}` : ''}
              </td>
              <td className="gs-sub" style={{ fontSize: 13.5 }}>
                {experienceSummary(p.experienceRules) || 'None'}
              </td>
              <td className="gs-sub" style={{ fontSize: 13.5 }}>
                {carryOverLabel(p)}
              </td>
              <td className="num" data-testid="policy-employees">
                {p.employees}
              </td>
              <td className="end">
                <button type="button" className="gs-btn small" data-testid="policy-edit" onClick={() => setEditing(p)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Block>
      <DecisionsBlock />
      {editing && (
        <PolicyModal
          policy={editing === 'new' ? undefined : editing}
          onClose={(changed) => {
            setEditing(null);
            if (changed) void reload();
          }}
        />
      )}
    </Section>
  );
}

/** A policy in a modal (spec 5.2): new or edit; Make default and Delete (nobody on it) for an existing one. */
function PolicyModal({ policy, onClose }: { policy?: ApiTimeOffPolicy; onClose: (changed: boolean) => void }) {
  const { flash } = useStore();
  const [d, setD] = useState<PolicyDraft>(() => draftOf(policy));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const checked = inputOf(d);
  const nameError = tried && !isInput(checked) ? checked.name : undefined;
  // A change answers the last problem (CD-489): it goes until the next Save says otherwise.
  const set = (patch: Partial<PolicyDraft>) => {
    setD((x) => ({ ...x, ...patch }));
    setProblem(null);
  };
  const setRule = (i: number, patch: Partial<PolicyDraft['rules'][number]>) => set({ rules: d.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      flash(await action());
      onClose(true);
    } catch (err) {
      setProblem(projectError(err));
      setBusy(false);
    }
  };
  const save = () => {
    setTried(true);
    if (!isInput(checked)) return setProblem(checked.other ?? null);
    void run(async () => {
      if (!policy) {
        await timeOffApi.policies.create(checked);
        return 'Vacation policy added';
      }
      const res = await timeOffApi.policies.update(policy.id, checked);
      return res.recalculated ? `Changes saved. The vacation days of ${res.recalculated} ${res.recalculated === 1 ? 'employee' : 'employees'} changed.` : 'Changes saved';
    });
  };
  const field = (label: string, key: 'baseDays' | 'maxDays' | 'carryOverCap', placeholder?: string) => (
    <label className="gs-label" style={{ flex: '1 1 140px' }}>
      {label}
      <input className="gs-input" inputMode="numeric" value={d[key]} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value })} data-testid={`policy-${key === 'baseDays' ? 'base-days' : key === 'maxDays' ? 'max-days' : 'carry-cap'}`} />
    </label>
  );
  return (
    <Modal title={policy ? `Edit ${policy.name}` : 'New vacation policy'} desc={`Working days per calendar year. The Labor Law's minimum is ${MIN_BASE_DAYS}.`} onClose={() => onClose(false)} wide testId="policy-editor">
      <label className="gs-label">
        Name
        <input
          className="gs-input"
          value={d.name}
          maxLength={100}
          placeholder="e.g. Management"
          aria-invalid={!!nameError}
          onChange={(e) => {
            set({ name: e.target.value });
            if (e.target.value.trim()) setTried(false);
          }}
          data-testid="policy-name"
        />
        {nameError && (
          <span className="gs-error" role="alert">
            {nameError}
          </span>
        )}
      </label>
      <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {field('Vacation days per year', 'baseDays')}
        {field('At most, with extra days', 'maxDays', 'No cap')}
      </span>
      <div className="gs-label">
        Extra days by work experience
        {d.rules.length === 0 && <span className="gs-sub" style={{ fontWeight: 400 }}>None. Rows don't add up: the highest row the employee reaches applies.</span>}
        {d.rules.map((r, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: 'var(--gs-ink)', fontWeight: 400 }} data-testid="policy-rule">
            From
            <input className="gs-input s" style={{ width: 64 }} inputMode="numeric" value={r.fromYears} onChange={(e) => setRule(i, { fromYears: e.target.value })} aria-label="From years" />
            years: +
            <input className="gs-input s" style={{ width: 64 }} inputMode="numeric" value={r.extraDays} onChange={(e) => setRule(i, { extraDays: e.target.value })} aria-label="Extra days" />
            days
            <RemoveX label="Remove row" onClick={() => set({ rules: d.rules.filter((_, j) => j !== i) })} />
          </span>
        ))}
        <button type="button" className="gs-tag-add" style={{ alignSelf: 'flex-start' }} onClick={() => set({ rules: [...d.rules, { fromYears: '', extraDays: '' }] })} data-testid="policy-add-rule">
          + Add row
        </button>
      </div>
      <div className="gs-label">
        Carry over
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--gs-ink)', fontWeight: 400 }}>
          <Switch on={d.carryOver} label="Carry over" onChange={(on) => set({ carryOver: on })} />
          Unused days can be used until 30 June of the next year
        </span>
        {d.carryOver && <span style={{ maxWidth: 260 }}>{field('At most (empty: all unused days)', 'carryOverCap', 'All unused days')}</span>}
      </div>
      <label className="gs-label">
        Note
        <textarea className="gs-input" rows={2} maxLength={2000} value={d.note} placeholder="e.g. the rulebook article this follows" onChange={(e) => set({ note: e.target.value })} />
      </label>
      {problem && (
        <span className="gs-error" role="alert" data-testid="policy-problem">
          {problem}
        </span>
      )}
      <div className="gs-sheet-actions">
        {policy && !policy.isDefault && (
          <button type="button" className="gs-btn" data-testid="policy-make-default" disabled={busy} onClick={() => void run(async () => (await timeOffApi.policies.makeDefault(policy.id), `${policy.name} is the default policy`))}>
            Make default
          </button>
        )}
        {policy && !policy.isDefault && policy.employees === 0 && (
          <button
            type="button"
            className="gs-btn text-red"
            data-testid="policy-delete"
            disabled={busy}
            onClick={() => {
              // The policy's sheet closes first: the confirmation is never inside another overlay.
              onClose(false);
              void askGlassConfirm({ title: `Delete ${policy.name}?`, text: 'Nobody is on this policy. Its history stays in the audit log.', confirmLabel: 'Delete policy' }).then(async (ok) => {
                if (!ok) return;
                try {
                  await timeOffApi.policies.remove(policy.id);
                  flash(`${policy.name} deleted`);
                  onClose(true);
                } catch (err) {
                  flash(projectError(err), 4000, true);
                }
              });
            }}
          >
            Delete
          </button>
        )}
        <span className="grow" />
        <button type="button" className="gs-btn" onClick={() => onClose(false)} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="gs-btn primary" onClick={save} disabled={busy} data-testid="policy-save">
          {busy ? 'Saving' : policy ? 'Save' : 'Add policy'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Vacation → Vacation decisions (CD-167): who else gets a copy, and the legal basis the Serbian
 * decision starts with (only with the country set to Serbia; it is saved in the company details).
 */
function DecisionsBlock() {
  const { s, flash, canEditWorkspace } = useStore();
  const { data, set } = useProjectsRead<ApiTimeOffSettings>(true, () => timeOffApi.settings(), 'timeoff:settings:decisions', 'timeOffRev');
  const company = useCompanyField();
  if (!data) return null;
  const save = async (patch: Partial<ApiTimeOffSettings>) => {
    try {
      set(await timeOffApi.updateSettings(patch));
      flash('Changes saved');
    } catch {
      flash('Could not save. Try again.', 4000, true);
    }
  };
  const list = (text: string) =>
    text
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
  return (
    <Block title="Vacation decisions" desc="Sent to the employee when vacation is approved. Needs the country set to Serbia in Company details." testId="decision-recipients">
      <Card>
        <Row label="Copy to the owners and admins" switchRow>
          <Switch on={data.decisionCopyAdmins} disabled={!canEditWorkspace} label="Copy to the workspace's owners and admins" onChange={(on) => void save({ decisionCopyAdmins: on })} />
        </Row>
        <Row label="HR mailbox" desc="Up to 5 addresses, separated by commas">
          <TextField
            label="HR mailbox"
            testId="decision-copy-emails"
            width={300}
            placeholder="hr@company.rs"
            disabled={!canEditWorkspace}
            value={data.decisionCopyEmails.join(', ')}
            validate={(v) => {
              const all = list(v);
              if (all.length > 5) return 'Up to 5 addresses.';
              const bad = all.find((e) => !EMAIL.test(e));
              return bad ? `${bad} is not an email address.` : '';
            }}
            onSave={(v) => void save({ decisionCopyEmails: list(v) })}
          />
        </Row>
        {s.workspace.country === 'RS' && (
          <Row label="Legal basis" desc={'Serbian decisions start with "Na osnovu". Update it when the gazette numbers of the Labor Law change.'}>
            <TextField
              key={`legalBasis:${company.round}`}
              label="Legal basis on vacation decisions"
              testId="company-legalBasis"
              width={320}
              value={company.value('legalBasis')}
              disabled={company.readOnly}
              validate={(v) => (v.trim().length >= 10 ? '' : 'The legal basis is needed on every decision; write at least 10 characters.')}
              onSave={(v) => void company.save('legalBasis', v)}
            />
          </Row>
        )}
      </Card>
    </Block>
  );
}

// ---------------------------------------------------------------- Leave and absence

/** Time off → Leave and absence (CD-165, CD-170): paid leave and its yearly limit, sick leave types, other absence. */
function LeaveSection() {
  const { flash } = useStore();
  const { data: settings, set: setSettings } = useProjectsRead<ApiTimeOffSettings>(true, () => timeOffApi.settings(), 'timeoff:settings', 'timeOffRev');
  const sick = useProjectsRead<ApiSickLeaveType[]>(true, () => timeOffApi.sickLeave.types(), 'timeoff:sick-types', 'timeOffRev').data;
  return (
    <Section title="Leave and absence" desc="Paid leave, sick leave and other absence.">
      {settings && (
        <Card>
          <Row label="Paid leave yearly limit" desc="The reasons that count toward the limit share it. A warning to the employee and the approver, never a block.">
            <TextField
              label="Yearly limit"
              testId="paid-leave-limit"
              width={80}
              inputMode="numeric"
              value={String(settings.paidLeaveYearlyLimit)}
              validate={(v) => (/^\d+$/.test(v.trim()) && Number(v) <= 60 ? '' : 'The yearly limit is 0 to 60 days.')}
              onSave={(v) =>
                void timeOffApi.updateSettings({ paidLeaveYearlyLimit: Number(v) }).then(
                  (next) => {
                    setSettings(next);
                    flash('Changes saved');
                  },
                  () => flash('Could not save. Try again.', 4000, true),
                )
              }
            />
            <Unit>days</Unit>
          </Row>
        </Card>
      )}
      <ReasonsBlock kind="paid_leave" />
      <Block title="Sick leave" desc="Admins pick the type when they confirm a record. The payer note is information for payroll; nothing is calculated from it." testId="sick-types">
        <Table cols={[{ label: 'Type' }, { label: 'Paid by' }]} minWidth={420}>
          {(sick ?? []).map((t) => (
            <tr key={t.id} data-testid="sick-type-row">
              <td>
                <b style={{ fontWeight: 500, color: t.active ? undefined : 'var(--gs-muted)' }}>
                  {t.name}
                  {t.active ? '' : ' (inactive)'}
                </b>
              </td>
              <td className="gs-sub" style={{ fontSize: 13.5 }}>
                {t.payerNote || '—'}
              </td>
            </tr>
          ))}
        </Table>
      </Block>
      <ReasonsBlock kind="other_absence" />
    </Section>
  );
}

const KIND_TEXT: Record<ReasonKind, { title: string; text: string; add: string }> = {
  paid_leave: { title: 'Paid leave reasons', text: 'A paid leave request names one of these. Days per case and the yearly limit are warnings, never blocks: contracts may grant more.', add: 'Add reason' },
  other_absence: { title: 'Other absence', text: 'Long absences Admins record for an employee: maternity leave, child care leave, military service. No approval and no balance.', add: 'Add reason' },
};

/** Paid leave reasons (days per case and the limit, inline) or other absence reasons (who pays), with a ⋯ menu. */
function ReasonsBlock({ kind }: { kind: ReasonKind }) {
  const { flash } = useStore();
  const { data, error, reload } = useProjectsRead<ApiTimeOffReason[]>(true, () => timeOffApi.reasons.list(kind), `timeoff:reasons:${kind}`, 'timeOffRev');
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<ApiTimeOffReason | null>(null);
  const paid = kind === 'paid_leave';
  const update = async (r: ApiTimeOffReason, patch: Parameters<typeof timeOffApi.reasons.update>[1], done = 'Changes saved') => {
    try {
      await timeOffApi.reasons.update(r.id, patch);
      flash(done);
      await reload();
    } catch (err) {
      flash(projectError(err), 4000, true);
    }
  };
  const remove = async (r: ApiTimeOffReason) => {
    if (!(await askGlassConfirm({ title: `Delete ${r.name}?`, text: 'No request uses it. A used reason can only be deactivated.', confirmLabel: 'Delete reason' }))) return;
    try {
      await timeOffApi.reasons.remove(r.id);
      flash(`${r.name} deleted`);
      await reload();
    } catch (err) {
      flash(projectError(err), 4000, true);
    }
  };
  return (
    <Block
      title={KIND_TEXT[kind].title}
      desc={KIND_TEXT[kind].text}
      actions={
        <button type="button" className="gs-btn" data-testid={`reason-add-${kind}`} onClick={() => setAdding(true)}>
          {KIND_TEXT[kind].add}
        </button>
      }
      testId={`timeoff-reasons-${kind}`}
    >
      {error && <span className="gs-error">{error}</span>}
      <Table cols={paid ? [{ label: 'Reason' }, { label: 'Days per case', align: 'center' }, { label: 'Counts toward limit', align: 'center' }, { label: '', align: 'end' }] : [{ label: 'Reason' }, { label: 'Paid by' }, { label: '', align: 'end' }]} minWidth={paid ? 560 : 420}>
        {data?.map((r) => (
          <tr key={`${r.id}:${r.name}:${r.maxDays}:${r.countsTowardLimit}:${r.paidByEmployer}:${r.active}`} data-testid="reason-row" data-name={r.name} data-active={r.active}>
            <td>
              <span className="gs-cell">
                <b style={{ fontWeight: 500, color: r.active ? undefined : 'var(--gs-muted)' }}>{r.name}</b>
                <span className="gs-sub">{[r.active ? '' : 'Inactive', r.used ? `${r.used} ${r.used === 1 ? 'request' : 'requests'}` : 'Not used'].filter(Boolean).join(', ')}</span>
              </span>
            </td>
            {paid ? (
              <>
                <td className="center">
                  <TextField
                    label={`Days per case for ${r.name}`}
                    width={70}
                    inputMode="numeric"
                    placeholder="No limit"
                    value={r.maxDays === null ? '' : String(r.maxDays)}
                    validate={(v) => (v.trim() === '' || (/^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 60) ? '' : 'Days per case are 1 to 60, or empty for no limit.')}
                    onSave={(v) => void update(r, { maxDays: v.trim() === '' ? null : Number(v) })}
                  />
                </td>
                <td className="center">
                  <Switch on={r.countsTowardLimit} label={`${r.name} counts toward the yearly limit`} onChange={(on) => void update(r, { countsTowardLimit: on })} />
                </td>
              </>
            ) : (
              <td>
                <Badge tone={r.paidByEmployer ? 'green' : undefined}>{r.paidByEmployer ? 'Paid by employer' : 'Not paid by employer'}</Badge>
              </td>
            )}
            <td className="end">
              <RowMenu
                label={`Actions for ${r.name}`}
                items={[
                  { label: 'Rename', onClick: () => setRenaming(r), testId: 'reason-edit' },
                  ...(!paid ? [{ label: r.paidByEmployer ? 'Not paid by employer' : 'Paid by employer', onClick: () => void update(r, { paidByEmployer: !r.paidByEmployer }) }] : []),
                  { label: r.active ? 'Deactivate' : 'Activate', onClick: () => void update(r, { active: !r.active }, r.active ? `${r.name} deactivated` : `${r.name} activated`), testId: 'reason-toggle' },
                  ...(!r.used ? [{ label: 'Delete', onClick: () => void remove(r), danger: true, testId: 'reason-delete' }] : []),
                ]}
              />
            </td>
          </tr>
        ))}
      </Table>
      {(adding || renaming) && (
        <ReasonModal
          title={renaming ? `Rename ${renaming.name}` : KIND_TEXT[kind].add}
          initial={renaming?.name ?? ''}
          onClose={() => {
            setAdding(false);
            setRenaming(null);
          }}
          onSave={async (name) => {
            if (renaming) await update(renaming, { name });
            else {
              try {
                const r = await timeOffApi.reasons.create({ kind, name });
                flash(`${r.name} added`);
                await reload();
              } catch (err) {
                flash(projectError(err), 4000, true);
              }
            }
          }}
        />
      )}
    </Block>
  );
}

function ReasonModal({ title, initial, onClose, onSave }: { title: string; initial: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [tried, setTried] = useState(false);
  const bad = tried && !name.trim();
  const save = async () => {
    setTried(true);
    if (!name.trim()) return;
    await onSave(name.trim());
    onClose();
  };
  return (
    <Modal title={title} onClose={onClose}>
      <label className="gs-label">
        Name
        <input className="gs-input" value={name} maxLength={100} aria-invalid={bad} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} data-testid="reason-name" />
        {bad && (
          <span className="gs-error" role="alert">
            Enter a name.
          </span>
        )}
      </label>
      <div className="gs-sheet-actions">
        <button type="button" className="gs-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="gs-btn primary" onClick={() => void save()} data-testid="reason-save">
          Save
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Holidays

/** The month the date picker opens on: this month in the current year, else January. */
const monthIn = (year: number) => (year === new Date().getFullYear() ? new Date().toISOString().slice(0, 7) : `${year}-01`);

/**
 * Time off → Holidays (CD-153, CD-318): the workspace's public holidays by year. A holiday is a day
 * or a span of days; it repeats every year from the year it was added. Add holiday opens a modal;
 * an empty year offers the Serbian holidays (milestone 16: Orthodox Easter and moved Sunday
 * holidays included; a generated year is never overwritten).
 */
function HolidaysSection() {
  const { flash } = useStore();
  const now = new Date().getFullYear();
  const [year, setYear] = useState(now);
  const { data, error, reload } = useProjectsRead<ApiHoliday[]>(true, () => holidaysApi.list(year), `holidays:${year}`, 'timesheetRev');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const years = [year - 1, year, year + 1].map((y) => ({ value: String(y), label: String(y) }));
  const preload = async () => {
    setBusy(true);
    try {
      const res = await holidaysApi.setPreload({ country: 'serbia', year });
      flash(res.added ? `${res.added} ${res.added === 1 ? 'holiday' : 'holidays'} added` : 'Nothing to add: this year was generated already');
      await reload();
    } catch (err) {
      flash(projectError(err), 4000, true);
    }
    setBusy(false);
  };
  const remove = async (h: ApiHoliday) => {
    if (!(await askGlassConfirm({ title: `Delete ${h.name}?`, text: 'It goes from every year. The Timesheet expects the standard day on these dates again.', confirmLabel: 'Delete holiday' }))) return;
    try {
      await holidaysApi.remove(h.id);
      flash(`${h.name} deleted`);
      await reload();
    } catch (err) {
      flash(projectError(err), 4000, true);
    }
  };
  return (
    <Section
      title="Holidays"
      desc="Public holidays are days off for everyone. They are skipped in timesheets, leave and deadlines."
      action={
        <button type="button" className="gs-btn primary" data-testid="holiday-add" onClick={() => setAdding(true)}>
          Add holiday
        </button>
      }
      testId="holidays"
    >
      <Card>
        <Row label="Year">
          <span data-testid="holidays-year" style={{ display: 'none' }}>
            {year}
          </span>
          <Segmented label="Year" value={String(year)} options={years} onChange={(v) => setYear(Number(v))} testId="holidays-years" />
        </Row>
      </Card>
      <Block title={`Holidays in ${year}`}>
        {error && <span className="gs-error">{error}</span>}
        <Table cols={[{ label: 'Dates' }, { label: 'Name' }, { label: '', align: 'end' }]} minWidth={480}>
          {data?.map((h) => (
            <tr key={`${h.id}:${h.date}:${h.endDate}:${h.name}:${h.minutes}`} data-testid="holiday-row" data-date={h.date}>
              <td style={{ whiteSpace: 'nowrap' }}>{rangeText({ from: h.date, to: h.endDate })}</td>
              <td>
                <span className="gs-cell">
                  <b style={{ fontWeight: 500 }}>{h.name}</b>
                  <span className="gs-sub">
                    {h.minutes ? `${shortHours(h.minutes, 'decimal')} h off, ` : ''}
                    {!h.repeats ? `${h.since} only` : h.since < year ? `every year since ${h.since}` : 'repeats every year'}
                    {h.source === 'preload' ? ', preloaded' : ''}
                  </span>
                </span>
              </td>
              <td className="end">
                <RemoveX label={`Remove ${h.name}`} testId="holiday-remove" onClick={() => void remove(h)} />
              </td>
            </tr>
          ))}
        </Table>
        {data?.length === 0 && (
          <div className="gs-card gs-glass" style={{ padding: '22px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            <span className="gs-sub" style={{ fontSize: 13.5 }}>
              No holidays in {year} yet.
            </span>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" className="gs-btn primary" disabled={busy} onClick={() => void preload()} data-testid="holiday-preload-year">
                Preload holidays for Serbia
              </button>
              <button type="button" className="gs-btn" onClick={() => setAdding(true)}>
                Pick the dates
              </button>
            </span>
          </div>
        )}
      </Block>
      <p className="gs-note">A holiday repeats every year from the year it is added; a preloaded moving day (Orthodox Easter, a moved Sunday holiday) holds in its year only.</p>
      {adding && (
        <HolidayModal
          year={year}
          onClose={() => setAdding(false)}
          onAdded={async (h) => {
            if (h.since === year) await reload();
            else setYear(h.since);
          }}
        />
      )}
    </Section>
  );
}

function HolidayModal({ year, onClose, onAdded }: { year: number; onClose: () => void; onAdded: (h: ApiHoliday) => Promise<void> }) {
  const { flash } = useStore();
  const [range, setRange] = useState<DateRange | null>(null);
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setTried(true);
    if (!range || !name.trim()) return;
    setBusy(true);
    try {
      const h = await holidaysApi.create({ date: range.from, endDate: range.to === range.from ? null : range.to, name: name.trim() });
      flash(`${h.name} added`);
      await onAdded(h);
      onClose();
    } catch (err) {
      flash(projectError(err), 4000, true);
      setBusy(false);
    }
  };
  return (
    <Modal title="Add holiday" desc="A day or a span of days. It repeats every year from the year it is added." onClose={onClose}>
      <div className="gs-label">
        Dates
        <DateRangePicker label="Dates" value={range} month={monthIn(year)} onChange={setRange} placeholder="Pick the dates" testId="holiday-add-dates" />
        {tried && !range && (
          <span className="gs-error" role="alert">
            Pick the dates.
          </span>
        )}
      </div>
      <label className="gs-label">
        Name
        <input className="gs-input" value={name} maxLength={100} placeholder="e.g. Statehood Day" aria-invalid={tried && !name.trim()} onChange={(e) => setName(e.target.value)} data-testid="holiday-add-name" />
        {tried && !name.trim() && (
          <span className="gs-error" role="alert">
            Enter a name.
          </span>
        )}
      </label>
      <div className="gs-sheet-actions">
        <button type="button" className="gs-btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="gs-btn primary" onClick={() => void add()} disabled={busy} data-testid="holiday-add-go">
          Add holiday
        </button>
      </div>
    </Modal>
  );
}
