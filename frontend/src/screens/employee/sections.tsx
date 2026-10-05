import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiApprovals, ApiEmployeeCard, ApiPeopleHistoryEntry, EmployeePatch, EmploymentType } from '../../lib/api';
import { formatIban, INVALID_ACCOUNT_MESSAGE, isSwiftBic, parseBankAccount } from '../../lib/iban';
import { paths } from '../../lib/paths';
import { DERIVED_ROLE_HINT, EMPLOYMENT_TYPE_LABEL, LEAVING_REASON_LABEL, ROLE_LABEL } from '../../store/employeeCard';
import { useStore } from '../../store/store';
import { CheckField, dateLabel, defaultPatch, type Draft, EditableSection, FIELD_LABEL, Row, SelectField, TextField, Val } from './parts';

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const EMPLOYMENT_OPTIONS = (Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[]).map((value) => ({ value, label: EMPLOYMENT_TYPE_LABEL[value] }));

// ------------------------------------------------------------------ Work (spec 4.2)

export function WorkSection({ card }: { card: ApiEmployeeCard }) {
  const { s, employeeCard } = useStore();
  const pickers = s.peoplePickers;
  const e = card.employment;
  const ensure = employeeCard.ensurePickers;
  const editsOrg = card.permissions.editableFields.includes('departmentId');
  useEffect(() => {
    if (editsOrg) void ensure();
  }, [editsOrg, ensure]);
  const initial = (): Draft => ({
    firstName: card.firstName,
    lastName: card.lastName,
    jobTitle: str(card.jobTitle),
    workEmail: str(card.workEmail),
    workPhone: str(card.workPhone),
    workLocation: str(card.workLocation),
    departmentId: str(card.departmentId),
    teamId: str(card.teamId),
    ...(e
      ? {
          employeeNumber: str(e.employeeNumber),
          employmentStartDate: str(e.startDate),
          employmentType: e.type,
          weeklyHours: str(e.weeklyHours),
          timesheetRequired: e.timesheetRequired,
        }
      : {}),
  });
  const toPatch = (changed: Draft): EmployeePatch | string => {
    const patch = defaultPatch(changed);
    if ('weeklyHours' in changed) {
      const hours = Number(String(changed.weeklyHours).replace(',', '.'));
      if (!Number.isFinite(hours) || hours < 1 || hours > 60) return 'Weekly hours are between 1 and 60';
      patch.weeklyHours = hours;
    }
    if (patch.firstName === null || patch.lastName === null) return 'First and last name are required';
    if ('employmentStartDate' in changed && !changed.employmentStartDate) return 'The employment start date is required';
    // Choosing a team sets its department (the server checks it too).
    if (typeof patch.teamId === 'string' && pickers) {
      const team = pickers.teams.find((t) => t.id === patch.teamId);
      if (team) patch.departmentId = team.departmentId;
    }
    return patch;
  };
  const departments = [{ value: '', label: 'No department' }, ...(pickers?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))];
  if (card.departmentId && !departments.some((d) => d.value === card.departmentId)) departments.push({ value: card.departmentId, label: card.departmentName ?? 'Department' });

  return (
    <EditableSection
      card={card}
      title="Work"
      testId="emp-work"
      fields={['firstName', 'lastName', 'jobTitle', 'workEmail', 'workPhone', 'workLocation', 'departmentId', 'teamId', 'employeeNumber', 'employmentStartDate', 'employmentType', 'weeklyHours', 'timesheetRequired']}
      initial={initial}
      toPatch={toPatch}
      view={
        <>
          <Row label="Job title">
            <Val v={card.jobTitle} />
          </Row>
          <Row label="Department">
            <Val v={card.departmentName} hint="No department" />
          </Row>
          <Row label="Team">
            <Val v={card.teamName} hint="No team" />
          </Row>
          <Row label="Work email" testId="emp-work-email">
            {card.workEmail ? <a href={`mailto:${card.workEmail}`}>{card.workEmail}</a> : <Val v={null} />}
            {card.appAccess?.signInEmail && card.workEmail && card.appAccess.signInEmail.toLowerCase() !== card.workEmail.toLowerCase() && (
              <span className="emp-note"> · signs in as {card.appAccess.signInEmail}</span>
            )}
          </Row>
          <Row label="Work phone" testId="emp-work-phone">
            {card.workPhone ? <a href={`tel:${card.workPhone}`}>{card.workPhone}</a> : <Val v={null} />}
          </Row>
          <Row label="Work location">
            <Val v={card.workLocation} />
          </Row>
          {card.leadsTeams.length > 0 && <Row label="Leads team">{card.leadsTeams.map((t) => t.name).join(', ')}</Row>}
          {card.headsDepartments.length > 0 && <Row label="Heads department">{card.headsDepartments.map((d) => d.name).join(', ')}</Row>}
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
              <Row label="Timesheet required">{e.timesheetRequired ? 'Yes' : 'No'}</Row>
              {e.endDate && <Row label="Employment end date">{dateLabel(e.endDate)}</Row>}
              {e.leavingReason && <Row label="Reason for leaving">{LEAVING_REASON_LABEL[e.leavingReason]}</Row>}
            </>
          )}
        </>
      }
      edit={(draft, setField, can) => {
        const teams = [
          { value: '', label: 'No team' },
          ...(pickers?.teams ?? [])
            .filter((t) => !draft.departmentId || t.departmentId === draft.departmentId)
            .map((t) => ({ value: t.id, label: pickers!.departments.length > 1 && !draft.departmentId ? `${t.name} (${pickers!.departments.find((d) => d.id === t.departmentId)?.name ?? ''})` : t.name })),
        ];
        if (card.teamId && draft.teamId === card.teamId && !teams.some((t) => t.value === card.teamId)) teams.push({ value: card.teamId, label: card.teamName ?? 'Team' });
        return (
          <>
            <TextField field="firstName" draft={draft} setField={setField} can={can} maxLength={100} />
            <TextField field="lastName" draft={draft} setField={setField} can={can} maxLength={100} />
            <TextField field="jobTitle" draft={draft} setField={setField} can={can} maxLength={100} />
            <SelectField
              field="departmentId"
              draft={draft}
              setField={(k, v) => {
                setField(k, v);
                // A team of another department can't stay.
                const team = pickers?.teams.find((t) => t.id === draft.teamId);
                if (team && team.departmentId !== v) setField('teamId', '');
              }}
              can={can}
              options={departments}
            />
            <SelectField field="teamId" draft={draft} setField={setField} can={can} options={teams} />
            <TextField field="workEmail" type="email" draft={draft} setField={setField} can={can} maxLength={254} />
            <TextField field="workPhone" type="tel" draft={draft} setField={setField} can={can} maxLength={40} />
            <TextField field="workLocation" draft={draft} setField={setField} can={can} maxLength={100} placeholder="e.g. Belgrade HQ" />
            {e && (
              <>
                <TextField field="employeeNumber" draft={draft} setField={setField} can={can} maxLength={30} />
                <TextField field="employmentStartDate" type="date" draft={draft} setField={setField} can={can} />
                <SelectField field="employmentType" draft={draft} setField={setField} can={can} options={EMPLOYMENT_OPTIONS} />
                <TextField field="weeklyHours" type="number" draft={draft} setField={setField} can={can} />
                <CheckField field="timesheetRequired" draft={draft} setField={setField} can={can} />
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

  return (
    <EditableSection
      card={card}
      title="Reporting"
      testId="emp-reporting"
      fields={['managerId']}
      initial={() => ({ managerId: str(card.managerId) })}
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
      edit={(draft, setField, can) => <SelectField field="managerId" draft={draft} setField={setField} can={can} options={managers} />}
    />
  );
}

// ------------------------------------------------------------------ Personal details (spec 4.3)

const PERSONAL = ['dateOfBirth', 'privateEmail', 'privatePhone', 'addressStreet', 'addressPostalCode', 'addressCity', 'addressCountry', 'emergencyContactName', 'emergencyContactPhone'] as const;

export function PersonalSection({ card }: { card: ApiEmployeeCard }) {
  const p = card.personal!;
  const address = [p.addressStreet, [p.addressPostalCode, p.addressCity].filter(Boolean).join(' '), p.addressCountry].filter(Boolean).join(', ');
  return (
    <EditableSection
      card={card}
      title="Personal details"
      testId="emp-personal"
      fields={[...PERSONAL]}
      initial={() => Object.fromEntries(PERSONAL.map((f) => [f, str(p[f])]))}
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
  const toPatch = (changed: Draft): EmployeePatch | string => {
    const patch = defaultPatch(changed);
    for (const key of ['iban', 'fxIban'] as const) {
      const v = changed[key];
      if (typeof v === 'string' && v.trim() && !parseBankAccount(v)) return `${FIELD_LABEL[key]}: ${INVALID_ACCOUNT_MESSAGE}`;
    }
    if (typeof changed.swiftBic === 'string' && changed.swiftBic.trim() && !isSwiftBic(changed.swiftBic)) return 'SWIFT/BIC has 8 or 11 characters, e.g. AIKBRS22';
    return patch;
  };
  return (
    <EditableSection
      card={card}
      title="Bank account"
      testId="emp-bank"
      fields={['iban', 'bankName', 'fxSameAsIban', 'fxIban', 'swiftBic', 'fxBankName', 'fxBankAddress']}
      // The stored numbers are never sent back to the browser in full: the inputs start empty and
      // an empty input leaves the stored IBAN as it is ("Remove" clears it).
      initial={() => ({ iban: '', bankName: str(b.bankName), fxSameAsIban: b.fxSameAsIban, fxIban: '', swiftBic: str(b.swiftBic), fxBankName: str(b.fxBankName), fxBankAddress: str(b.fxBankAddress) })}
      toPatch={toPatch}
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

// ------------------------------------------------------------------ App access (spec 4.6, 4.7)

export function AppAccessSection({ card, onInvite, onLink }: { card: ApiEmployeeCard; onInvite: () => void; onLink: () => void }) {
  const { employeeCard } = useStore();
  const a = card.appAccess;
  const label = card.account === 'linked' ? 'Has account' : card.account === 'invited' ? 'Invited' : 'No account';
  const invitation = a?.invitation;
  const unlink = async () => {
    if (!window.confirm(`Unlink ${card.fullName}'s account? The record stays, with "No account"; the member gets a new record of their own.`)) return;
    await employeeCard.unlink(card.id);
  };
  return (
    <div className="card card-pad emp-section" data-testid="emp-access">
      <div className="emp-section-head">
        <span style={{ fontSize: 15, fontWeight: 600 }}>App access</span>
        <span className={card.account === 'linked' ? 'badge badge-brand' : card.account === 'invited' ? 'badge badge-warn' : 'badge badge-neutral'}>{label}</span>
      </div>
      <div className="emp-section-body">
        {a ? (
          <>
            <Row label="Sign-in email">
              <Val v={a.signInEmail} />
            </Row>
            <Row label="Workspace role">
              <Val v={a.workspaceRole ? a.workspaceRole[0]!.toUpperCase() + a.workspaceRole.slice(1) : null} />
            </Row>
            {invitation && (
              <Row label="Invitation">
                <span className="emp-iban">
                  <span>
                    {invitation.email} · {invitation.role === 'admin' ? 'Admin' : 'Member'} · until {dateLabel(invitation.expiresAt)}
                  </span>
                  <span className="emp-note">{invitation.emailStatus === 'sent' ? 'Email sent' : invitation.emailStatus === 'failed' ? 'Email not delivered' : invitation.emailStatus === 'queued' ? 'Sending email…' : 'Not emailed'}</span>
                  <span className="emp-links">
                    {invitation.hasLink && (
                      <>
                        <button type="button" className="emp-link" onClick={() => void employeeCard.resendInvitation(card.id, invitation.id)}>
                          Resend
                        </button>
                        <button type="button" className="emp-link" onClick={() => void employeeCard.copyInvitationLink(invitation.id)}>
                          Copy link
                        </button>
                      </>
                    )}
                    <button type="button" className="emp-link" onClick={() => void employeeCard.withdrawInvitation(card.id, invitation.id)}>
                      Withdraw
                    </button>
                  </span>
                </span>
              </Row>
            )}
            <div className="emp-links" style={{ marginTop: 6 }}>
              {card.permissions.canInvite && card.account === 'none' && (
                <button type="button" className="btn-outline" onClick={onInvite} title={card.workEmail ? undefined : 'Add a work email first'} disabled={!card.workEmail}>
                  Invite to Pultly
                </button>
              )}
              {card.permissions.canLink && (
                <button type="button" className="btn-outline" onClick={onLink}>
                  Link to member
                </button>
              )}
              {card.permissions.canUnlink && (
                <button type="button" className="btn-outline" onClick={() => void unlink()}>
                  Unlink
                </button>
              )}
            </div>
          </>
        ) : (
          <span className="emp-note">{card.account === 'linked' ? 'Signs in to Pultly.' : card.account === 'invited' ? 'Invited to Pultly, not joined yet.' : 'Has no app account.'}</span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Roles (spec 9.1; toggles: CD-142)

export function RolesSection({ card }: { card: ApiEmployeeCard }) {
  return (
    <div className="card card-pad emp-section" data-testid="emp-roles">
      <div className="emp-section-head">
        <span style={{ fontSize: 15, fontWeight: 600 }}>Roles</span>
      </div>
      <div className="emp-section-body">
        <span className="emp-badges">
          {card.roles.map((r) => (
            <span key={r} className={r === 'employee' ? 'badge badge-neutral' : 'badge badge-brand'} title={DERIVED_ROLE_HINT[r]}>
              {ROLE_LABEL[r]}
            </span>
          ))}
        </span>
        {/* Administration and Payroll toggles for Admins come here (CD-142). */}
        <div data-slot="role-toggles" />
        <span className="emp-note">Manager comes from reporting lines and Admin from the workspace role (owner or admin).</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ History (spec 4.5)

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

