import { useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { ADJUSTMENT_KIND_LABEL, type AdjustmentKind, type ApiBalance, timeOffApi } from '../../lib/timeOffApi';
import { projectError, useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';
import { dateLabel } from '../employee/parts';

const days = (n: number) => `${n} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Reads one employee's balance for a year; a 403 or 404 answers null (the section hides). */
export function useBalance(employeeId: string, year?: number) {
  return useProjectsRead<ApiBalance | null>(
    true,
    () => timeOffApi.balance(employeeId, year).catch((err) => (err instanceof ApiError && (err.status === 403 || err.status === 404) ? null : Promise.reject(err))),
    `timeoff:balance:${employeeId}:${year ?? ''}`,
    'timeOffRev',
  );
}

/** One figure of the balance card. */
function Figure({ label, value, hint, strong, testId }: { label: string; value: number | string; hint?: string; strong?: boolean; testId?: string }) {
  return (
    <div className="bal-figure" data-testid={testId}>
      <span className="caps">{label}</span>
      <strong style={strong ? { fontSize: 22 } : undefined}>{value}</strong>
      {hint && <span className="emp-note">{hint}</span>}
    </div>
  );
}

/**
 * The balance card (CD-164, spec 6.3): the figures of a year with the carry-over note, the two-week
 * part, and (Admins) Adjust balance. `compact` on the employee card shows the main figures only;
 * the full card adds the balance history (spec 6.5).
 */
export function BalanceCard({ balance, compact, onChanged }: { balance: ApiBalance; compact?: boolean; onChanged: (b?: ApiBalance) => void }) {
  const [adjusting, setAdjusting] = useState(false);
  const f = balance.figures;
  const expiresOn = dateLabel(f.carryExpiresOn);
  return (
    <div className="bal-card" data-testid="balance-card" data-year={balance.year}>
      <div className="bal-head">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Vacation balance {balance.year}</span>
        {balance.canAdjust && (
          <button type="button" className="btn-outline" onClick={() => setAdjusting(true)} data-testid="balance-adjust">
            Adjust balance
          </button>
        )}
      </div>
      {!balance.hasStartDate && <p className="emp-note emp-warn">Start date missing: there is no entitlement until the employment start date is set.</p>}
      <div className="bal-figures">
        <Figure label="Remaining" value={f.remaining} strong testId="balance-remaining" hint={f.carryRemaining > 0 ? `of which ${f.carryRemaining} carried over (expire ${expiresOn})` : undefined} />
        <Figure label="Available to request" value={f.available} hint={f.pending ? `${days(f.pending)} pending` : undefined} testId="balance-available" />
        <Figure label="Used" value={f.used} />
        <Figure label="Scheduled" value={f.scheduled} />
      </div>
      <div className="bal-figures bal-figures-small">
        <Figure label="Entitlement" value={f.entitlement} />
        <Figure label="Carried over" value={f.carriedOver} hint={f.carriedOver ? `expires ${expiresOn}` : undefined} />
        <Figure label="Adjustments" value={signed(f.adjustments)} />
        <Figure label="Total" value={f.total} />
        {f.expired > 0 && <Figure label="Expired" value={f.expired} hint={`not used by ${expiresOn}`} testId="balance-expired" />}
      </div>
      <span className="emp-note" data-testid="balance-two-week">
        Two-week part: {f.twoWeekPart ? 'taken' : 'not yet'} · Policy {balance.policy.name}
        {balance.policy.carryOver ? ` · carry-over until 30 June${balance.policy.carryOverCap !== null ? ` (up to ${balance.policy.carryOverCap} days)` : ''}` : ' · no carry-over'}
      </span>
      {!compact && (
        <div className="bal-history" data-testid="balance-history">
          <span className="caps">Balance history</span>
          {balance.history.length === 0 ? (
            <span className="emp-note">Nothing yet.</span>
          ) : (
            balance.history.map((h, i) => (
              <div key={i} className="bal-history-row" data-kind={h.kind}>
                <span className="emp-note">{dateLabel(h.date)}</span>
                <span>
                  {h.label}
                  {h.actor ? <span className="emp-note"> · {h.actor.name}</span> : null}
                </span>
                <span className={h.days < 0 ? 'bal-neg' : undefined}>{signed(h.days)}</span>
                <span className="emp-note">{h.runningTotal}</span>
              </div>
            ))
          )}
          {balance.expiryRecordedAt && <span className="emp-note">Expiry recorded on {dateLabel(balance.expiryRecordedAt.slice(0, 10))}.</span>}
        </div>
      )}
      {adjusting && (
        <AdjustDialog
          balance={balance}
          onClose={(saved) => {
            setAdjusting(false);
            if (saved) onChanged(saved);
          }}
        />
      )}
    </div>
  );
}

/** Adjust balance (Admins, spec 6.4): pool year, days, type and a reason; append-only. */
function AdjustDialog({ balance, onClose }: { balance: ApiBalance; onClose: (saved?: ApiBalance) => void }) {
  const { flash } = useStore();
  const [poolYear, setPoolYear] = useState(balance.year);
  const [daysText, setDaysText] = useState('');
  const [kind, setKind] = useState<AdjustmentKind>('correction');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const years = [balance.currentYear - 1, balance.currentYear, balance.currentYear + 1];
  const save = async () => {
    const n = /^[+-]?\d+$/.test(daysText.trim()) ? Number(daysText.trim()) : null;
    if (n === null || n === 0 || n < -60 || n > 60) return setProblem('Enter a whole number of days between -60 and 60, not 0');
    if (!reason.trim()) return setProblem('A reason is needed');
    setBusy(true);
    setProblem(null);
    try {
      const saved = await timeOffApi.adjust(balance.employeeId, { poolYear, days: n, kind, reason: reason.trim() });
      flash(`${signed(n)} ${Math.abs(n) === 1 ? 'day' : 'days'} on the ${poolYear} pool of ${balance.fullName}`);
      onClose(saved);
    } catch (err) {
      setProblem(projectError(err));
      setBusy(false);
    }
  };
  return (
    <Modal maxWidth={460} onBackdrop={() => !busy && onClose()}>
      <ModalHeader title="Adjust balance" sub={`${balance.fullName} · a new entry in the balance history; a wrong one is undone by an opposite one`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="adjust-dialog">
        <label className="policy-field">
          <span className="th">Pool year</span>
          <select className="form-input" value={poolYear} onChange={(e) => setPoolYear(Number(e.target.value))} data-testid="adjust-year">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
                {y === balance.currentYear - 1 ? ' (carry-over)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="policy-field">
          <span className="th">Type</span>
          <select className="form-input" value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)} data-testid="adjust-kind">
            {(Object.keys(ADJUSTMENT_KIND_LABEL) as AdjustmentKind[]).map((k) => (
              <option key={k} value={k}>
                {ADJUSTMENT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="policy-field">
          <span className="th">Days</span>
          <input className="form-input" inputMode="numeric" value={daysText} placeholder="e.g. -5 for days used before Pultly, 2 for extra days" onChange={(e) => setDaysText(e.target.value)} data-testid="adjust-days" />
        </label>
        <label className="policy-field">
          <span className="th">Reason</span>
          <input className="form-input" value={reason} maxLength={300} placeholder="Required. Do not enter health information." onChange={(e) => setReason(e.target.value)} data-testid="adjust-reason" />
        </label>
        <span className="emp-note">The employee gets an email about the adjustment unless they turned "Time off balance" off.</span>
        {problem && (
          <span className="emp-error" role="alert">
            {problem}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onClose()}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()} data-testid="adjust-save">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
