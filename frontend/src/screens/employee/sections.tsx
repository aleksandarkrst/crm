import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiApprovals, ApiEmployeeCard, ApiPeopleHistoryEntry, EmployeePatch, EmploymentType } from '../../lib/api';
import { formatIban, INVALID_ACCOUNT_MESSAGE, isSwiftBic, parseBankAccount } from '../../lib/iban';
import { paths } from '../../lib/paths';
import { EMPLOYMENT_TYPE_LABEL, LEAVING_REASON_LABEL } from '../../store/employeeCard';
import { managerForUnit, unitForManager, unitPathLabel, unitTree } from '../../store/orgChart';
import { useStore } from '../../store/store';
import { type Draft, patchOf } from '../../store/cardDraft';
import { CheckField, dateLabel, EditableSection, FIELD_LABEL, Row, SelectField, TextField, Val } from './parts';

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const EMPLOYMENT_OPTIONS = (Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[]).map((value) => ({ value, label: EMPLOYMENT_TYPE_LABEL[value] }));

// ------------------------------------------------------------------ Work (spec 4.2)

const PERSONAL = ['dateOfBirth', 'privateEmail', 'privatePhone', 'addressStreet', 'addressPostalCode', 'addressCity', 'addressCountry', 'emergencyContactName', 'emergencyContactPhone'] as const;

/**
 * The whole card's starting values (CD-225: one draft): strings for inputs, booleans for
 * switches. The bank account's numbers start empty: the stored ones never come to the browser in
 * full, and an empty input keeps the stored IBAN.
 */
export function cardInitial(card: ApiEmployeeCard): Draft {
  const e = card.employment;
  const p = card.personal;
  const b = card.bank;
  return {
    firstName: card.firstName,
    lastName: card.lastName,
    jobTitle: str(card.jobTitle),
    workEmail: str(card.workEmail),
    workPhone: str(card.workPhone),
    workLocation: str(card.workLocation),
    unitId: str(card.unitId),
    ...(e
      ? {
          employeeNumber: str(e.employeeNumber),
          employmentStartDate: str(e.startDate),
          employmentType: e.type,
          weeklyHours: str(e.weeklyHours),
          // Timesheet required: a future feature (CD-225, everyone fills in a timesheet for now). The
          // column and the API stay (default Yes); the card doesn't show or send it.
          // timesheetRequired: e.timesheetRequired,
        }
      : {}),
    managerId: str(card.managerId),
    ...(p ? Object.fromEntries(PERSONAL.map((f) => [f, str(p[f])])) : {}),
    ...(b ? { iban: '', bankName: str(b.bankName), fxSameAsIban: b.fxSameAsIban, fxIban: '', swiftBic: str(b.swiftBic), fxBankName: str(b.fxBankName), fxBankAddress: str(b.fxBankAddress) } : {}),
  };
}

/** The changed fields as the API takes them, or why they can't be saved. */
export function cardPatch(changed: Draft): EmployeePatch | string {
  const patch = patchOf(changed) as EmployeePatch;
  if ('weeklyHours' in changed) {
    const hours = Number(String(changed.weeklyHours).replace(',', '.'));
    if (!Number.isFinite(hours) || hours < 1 || hours > 60) return 'Weekly hours are between 1 and 60';
    patch.weeklyHours = hours;
  }
  if (patch.firstName === null || patch.lastName === null) return 'First and last name are required';
  if ('employmentStartDate' in changed && !changed.employmentStartDate) return 'The employment start date is required';
  for (const key of ['iban', 'fxIban'] as const) {
    const v = changed[key];
    if (typeof v === 'string' && v.trim() && !parseBankAccount(v)) return `${FIELD_LABEL[key]}: ${INVALID_ACCOUNT_MESSAGE}`;
  }
  if (typeof changed.swiftBic === 'string' && changed.swiftBic.trim() && !isSwiftBic(changed.swiftBic)) return 'SWIFT/BIC has 8 or 11 characters, e.g. AIKBRS22';
  return patch;
}

export function WorkSection({ card }: { card: ApiEmployeeCard }) {
  const { s, employeeCard } = useStore();
  const pickers = s.peoplePickers;
  const e = card.employment;
  const ensure = employeeCard.ensurePickers;
  const editsOrg = card.permissions.editableFields.includes('unitId');
  // Read again when the org changed since (a unit added in the panel shows at once, CD-225).
  const orgRev = s.orgRev;
  useEffect(() => {
    if (editsOrg) void ensure();
  }, [editsOrg, ensure, orgRev]);
  // One "Unit" select with the tree's paths (CD-226: "Sales › Field sales").
  const allUnits = pickers?.units ?? [];
  const units = [{ value: '', label: 'No unit' }, ...unitTree(allUnits).map(({ unit }) => ({ value: unit.id, label: unitPathLabel(allUnits, unit.id) }))];
  if (card.unitId && !units.some((u) => u.value === card.unitId)) units.push({ value: card.unitId, label: card.unitName ?? 'Unit' });
  const unitLabel = card.unitId ? unitPathLabel(allUnits, card.unitId, card.unitName) : null;

  return (
    <EditableSection
      title="Work"
      testId="emp-work"
      fields={['firstName', 'lastName', 'jobTitle', 'workEmail', 'workPhone', 'workLocation', 'unitId', 'employeeNumber', 'employmentStartDate', 'employmentType', 'weeklyHours']}
      view={
        <>
          <Row label="Job title">
            <Val v={card.jobTitle} />
          </Row>
          <Row label="Unit" testId="emp-unit">
            <Val v={unitLabel} hint="No unit" />
          </Row>
          {card.leadsUnit && <Row label="Leads">{card.leadsUnit.name}</Row>}
          <Row label="Work email" testId="emp-work-email">
            {card.workEmail ? <a href={`mailto:${card.workEmail}`}>{card.workEmail}</a> : <Val v={null} />}
          </Row>
          <Row label="Work phone" testId="emp-work-phone">
            {card.workPhone ? <a href={`tel:${card.workPhone}`}>{card.workPhone}</a> : <Val v={null} />}
          </Row>
          <Row label="Work location">
            <Val v={card.workLocation} />
          </Row>
          {e && (
            <>
              <Row label="Employee number">
                <Val v={e.employeeNumber} />
              </Row>
              <Row label="Start date">
                <Val v={dateLabel(e.startDate)} hint="Start date missing" />
              </Row>
              <Row label="Employment type">{EMPLOYMENT_TYPE_LABEL[e.type]}</Row>
              <Row label="Weekly hours">{e.weeklyHours}</Row>
              {/* Timesheet required: a future feature (CD-225). <Row label="Timesheet required">{e.timesheetRequired ? 'Yes' : 'No'}</Row> */}
              {e.endDate && <Row label="Employment end date">{dateLabel(e.endDate)}</Row>}
              {e.leavingReason && <Row label="Reason for leaving">{LEAVING_REASON_LABEL[e.leavingReason]}</Row>}
            </>
          )}
        </>
      }
      edit={(draft, setField, can) => {
        return (
          <>
            <TextField field="firstName" draft={draft} setField={setField} can={can} maxLength={100} />
            <TextField field="lastName" draft={draft} setField={setField} can={can} maxLength={100} />
            <TextField field="jobTitle" draft={draft} setField={setField} can={can} maxLength={100} />
            <SelectField field="unitId" draft={draft} setField={setField} can={can} options={units} />
            {card.leadsUnit && <Row label="Leads">{card.leadsUnit.name}</Row>}
            <TextField field="workEmail" type="email" draft={draft} setField={setField} can={can} maxLength={254} />
            <TextField field="workPhone" type="tel" draft={draft} setField={setField} can={can} maxLength={40} />
            <TextField field="workLocation" draft={draft} setField={setField} can={can} maxLength={100} placeholder="e.g. Belgrade HQ" />
            {e && (
              <>
                <TextField field="employeeNumber" draft={draft} setField={setField} can={can} maxLength={30} />
                <TextField field="employmentStartDate" type="date" draft={draft} setField={setField} can={can} />
                <SelectField field="employmentType" draft={draft} setField={setField} can={can} options={EMPLOYMENT_OPTIONS} />
                <TextField field="weeklyHours" type="number" draft={draft} setField={setField} can={can} />
                {/* Timesheet required: a future feature (CD-225). <CheckField field="timesheetRequired" draft={draft} setField={setField} can={can} /> */}
                {e.endDate && <Row label="Employment end date">{dateLabel(e.endDate)}</Row>}
                {e.leavingReason && <Row label="Reason for leaving">{LEAVING_REASON_LABEL[e.leavingReason]}</Row>}
              </>
            )}
            {card.account === 'invited' && can('workEmail') && <div className="emp-note">Changing the work email withdraws the pending invitation.</div>}
          </>
        );
      }}
    />
  );
}

// ------------------------------------------------------------------ Reporting (spec 4.5, 7.4)

/** "Approvals go to: Marko Ilić (manager)" from the approver rule. */
function approvalsText(a: ApiApprovals): string {
  if (a.kind === 'manager') return `${a.approvers[0]?.fullName ?? 'Their manager'} (manager)`;
  if (a.kind === 'self') return 'Self-approved (no other Admin)';
  const why = a.reason === 'no_manager' ? 'no manager' : a.reason === 'manager_no_account' ? 'manager has no app account' : a.reason === 'manager_inactive' ? 'manager has left' : 'manager is away';
  return `Admins (${why})`;
}

export function ReportingSection({ card }: { card: ApiEmployeeCard }) {
  const { s, employeeCard } = useStore();
  const pickers = s.peoplePickers;
  const [approvals, setApprovals] = useState<ApiApprovals | null>(card.approvals);
  const ensure = employeeCard.ensurePickers;
  const editsManager = card.permissions.editableFields.includes('managerId');
  useEffect(() => {
    if (editsManager) void ensure();
  }, [editsManager, ensure]);
  // From the approver rule's own endpoint, read again whenever the card changes (a new manager).
  const load = employeeCard.approvers;
  useEffect(() => {
    let alive = true;
    load(card.id).then(
      (a) => alive && setApprovals(a),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [card.id, card.version, card.managerId, load]);
  const managers = [
    { value: '', label: 'No manager' },
    ...(pickers?.employees ?? []).filter((x) => x.id !== card.id && x.status !== 'inactive').map((x) => ({ value: x.id, label: x.jobTitle ? `${x.fullName} · ${x.jobTitle}` : x.fullName })),
  ];
  if (card.managerId && !managers.some((m) => m.value === card.managerId)) managers.push({ value: card.managerId, label: card.managerName ?? 'Manager' });
  const ceoId = s.workspace.ceoEmployeeId;
  const nameOf = (id: string | null) => (id ? (pickers?.employees.find((x) => x.id === id)?.fullName ?? null) : null);
  /**
   * What saving will do to the other field (CD-226): a new unit brings its lead as manager, a new
   * manager their unit; when both change, both stay as chosen. The server decides (and skips loops).
   */
  const derived = (draft: { unitId?: unknown; managerId?: unknown }): string | null => {
    const unitId = typeof draft.unitId === 'string' ? draft.unitId : (card.unitId ?? '');
    const managerId = typeof draft.managerId === 'string' ? draft.managerId : (card.managerId ?? '');
    const unitChanged = unitId !== (card.unitId ?? '');
    const managerChanged = managerId !== (card.managerId ?? '');
    if (!pickers || unitChanged === managerChanged) return null;
    if (unitChanged && unitId) {
      const next = managerForUnit(pickers.units, unitId, card.id, ceoId);
      return next && next !== card.managerId ? `Saving makes ${nameOf(next) ?? 'the unit\'s lead'} their manager.` : null;
    }
    if (managerChanged && managerId && !card.leadsUnit) {
      const next = unitForManager(pickers.units, pickers.employees, managerId);
      return next && next !== card.unitId ? `Saving moves them to ${unitPathLabel(pickers.units, next)}.` : null;
    }
    return null;
  };

  return (
    <EditableSection
      title="Reporting"
      testId="emp-reporting"
      fields={['managerId']}
      view={
        <>
          <Row label="Reports to" testId="emp-reports-to">
            {card.manager ? (
              <span>
                <Link to={paths.employee(card.manager.id)}>{card.manager.fullName}</Link>
                {card.manager.manager && (
                  <span className="emp-note">
                    {' '}
                    · reports to <Link to={paths.employee(card.manager.manager.id)}>{card.manager.manager.fullName}</Link>
                  </span>
                )}
                {!card.manager.hasAccount && <span className="emp-note emp-warn"> · {card.manager.fullName.split(' ')[0]} has no app account: approvals go to Admins until they join</span>}
              </span>
            ) : (
              <Val v={null} hint="No manager" />
            )}
          </Row>
          <Row label="Direct reports">
            {card.directReports.length ? (
              <span className="emp-list">
                {card.directReports.map((r) => (
                  <Link key={r.id} to={paths.employee(r.id)}>
                    {r.fullName}
                  </Link>
                ))}
              </span>
            ) : (
              <Val v={null} hint="None" />
            )}
          </Row>
          {approvals && (
            <Row label="Approvals go to" testId="emp-approvals">
              {approvalsText(approvals)}
            </Row>
          )}
        </>
      }
      edit={(draft, setField, can) => (
        <>
          <SelectField field="managerId" draft={draft} setField={setField} can={can} options={managers} />
          {derived(draft) && (
            <div className="emp-note" data-testid="emp-derived">
              {derived(draft)}
            </div>
          )}
          <Row label="Direct reports">
            {card.directReports.length ? (
              <span className="emp-list">
                {card.directReports.map((r) => (
                  <Link key={r.id} to={paths.employee(r.id)}>
                    {r.fullName}
                  </Link>
                ))}
              </span>
            ) : (
              <Val v={null} hint="None" />
            )}
          </Row>
          {approvals && (
            <Row label="Approvals go to" testId="emp-approvals">
              {approvalsText(approvals)}
            </Row>
          )}
        </>
      )}
    />
  );
}

// ------------------------------------------------------------------ Personal details (spec 4.3)

export function PersonalSection({ card }: { card: ApiEmployeeCard }) {
  const p = card.personal!;
  const address = [p.addressStreet, [p.addressPostalCode, p.addressCity].filter(Boolean).join(' '), p.addressCountry].filter(Boolean).join(', ');
  return (
    <EditableSection
      title="Personal details"
      testId="emp-personal"
      fields={[...PERSONAL]}
      view={
        <>
          <Row label="Date of birth">
            <Val v={dateLabel(p.dateOfBirth)} />
          </Row>
          <Row label="Private email">
            <Val v={p.privateEmail} />
          </Row>
          <Row label="Private phone">
            <Val v={p.privatePhone} />
          </Row>
          <Row label="Address" testId="emp-address">
            <Val v={p.addressStreet || p.addressCity ? address : ''} />
          </Row>
          <Row label="Emergency contact">
            <Val v={[p.emergencyContactName, p.emergencyContactPhone].filter(Boolean).join(' · ')} />
          </Row>
        </>
      }
      edit={(draft, setField, can) => (
        <>
          <TextField field="dateOfBirth" type="date" draft={draft} setField={setField} can={can} />
          <TextField field="privateEmail" type="email" draft={draft} setField={setField} can={can} maxLength={254} />
          <TextField field="privatePhone" type="tel" draft={draft} setField={setField} can={can} maxLength={40} />
          <TextField field="addressStreet" draft={draft} setField={setField} can={can} maxLength={200} />
          <TextField field="addressPostalCode" draft={draft} setField={setField} can={can} maxLength={10} />
          <TextField field="addressCity" draft={draft} setField={setField} can={can} maxLength={100} />
          <TextField field="addressCountry" draft={draft} setField={setField} can={can} maxLength={100} />
          <TextField field="emergencyContactName" draft={draft} setField={setField} can={can} maxLength={100} />
          <TextField field="emergencyContactPhone" type="tel" draft={draft} setField={setField} can={can} maxLength={40} />
        </>
      )}
    />
  );
}

// ------------------------------------------------------------------ Bank account (spec 4.4)

/** What the typed account becomes: the IBAN to be saved, a domestic number converted, or why not. */
function AccountPreview({ value }: { value: string }) {
  if (!value.trim()) return null;
  const parsed = parseBankAccount(value);
  if (!parsed) return <span className="emp-note emp-warn">{INVALID_ACCOUNT_MESSAGE}</span>;
  return (
    <span className="emp-note" data-testid="emp-iban-preview">
      {parsed.convertedFromDomestic ? 'Saved as IBAN ' : 'IBAN '}
      <strong>{formatIban(parsed.iban)}</strong>
      {parsed.foreign && ' · Foreign account'}
    </span>
  );
}

/** The masked number with "Show" (reveals the full number, audited) and "Copy". */
function IbanValue({ card, account }: { card: ApiEmployeeCard; account: 'iban' | 'fxIban' }) {
  const { employeeCard, flash } = useStore();
  const masked = card.bank?.[account];
  const [shown, setShown] = useState<{ version: string; formatted: string; domestic: string | null } | null>(null);
  if (!masked) return <Val v={null} />;
  const current = shown && shown.version === card.version ? shown : null;
  const reveal = async () => {
    const r = await employeeCard.reveal(card.id, account);
    if (r) setShown({ version: card.version, formatted: r.formatted, domestic: r.domestic });
  };
  const copy = async () => {
    const r = await employeeCard.reveal(card.id, account);
    if (!r) return;
    await navigator.clipboard.writeText(r.iban).then(
      () => flash('IBAN copied'),
      () => flash('IBAN: ' + r.formatted, 12000),
    );
  };
  return (
    <span className="emp-iban">
      <span className="emp-iban-number" data-testid={`emp-${account}`}>
        {current ? current.formatted : masked.masked}
      </span>
      {current?.domestic && <span className="emp-note">{current.domestic}</span>}
      {masked.foreign && <span className="badge badge-neutral">Foreign account</span>}
      {card.permissions.canRevealBank && (
        <span className="emp-links">
          <button type="button" className="emp-link" onClick={() => (current ? setShown(null) : void reveal())}>
            {current ? 'Hide' : 'Show'}
          </button>
          <button type="button" className="emp-link" onClick={() => void copy()}>
            Copy
          </button>
        </span>
      )}
    </span>
  );
}

export function BankSection({ card }: { card: ApiEmployeeCard }) {
  const b = card.bank!;
  return (
    <EditableSection
      title="Bank account"
      testId="emp-bank"
      fields={['iban', 'bankName', 'fxSameAsIban', 'fxIban', 'swiftBic', 'fxBankName', 'fxBankAddress']}
      view={
        <>
          <Row label="IBAN">
            <IbanValue card={card} account="iban" />
          </Row>
          <Row label="Bank">
            <Val v={b.bankName} />
          </Row>
          <div className="emp-subhead">Foreign currency account</div>
          {b.fxSameAsIban ? (
            <Row label="FX IBAN">
              <span className="emp-note">Same as the IBAN</span>
            </Row>
          ) : (
            <Row label="FX IBAN">
              <IbanValue card={card} account="fxIban" />
            </Row>
          )}
          <Row label="SWIFT/BIC">
            <Val v={b.swiftBic} />
          </Row>
          {(b.fxBankName || b.fxBankAddress) && (
            <Row label="FX bank">
              <Val v={[b.fxBankName, b.fxBankAddress].filter(Boolean).join(', ')} />
            </Row>
          )}
        </>
      }
      edit={(draft, setField, can) => (
        <>
          {b.iban && (
            <Row label="Stored IBAN">
              <IbanValue card={card} account="iban" />
            </Row>
          )}
          {can('iban') && (
            <Row label="IBAN">
              <span className="emp-iban-edit">
                <input
                  className="form-input emp-input"
                  aria-label="IBAN"
                  name="iban"
                  value={String(draft.iban)}
                  placeholder={b.iban ? `Keep ${b.iban.masked}` : 'RS35… or 260-0056010016113-79'}
                  onChange={(e) => setField('iban', e.target.value)}
                />
                <AccountPreview value={String(draft.iban)} />
              </span>
            </Row>
          )}
          <TextField field="bankName" draft={draft} setField={setField} can={can} maxLength={100} />
          <div className="emp-subhead">Foreign currency account</div>
          <CheckField field="fxSameAsIban" draft={draft} setField={setField} can={can} label="Same as the IBAN" />
          {draft.fxSameAsIban !== true && b.fxIban && (
            <Row label="Stored FX IBAN">
              <IbanValue card={card} account="fxIban" />
            </Row>
          )}
          {draft.fxSameAsIban !== true && can('fxIban') && (
            <Row label="FX IBAN">
              <span className="emp-iban-edit">
                <input className="form-input emp-input" aria-label="FX IBAN" name="fxIban" value={String(draft.fxIban)} placeholder={b.fxIban ? `Keep ${b.fxIban.masked}` : 'IBAN for EUR payments'} onChange={(e) => setField('fxIban', e.target.value)} />
                <AccountPreview value={String(draft.fxIban)} />
              </span>
            </Row>
          )}
          <TextField field="swiftBic" draft={draft} setField={setField} can={can} maxLength={11} placeholder="e.g. AIKBRS22" />
          <TextField field="fxBankName" draft={draft} setField={setField} can={can} maxLength={100} />
          <TextField field="fxBankAddress" draft={draft} setField={setField} can={can} maxLength={200} />
          <div className="emp-note">The employee gets a “Bank account changed” email whenever the IBAN changes. A Serbian account number like 260-0056010016113-79 is saved as its IBAN.</div>
        </>
      )}
      extraAction={<RemoveIban card={card} />}
    />
  );
}

/** "Remove" the stored IBAN (only when one is stored and the caller may change it). */
function RemoveIban({ card }: { card: ApiEmployeeCard }) {
  const { employeeCard, flash } = useStore();
  if (!card.bank?.iban || !card.permissions.editableFields.includes('iban')) return null;
  const remove = async () => {
    if (!window.confirm(`Remove the bank account ${card.bank!.iban!.masked}?`)) return;
    const r = await employeeCard.save(card.id, { iban: null });
    if ('error' in r) flash(r.error, 7000);
  };
  return (
    <button type="button" className="emp-link" onClick={() => void remove()}>
      Remove IBAN
    </button>
  );
}

// ------------------------------------------------------------------ History (spec 4.5)
// Not shown on the card since CD-225 (the product owner found the audit log too bulky there). The
// API and this section stay, so it can come back, e.g. behind a "History" link.

const historyValue = (e: ApiPeopleHistoryEntry, which: 'old' | 'new'): string => {
  const label = which === 'old' ? e.oldLabel : e.newLabel;
  if (label) return label;
  const v = which === 'old' ? e.oldValue : e.newValue;
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (e.field === 'employmentType' && typeof v === 'string') return EMPLOYMENT_TYPE_LABEL[v as EmploymentType] ?? v;
  if (e.field === 'leavingReason' && typeof v === 'string') return LEAVING_REASON_LABEL[v as keyof typeof LEAVING_REASON_LABEL] ?? v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return dateLabel(v);
  return String(v);
};

function historyLine(e: ApiPeopleHistoryEntry): string {
  if (e.action === 'created') return 'Created the record';
  if (e.action === 'deleted') return 'Deleted the record';
  if (e.field === 'userId') return e.newValue ? `Linked the account of ${historyValue(e, 'new')}` : 'Unlinked the account';
  const field = FIELD_LABEL[e.field ?? ''] ?? e.field ?? 'a field';
  return `${field}: ${historyValue(e, 'old')} → ${historyValue(e, 'new')}`;
}

export function HistorySection({ card }: { card: ApiEmployeeCard }) {
  const { employeeCard } = useStore();
  const [entries, setEntries] = useState<ApiPeopleHistoryEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const history = employeeCard.history;
  useEffect(() => {
    let alive = true;
    history(card.id).then(
      (r) => {
        if (!alive) return;
        setEntries(r.entries);
        setMore(r.more);
      },
      () => alive && setEntries([]),
    );
    return () => {
      alive = false;
    };
  }, [card.id, card.version, history]);
  const loadMore = async () => {
    const r = await history(card.id, entries?.length ?? 0);
    setEntries((x) => [...(x ?? []), ...r.entries]);
    setMore(r.more);
  };
  return (
    <div className="card card-pad emp-section" data-testid="emp-history">
      <div className="emp-section-head">
        <span style={{ fontSize: 15, fontWeight: 600 }}>History</span>
      </div>
      <div className="emp-section-body">
        {entries === null ? (
          <span className="emp-note">Loading…</span>
        ) : entries.length === 0 ? (
          <span className="emp-note">No changes yet.</span>
        ) : (
          <ul className="emp-history">
            {entries.map((e) => (
              <li key={e.id}>
                <span>{historyLine(e)}</span>
                <span className="emp-note">
                  {e.actor?.name ?? 'Pultly'} · {new Date(e.changedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {more && (
          <button type="button" className="emp-link" onClick={() => void loadMore()}>
            Show older changes
          </button>
        )}
      </div>
    </div>
  );
}

