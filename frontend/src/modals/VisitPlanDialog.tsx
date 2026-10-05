import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Modal, ModalHeader, Picker, PickerRow, RemoveButton, usePicker } from '../components/ui';
import type { VisitPlanPeriodType } from '../lib/api';
import { paths } from '../lib/paths';
import { companyRecords, initialsOf, memberLabels, todayIso } from '../store/selectors';
import { useStore } from '../store/store';
import { periodLabel, periodOptions, periodStartOf, previousPlan, shiftPeriod } from '../store/visitPlans';

export interface PlanDraft {
  salespersonUserId: string;
  periodType: VisitPlanPeriodType;
  periodStart: string;
  note: string;
  /** Planned visits as typed. */
  lines: { companyId: string; plannedVisits: string }[];
}

const validVisits = (v: string) => /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 99;

/**
 * "New plan" (CD-134, owners and admins): a salesperson, a month or fiscal quarter, the customers
 * with their planned visits, and a note. "Copy from previous period" fills the customers from the
 * same salesperson's plan for the period before; everything can be changed before saving. Opened
 * from the Visit plans list, and prefilled by "Copy to next period" on a plan.
 */
export function VisitPlanDialog({ initial, onClose }: { initial?: Partial<PlanDraft>; onClose: () => void }) {
  const { s, createVisitPlan } = useStore();
  const navigate = useNavigate();
  const fiscal = s.workspace.fiscalMonth || 1;
  const today = todayIso(s.workspace.timezone);
  const labels = memberLabels(s);
  const members = s.team.filter((m) => m.status === 'Active');
  const [d, setD] = useState<PlanDraft>(() => {
    const periodType = initial?.periodType ?? 'month';
    return {
      salespersonUserId: initial?.salespersonUserId ?? '',
      periodType,
      periodStart: initial?.periodStart ?? periodStartOf(periodType, today, fiscal),
      note: initial?.note ?? '',
      lines: initial?.lines ?? [],
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picker = usePicker();

  const companies = companyRecords(s);
  const nameOf = new Map(companies.map((c) => [c.id, c.name]));
  const chosen = new Set(d.lines.map((l) => l.companyId));
  const q = picker.search.trim().toLowerCase();
  const available = companies.filter((c) => !chosen.has(c.id) && (!q || c.name.toLowerCase().includes(q))).slice(0, 50);

  const options = periodOptions(d.periodType, today, fiscal, 12, 6);
  if (!options.some((o) => o.value === d.periodStart)) options.push({ value: d.periodStart, label: periodLabel(d.periodType, d.periodStart, fiscal) });
  const label = periodLabel(d.periodType, d.periodStart, fiscal);
  const previous = d.salespersonUserId ? previousPlan(s.visitPlans, d.salespersonUserId, d.periodType, d.periodStart) : undefined;
  const existing = s.visitPlans.find((p) => p.salespersonUserId === d.salespersonUserId && p.periodType === d.periodType && p.periodStart === d.periodStart);
  const total = d.lines.reduce((sum, l) => sum + (validVisits(l.plannedVisits) ? Number(l.plannedVisits) : 0), 0);

  const setLine = (companyId: string, plannedVisits: string) => setD((x) => ({ ...x, lines: x.lines.map((l) => (l.companyId === companyId ? { ...l, plannedVisits } : l)) }));
  const copyPrevious = () => {
    if (!previous) return;
    setD((x) => ({ ...x, lines: previous.lines.map((l) => ({ companyId: l.companyId, plannedVisits: String(l.plannedVisits) })) }));
    setError('');
  };

  const submit = async () => {
    if (!d.salespersonUserId) return setError('Pick the salesperson.');
    if (existing) return setError(`${existing.salespersonName} already has a plan for ${label}.`);
    if (!d.lines.length) return setError('Add at least one customer.');
    if (d.lines.some((l) => !validVisits(l.plannedVisits))) return setError('Planned visits are whole numbers from 1 to 99.');
    setBusy(true);
    const result = await createVisitPlan({
      salespersonUserId: d.salespersonUserId,
      periodType: d.periodType,
      periodStart: d.periodStart,
      note: d.note.trim() || null,
      lines: d.lines.map((l) => ({ companyId: l.companyId, plannedVisits: Number(l.plannedVisits) })),
    });
    setBusy(false);
    if ('error' in result) return setError(result.error);
    onClose();
    navigate(paths.visitPlan(result.plan.id));
  };

  return (
    <Modal maxWidth={600} z={46} gap={16} onBackdrop={onClose}>
      <ModalHeader title="New visit plan" sub="Which customers a salesperson should visit in a month or quarter, and how often. Only customer visits count." />
      <div className="vp-form-grid">
        <label className="form-label">
          Salesperson
          <select className="form-input" data-testid="plan-salesperson" value={d.salespersonUserId} onChange={(e) => setD((x) => ({ ...x, salespersonUserId: e.target.value }))}>
            <option value="" disabled>
              Pick a member…
            </option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {labels.get(m.id) ?? m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Period type
          <select
            className="form-input"
            data-testid="plan-period-type"
            value={d.periodType}
            onChange={(e) => {
              const periodType = e.target.value as VisitPlanPeriodType;
              setD((x) => ({ ...x, periodType, periodStart: periodStartOf(periodType, x.periodStart, fiscal) }));
            }}
          >
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
          </select>
        </label>
        <label className="form-label">
          Period
          <select className="form-input" data-testid="plan-period" value={d.periodStart} onChange={(e) => setD((x) => ({ ...x, periodStart: e.target.value }))}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {existing && (
        <div className="hint-box" data-testid="plan-exists">
          {existing.salespersonName} already has a plan for {label}.{' '}
          <Link to={paths.visitPlan(existing.id)} onClick={onClose} className="crumb-link">
            Open it
          </Link>
        </div>
      )}

      <div className="form-label" style={{ gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span>Customers · {total === 1 ? '1 visit' : `${total} visits`}</span>
          <button
            type="button"
            className="btn-outline"
            data-testid="plan-copy-previous"
            disabled={!previous}
            title={previous ? `Fill in the customers of ${previous.periodLabel}` : d.salespersonUserId ? `No plan for ${periodLabel(d.periodType, shiftPeriod(d.periodType, d.periodStart, -1), fiscal)}` : 'Pick the salesperson first'}
            onClick={copyPrevious}
            style={{ textTransform: 'none', letterSpacing: 0, opacity: previous ? 1 : 0.55, cursor: previous ? 'pointer' : 'not-allowed' }}
          >
            Copy from previous period
          </button>
        </span>
        <div className="vp-draft-lines" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
          {d.lines.map((l) => (
            <div key={l.companyId} className="vp-draft-line" data-testid="plan-draft-line">
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf.get(l.companyId) ?? 'Company'}</span>
              <input
                className="form-input vp-visits-input"
                inputMode="numeric"
                aria-label={`Planned visits at ${nameOf.get(l.companyId) ?? 'company'}`}
                value={l.plannedVisits}
                onChange={(e) => setLine(l.companyId, e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
                style={{ borderColor: validVisits(l.plannedVisits) ? undefined : 'var(--danger)' }}
              />
              <RemoveButton title="Remove" onClick={() => setD((x) => ({ ...x, lines: x.lines.filter((y) => y.companyId !== l.companyId) }))} />
            </div>
          ))}
          {d.lines.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>No customers yet.</span>}
          <div style={{ border: '1px solid var(--border)', borderRadius: 7 }} data-testid="plan-add-company">
            <Picker
              picker={picker}
              placeholder="Add a customer…"
              items={
                available.length ? (
                  available.map((c) => (
                    <PickerRow
                      key={c.id}
                      square
                      initials={initialsOf(c.name)}
                      title={c.name}
                      subtitle={c.hq && c.hq !== '—' ? c.hq : ''}
                      onPick={() => {
                        setD((x) => ({ ...x, lines: [...x.lines, { companyId: c.id, plannedVisits: '1' }] }));
                        picker.close();
                      }}
                    />
                  ))
                ) : (
                  <div style={{ padding: 8, fontSize: 12.5, color: 'var(--muted)' }}>No more companies.</div>
                )
              }
            />
          </div>
        </div>
      </div>

      <label className="form-label">
        Note
        <textarea className="form-input" rows={2} maxLength={2000} placeholder="Optional: focus, context for the salesperson" value={d.note} onChange={(e) => setD((x) => ({ ...x, note: e.target.value }))} />
      </label>
      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      <div className="modal-actions" style={{ gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" data-testid="plan-save" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Create plan'}
        </button>
      </div>
    </Modal>
  );
}

