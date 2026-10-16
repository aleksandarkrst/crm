import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { Modal, ModalHeader, Switch } from '../../components/ui';
import { downloadBlob } from '../../lib/csv';
import { type ApiDecision, type ApiDecisionRow, type ApiTimeOffSettings, DECISION_STATE_LABEL, decisionFileName, decisionStatusLabel, timeOffApi } from '../../lib/timeOffApi';
import { projectError, useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';
import { dateLabel } from '../employee/parts';
import { periodLabel } from './RequestsList';

const STATE_BADGE: Record<ApiDecision['state'], string> = { valid: 'badge badge-brand', outdated: 'badge badge-warn', cancelled: 'badge badge-neutral', superseded: 'badge badge-neutral' };

/** Downloads a decision's PDF; returns an error to show, or null. */
export async function downloadDecision(d: Pick<ApiDecision, 'id' | 'number' | 'version'>): Promise<string | null> {
  try {
    downloadBlob(decisionFileName(d), await timeOffApi.decisions.pdf(d.id));
    return null;
  } catch (err) {
    return projectError(err);
  }
}

/**
 * The vacation decision on a request (CD-167, spec 11.4): number, where the PDF is, Download and,
 * for the employee, Confirm receipt. Only the employee and Admins get `decision` from the API.
 */
export function DecisionLine({ decision, own, onChanged }: { decision: ApiDecision; own: boolean; onChanged: () => void }) {
  const { flash } = useStore();
  const [busy, setBusy] = useState(false);
  const acknowledge = async () => {
    setBusy(true);
    try {
      await timeOffApi.decisions.acknowledge(decision.id);
      flash('Receipt confirmed');
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(false);
  };
  return (
    <span className="req-decision" data-testid="request-decision">
      <span>
        Decision {decision.number}
        {decision.version > 1 ? ` (version ${decision.version})` : ''} · {decision.state === 'valid' ? decisionStatusLabel(decision) : DECISION_STATE_LABEL[decision.state]}
        {decision.status === 'failed' && decision.error ? `: ${decision.error}` : ''}
        {decision.acknowledgedAt ? ` · Receipt confirmed ${dateLabel(decision.acknowledgedAt.slice(0, 10))}` : ''}
      </span>
      {decision.status === 'ready' && (
        <button type="button" className="btn-plain" onClick={() => void downloadDecision(decision).then((e) => e && flash(e))} data-testid="decision-download">
          Download PDF
        </button>
      )}
      {own && decision.status === 'ready' && !decision.acknowledgedAt && decision.state !== 'superseded' && (
        <button type="button" className="btn-plain" disabled={busy} onClick={() => void acknowledge()} data-testid="decision-acknowledge">
          Confirm receipt
        </button>
      )}
    </span>
  );
}

/**
 * Time off → Decisions (CD-167, spec 11.5, Admins): every vacation decision with its versions,
 * filtered by year and state; Download and Generate again (a new version, the same number).
 */
export function DecisionsTab() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [state, setState] = useState<ApiDecision['state'] | ''>('');
  const { data, error, reload } = useProjectsRead<ApiDecisionRow[]>(true, () => timeOffApi.decisions.list({ year: Number(year), state: state || undefined }), `timeoff:decisions:${year}:${state}`, 'timeOffRev');
  const [regenerating, setRegenerating] = useState<ApiDecisionRow | null>(null);
  const { flash } = useStore();
  const thisYear = new Date().getFullYear();
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="decisions">
      <div className="bal-filters">
        <select className="form-input" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select className="form-input" value={state} onChange={(e) => setState(e.target.value as ApiDecision['state'] | '')} aria-label="State">
          <option value="">Every state</option>
          {Object.entries(DECISION_STATE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <EmptyState title="Decisions could not be loaded" text={error} />
      ) : !data ? (
        <span className="emp-note">Loading</span>
      ) : !data.length ? (
        <span className="emp-note">No vacation decisions for these filters. They are made when vacation is approved in a workspace whose country is Serbia.</span>
      ) : (
        <div>
          {data.map((d) => (
            <div key={d.id} className="dec-row" data-testid="decision-row">
              <span className="req-main">
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  {d.number}
                  {d.version > 1 ? ` · version ${d.version}` : ''} · {d.employee.fullName}
                </span>
                <span style={{ fontSize: 13 }}>
                  {periodLabel(d)} · {d.workingDays} {d.workingDays === 1 ? 'working day' : 'working days'}
                </span>
                <span className="emp-note">
                  {decisionStatusLabel(d)}
                  {d.status === 'failed' && d.error ? `: ${d.error}` : ''}
                  {d.emailedTo?.length ? ` · Emailed to ${d.emailedTo.join(', ')}` : d.status === 'ready' ? ' · Not emailed' : ''}
                  {d.acknowledgedAt ? ` · Receipt confirmed ${dateLabel(d.acknowledgedAt.slice(0, 10))}` : d.status === 'ready' ? ' · Not acknowledged' : ''}
                </span>
              </span>
              <span className={STATE_BADGE[d.state]}>{DECISION_STATE_LABEL[d.state]}</span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {d.status === 'ready' && (
                  <button type="button" className="btn-plain" onClick={() => void downloadDecision(d).then((e) => e && flash(e))}>
                    Download PDF
                  </button>
                )}
                {d.state !== 'superseded' && d.state !== 'cancelled' && (
                  <button type="button" className="btn-plain" onClick={() => setRegenerating(d)} data-testid="decision-regenerate">
                    Generate again
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {regenerating && (
        <RegenerateDialog
          decision={regenerating}
          onClose={(done) => {
            setRegenerating(null);
            if (done) void reload();
          }}
        />
      )}
    </div>
  );
}

function RegenerateDialog({ decision, onClose }: { decision: ApiDecisionRow; onClose: (done?: boolean) => void }) {
  const { flash } = useStore();
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      await timeOffApi.decisions.regenerate(decision.id, email);
      flash(`Generating ${decision.number}, version ${decision.version + 1}`);
      onClose(true);
    } catch (err) {
      setProblem(projectError(err));
      setBusy(false);
    }
  };
  return (
    <Modal maxWidth={440} onBackdrop={() => !busy && onClose()}>
      <ModalHeader title="Generate this decision again?" sub={`${decision.number} · ${decision.employee.fullName}, ${periodLabel(decision)}`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span className="emp-note">A new version is made from today's data with the same number. This version stays and can still be downloaded.</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch on={email} onClick={() => setEmail(!email)} label="Email the new version" />
          <span style={{ fontSize: 13 }}>Email it to the employee and the decision recipients</span>
        </span>
        {problem && (
          <span className="emp-error" role="alert">
            {problem}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onClose()}>
            Back
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()} data-testid="regenerate-save">
            Generate
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Settings → Time off → Vacation decisions (CD-167, spec 12): who gets a copy besides the employee. Admins. */
export function DecisionRecipientsCard() {
  const { flash, canEditWorkspace } = useStore();
  const { data, set } = useProjectsRead<ApiTimeOffSettings>(true, () => timeOffApi.settings(), 'timeoff:settings:decisions', 'timeOffRev');
  const [emails, setEmails] = useState<string | null>(null);
  if (!data) return null;
  const save = async (patch: Partial<ApiTimeOffSettings>) => {
    try {
      set(await timeOffApi.updateSettings(patch));
      setEmails(null);
      flash('Saved');
    } catch (err) {
      flash(projectError(err));
    }
  };
  const list = (text: string) => text.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="decision-recipients">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Vacation decisions</span>
        <span className="emp-note">The decision PDF always goes to the employee. Choose who else gets a copy. Changes apply to later decisions only.</span>
      </div>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch on={data.decisionCopyAdmins} disabled={!canEditWorkspace} onClick={() => void save({ decisionCopyAdmins: !data.decisionCopyAdmins })} label="Copy to the Admins" />
        <span style={{ fontSize: 13 }}>Copy to the workspace's owners and admins</span>
      </span>
      <label className="policy-field">
        <span className="th">HR mailbox (up to 5 addresses)</span>
        <input
          className="form-input"
          value={emails ?? data.decisionCopyEmails.join(', ')}
          placeholder="hr@company.rs"
          disabled={!canEditWorkspace}
          onChange={(e) => setEmails(e.target.value)}
          data-testid="decision-copy-emails"
        />
      </label>
      {emails !== null && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setEmails(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save({ decisionCopyEmails: list(emails) })} data-testid="decision-copy-save">
            Save
          </button>
        </div>
      )}
    </div>
  );
}
