import { useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { ApiError } from '../../lib/api';
import { type ApiEntitlement, type ApiTimeOffPolicy, type ApiTimeOffProfile, entitlementParts, timeOffApi } from '../../lib/timeOffApi';
import { projectError, useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';
import { dateLabel, Row, Val } from './parts';

/**
 * The employee card's Time off section (CD-163, spec 5.3, 5.4): the policy, prior work experience
 * and the vacation entitlement per year (this year, next year from October). Shown to the
 * employee, their managers and Admins (the API decides: a 403 hides the section); Admins change
 * the policy and prior experience, add individual days with a reason and press Recalculate.
 */
export function TimeOffSection({ id }: { id: string }) {
  const { data, error, reload, set } = useProjectsRead<ApiTimeOffProfile | null>(
    true,
    () => timeOffApi.profile(id).catch((err) => (err instanceof ApiError && (err.status === 403 || err.status === 404) ? null : Promise.reject(err))),
    `timeoff:profile:${id}`,
    'timeOffRev',
  );
  const [editing, setEditing] = useState(false);
  if (data === null && !error) return null;
  return (
    <section className="card card-pad emp-section" data-testid="employee-timeoff">
      <div className="emp-section-head">
        <span style={{ fontSize: 15, fontWeight: 600 }}>Time off</span>
        {data?.canEdit && !editing && (
          <button type="button" className="btn-outline" onClick={() => setEditing(true)} data-testid="timeoff-edit">
            Edit
          </button>
        )}
      </div>
      <div className="emp-section-body">
        {error && (
          <p className="emp-note" role="alert">
            Time off could not be loaded. {error}
          </p>
        )}
        {data && editing ? (
          <ProfileEditor
            profile={data}
            onDone={(saved) => {
              setEditing(false);
              if (saved) set(saved);
            }}
          />
        ) : (
          data && <ProfileView profile={data} onChanged={(p) => (p ? set(p) : void reload())} />
        )}
      </div>
    </section>
  );
}

function ProfileView({ profile, onChanged }: { profile: ApiTimeOffProfile; onChanged: (p?: ApiTimeOffProfile) => void }) {
  return (
    <>
      <Row label="Vacation policy" testId="timeoff-policy">
        {profile.policy.name}
        {!profile.hasProfile && <span className="emp-note"> · the default</span>}
      </Row>
      <Row label="Prior work experience" testId="timeoff-prior">
        <Val v={profile.priorExperienceMonths ? profile.priorExperienceLabel : null} hint="None recorded" />
      </Row>
      {!profile.startDate && (
        <p className="emp-note emp-warn" data-testid="timeoff-no-start">
          Start date missing. The vacation entitlement is calculated once the employment start date is set in Work.
        </p>
      )}
      {profile.entitlements
        .filter((e) => e.year >= profile.currentYear)
        .map((e) => <EntitlementCard key={e.id} profile={profile} e={e} onChanged={onChanged} />)}
      <p className="emp-note">Visible to the employee, their managers and Admins. Admins change the policy, prior experience and individual days.</p>
    </>
  );
}

/** One year's entitlement: the total, its parts, and the Admin actions (individual days, Recalculate). */
function EntitlementCard({ profile, e, onChanged }: { profile: ApiTimeOffProfile; e: ApiEntitlement; onChanged: (p?: ApiTimeOffProfile) => void }) {
  const { flash } = useStore();
  const [individual, setIndividual] = useState<{ days: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const saveIndividual = async () => {
    if (!individual) return;
    const days = /^\d+$/.test(individual.days.trim()) ? Number(individual.days.trim()) : null;
    if (days === null || days > 60) return flash('Individual days are 0 to 60');
    if (days > 0 && !individual.reason.trim()) return flash('A reason is needed for individual extra days');
    setBusy(true);
    try {
      const p = await timeOffApi.updateEntitlement(profile.employeeId, e.year, { individualDays: days, individualReason: days ? individual.reason.trim() : null });
      flash('Saved');
      setIndividual(null);
      onChanged(p);
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(false);
  };
  const recalculate = async () => {
    setBusy(true);
    try {
      const preview = await timeOffApi.recalculate(profile.employeeId, e.year, true);
      const after = preview.after;
      const ok = await askConfirm({
        title: `Recalculate ${e.year}?`,
        message: after
          ? `${e.totalDays} ${e.totalDays === 1 ? 'day' : 'days'} now; ${after.totalDays} ${after.totalDays === 1 ? 'day' : 'days'} after (${entitlementParts(after)}${after.monthsWorked !== null ? `, ${after.monthsWorked} of 12 months` : ''}) with the policy ${profile.policy.name}.${e.frozen ? ' Days of this year were already approved.' : ''}`
          : 'The employee has no start date, so there is nothing to calculate.',
        confirmLabel: 'Recalculate',
      });
      if (ok && after) {
        const res = await timeOffApi.recalculate(profile.employeeId, e.year, false);
        flash(res.after && res.before && res.after.totalDays === res.before.totalDays ? 'Nothing changed' : 'Recalculated');
        onChanged(res.profile ?? undefined);
      }
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(false);
  };
  return (
    <div className="timeoff-year" data-testid="timeoff-year" data-year={e.year}>
      <div className="timeoff-year-head">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Vacation days {e.year}</span>
        <span style={{ fontSize: 15, fontWeight: 600 }} data-testid="timeoff-total">
          {e.totalDays}
        </span>
      </div>
      <span className="emp-note">
        {entitlementParts(e)}
        {e.monthsWorked !== null ? ` · ${e.monthsWorked} of 12 months (${e.annualDays} for a full year)` : ''}
        {e.policy.id !== profile.policy.id ? ` · calculated with ${e.policy.name}` : ''}
      </span>
      {e.individualDays > 0 && e.individualReason && <span className="emp-note">Individual days: {e.individualReason}</span>}
      {e.frozen && <span className="badge badge-neutral">Days approved: only Recalculate changes it</span>}
      {e.policyOutdated && <span className="emp-note emp-warn">The policy changed to {profile.policy.name}. It applies from next year; Recalculate applies it to {e.year}.</span>}
      {profile.canEdit &&
        (individual ? (
          <div className="timeoff-individual" data-testid="timeoff-individual">
            <input className="form-input" inputMode="numeric" value={individual.days} onChange={(ev) => setIndividual({ ...individual, days: ev.target.value })} aria-label="Individual extra days" style={{ width: 70 }} />
            <input
              className="form-input"
              value={individual.reason}
              maxLength={300}
              placeholder="Reason, e.g. Collective agreement: working conditions. Do not enter health information."
              onChange={(ev) => setIndividual({ ...individual, reason: ev.target.value })}
              aria-label="Reason"
            />
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setIndividual(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveIndividual()} data-testid="timeoff-individual-save">
              Save
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn-plain" disabled={busy} onClick={() => setIndividual({ days: String(e.individualDays), reason: e.individualReason ?? '' })} data-testid="timeoff-individual-edit">
              Individual days
            </button>
            <button type="button" className="btn-plain" disabled={busy} onClick={() => void recalculate()} data-testid="timeoff-recalculate">
              Recalculate
            </button>
          </div>
        ))}
    </div>
  );
}

/** Admins: the policy (from next year) and the prior work experience (years and months). */
function ProfileEditor({ profile, onDone }: { profile: ApiTimeOffProfile; onDone: (saved?: ApiTimeOffProfile) => void }) {
  const { flash } = useStore();
  const { data: policies } = useProjectsRead<ApiTimeOffPolicy[]>(true, () => timeOffApi.policies.list(), 'timeoff:policies', 'timeOffRev');
  const [policyId, setPolicyId] = useState(profile.policy.id);
  const [years, setYears] = useState(String(Math.floor(profile.priorExperienceMonths / 12)));
  const [months, setMonths] = useState(String(profile.priorExperienceMonths % 12));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const y = /^\d+$/.test(years.trim()) ? Number(years.trim()) : null;
    const m = /^\d+$/.test(months.trim()) ? Number(months.trim()) : null;
    if (y === null || m === null || m > 11 || y * 12 + m > 600) return flash('Prior experience is years and months (0 to 11), up to 50 years');
    const patch: { policyId?: string; priorExperienceMonths?: number } = {};
    if (policyId !== profile.policy.id) patch.policyId = policyId;
    if (y * 12 + m !== profile.priorExperienceMonths) patch.priorExperienceMonths = y * 12 + m;
    if (!Object.keys(patch).length) return onDone();
    setBusy(true);
    try {
      const p = await timeOffApi.updateProfile(profile.employeeId, patch);
      flash('Saved');
      onDone(p);
    } catch (err) {
      flash(projectError(err));
      setBusy(false);
    }
  };
  const options = policies ?? [{ id: profile.policy.id, name: profile.policy.name } as ApiTimeOffPolicy];
  return (
    <>
      <Row label="Vacation policy">
        <select className="form-input emp-input" value={policyId} onChange={(e) => setPolicyId(e.target.value)} data-testid="timeoff-policy-select">
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </Row>
      {policyId !== profile.policy.id && <span className="emp-note">A new policy takes effect from next year. Recalculate on a year applies it there too.</span>}
      <Row label="Prior work experience">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="form-input" inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} aria-label="Years" style={{ width: 64 }} data-testid="timeoff-prior-years" />
          <span style={{ fontSize: 13 }}>years</span>
          <input className="form-input" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Months" style={{ width: 64 }} data-testid="timeoff-prior-months" />
          <span style={{ fontSize: 13 }}>months</span>
        </span>
      </Row>
      <span className="emp-note">Work experience before joining the company, for the policy's experience rows. Counted with the time since the start date{profile.startDate ? ` (${dateLabel(profile.startDate)})` : ''}.</span>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={() => onDone()} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy} data-testid="timeoff-save">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </>
  );
}
