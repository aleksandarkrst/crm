import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen } from '../components/Layout';
import type { ApiEmployeeCard, EmployeeField } from '../lib/api';
import { paths } from '../lib/paths';
import { changedFields, type Draft, draftValues } from '../store/cardDraft';
import { ROLE_LABEL } from '../store/employeeCard';
import { initialsOf } from '../store/selectors';
import { useStore } from '../store/store';
import { useEmployeeCard } from '../store/useEmployeeCard';
import { DeactivateDialog, ReactivateDialog } from './employee/dialogs';
import { CardEditContext, dateLabel } from './employee/parts';
import { BankSection, cardInitial, cardPatch, PersonalSection, ReportingSection, WorkSection } from './employee/sections';

/** The Org structure page (CD-137). */
const ORG = paths.org();

type Dialog = 'deactivate' | 'reactivate' | null;

/**
 * The employee card (CD-140, spec 4.5; CD-225): `/people/:id`. Header with status, account and
 * roles, one Save and a "⋯" menu with the actions the caller may take; sections Work, Reporting,
 * Personal details and Bank account (only for people allowed to see them). Every field the caller
 * may change is an input; Save sends what changed (highlighted when there is something to save),
 * and leaving with unsaved changes asks "Discard your changes?". `?deactivate=1` opens the
 * Deactivate dialog (Settings → Team, "also left the company"). On phones the sections stack.
 *
 * Not shown since CD-225: App access (its actions are in the menu; the sign-in email and workspace
 * role are in Settings → Team), History (the API stays, sections.tsx) and Roles (Administration and
 * Payroll were removed).
 */
export function EmployeeCard() {
  const { id = '' } = useParams();
  const card = useEmployeeCard(id);
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<Dialog>(null);
  const wantsDeactivate = params.get('deactivate') === '1';
  useEffect(() => {
    if (!wantsDeactivate || !card || card === 'error' || !card.permissions.canDeactivate) return;
    setDialog('deactivate');
    setParams({}, { replace: true });
  }, [wantsDeactivate, card, setParams]);

  if (card === undefined)
    return (
      <Screen title="Employee" parent={{ label: 'Org structure', to: ORG }}>
        <span className="emp-note">Loading…</span>
      </Screen>
    );
  if (card === null || card === 'error')
    return (
      <Screen title="Employee" parent={{ label: 'Org structure', to: ORG }}>
        <div className="card card-pad emp-note">{card === null ? 'This employee does not exist, or you cannot see them.' : 'The employee could not be loaded. Try again in a moment.'}</div>
      </Screen>
    );

  return (
    <Screen title="Employee" parent={{ label: 'Org structure', to: ORG }}>
      <CardBody key={card.id} card={card} open={setDialog} />
      {dialog === 'deactivate' && <DeactivateDialog card={card} onClose={() => setDialog(null)} />}
      {dialog === 'reactivate' && <ReactivateDialog card={card} onClose={() => setDialog(null)} />}
    </Screen>
  );
}

const DISCARD = 'Discard your changes?';

/** The card's one draft and Save (CD-225), the header and the sections. */
function CardBody({ card, open }: { card: ApiEmployeeCard; open: (d: Dialog) => void }) {
  const { employeeCard, flash } = useStore();
  const initial = useMemo(() => cardInitial(card), [card]);
  const editable = useMemo(() => new Set<string>(card.permissions.editableFields), [card.permissions.editableFields]);
  const [edits, setEdits] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; conflict: boolean } | null>(null);
  const changed = changedFields(initial, edits, editable);
  const dirty = Object.keys(changed).length > 0;

  const setField = useCallback((key: string, value: string | boolean) => setEdits((e) => ({ ...e, [key]: value })), []);
  const can = useCallback((f: EmployeeField) => editable.has(f), [editable]);
  const edit = useMemo(() => ({ values: draftValues(initial, edits), setField, can }), [initial, edits, setField, can]);

  const save = async () => {
    const patch = cardPatch(changed);
    if (typeof patch === 'string') return setProblem({ text: patch, conflict: false });
    setBusy(true);
    setProblem(null);
    const result = await employeeCard.save(card.id, patch);
    setBusy(false);
    if ('cancelled' in result) return;
    if ('error' in result) return setProblem({ text: result.error, conflict: !!result.conflict });
    setEdits({});
    flash('Saved');
  };
  /** After a conflict: the card as it is now, without what was typed. */
  const reload = () => {
    setEdits({});
    setProblem(null);
    void employeeCard.load(card.id).catch(() => undefined);
  };

  // Leaving with unsaved changes asks first: another page of the app, or closing / reloading the tab.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(DISCARD)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <CardEditContext.Provider value={edit}>
      <div className="emp-page" data-testid="employee-card">
        <CardHeader card={card} open={open} canSave={editable.size > 0} dirty={dirty} busy={busy} onSave={() => void save()} />
        {problem && (
          <div className="card card-pad emp-error emp-save-problem" role="alert" data-testid="emp-save-problem">
            <span>{problem.text}</span>
            {problem.conflict && (
              <button type="button" className="btn btn-secondary" onClick={reload}>
                Reload
              </button>
            )}
          </div>
        )}
        <div className="emp-grid">
          <div className="emp-col">
            <WorkSection card={card} />
            <ReportingSection card={card} />
          </div>
          <div className="emp-col">
            {card.personal && <PersonalSection card={card} />}
            {card.bank && <BankSection card={card} />}
          </div>
        </div>
      </div>
    </CardEditContext.Provider>
  );
}

function statusBadge(card: ApiEmployeeCard): { label: string; className: string } {
  if (card.status === 'inactive') return { label: `Inactive since ${dateLabel(card.employment?.endDate) || 'leaving'}`, className: 'badge badge-neutral' };
  if (card.status === 'leaving') return { label: `Leaving on ${dateLabel(card.employment?.endDate)}`, className: 'badge badge-warn' };
  return { label: 'Active', className: 'badge badge-brand' };
}

const ACCOUNT_LABEL: Record<ApiEmployeeCard['account'], string> = { linked: 'Has account', invited: 'Invited', none: 'No account' };

/**
 * Name, job, badges, Save and the "⋯" menu (CD-225): the pending invitation (Resend, Copy link,
 * Withdraw), Deactivate, Reactivate or Cancel leaving, and Delete once deactivated. CD-226 took out
 * Invite to Pultly, Link to member and Unlink: people join by invitation from Settings → Team, and
 * Deactivate is how someone leaves.
 */
function CardHeader({ card, open, canSave, dirty, busy, onSave }: { card: ApiEmployeeCard; open: (d: Dialog) => void; canSave: boolean; dirty: boolean; busy: boolean; onSave: () => void }) {
  const { employeeCard } = useStore();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);
  const p = card.permissions;
  const status = statusBadge(card);
  const invitation = card.appAccess?.invitation ?? null;
  const remove = async () => {
    if (!window.confirm(`Delete ${card.fullName}? Their record goes for good; history shows them as a deleted employee.`)) return;
    if (await employeeCard.remove(card.id)) navigate(ORG);
  };
  // Withdrawing takes the person off the Org structure (CD-226), so the card closes.
  const withdraw = async (invitationId: string) => {
    if (!window.confirm(`Withdraw the invitation to ${card.fullName}? They are taken off the org structure.`)) return;
    if (await employeeCard.withdrawInvitation(card.id, invitationId)) navigate(ORG);
  };

  const actions: [string, () => void][] = [];
  if (invitation?.hasLink) {
    actions.push(['Resend invitation', () => void employeeCard.resendInvitation(card.id, invitation.id)]);
    actions.push(['Copy invite link', () => void employeeCard.copyInvitationLink(invitation.id)]);
  }
  if (invitation) actions.push(['Withdraw invitation', () => void withdraw(invitation.id)]);
  if (p.canDeactivate && card.status !== 'leaving') actions.push(['Deactivate', () => open('deactivate')]);
  if (p.canReactivate) actions.push([card.status === 'inactive' ? 'Reactivate' : 'Cancel leaving', () => open('reactivate')]);
  // Only once deactivated (CD-225), then for anyone, former app users included.
  if (p.canDelete) actions.push(['Delete', () => void remove()]);

  return (
    <div className="card emp-header" data-testid="emp-header">
      <div className="emp-header-top">
        <span className="avatar emp-avatar">{initialsOf(card.fullName)}</span>
        <div className="emp-header-text">
          <h2 className="emp-name" data-testid="emp-name">
            {card.fullName}
          </h2>
          <span className="emp-note">{[card.jobTitle, card.unitName].filter(Boolean).join(' · ') || 'No job title or unit yet'}</span>
          <span className="emp-badges">
            <span className={status.className} data-testid="emp-status">
              {status.label}
            </span>
            <span className={card.account === 'linked' ? 'badge badge-brand' : 'badge badge-neutral'} data-testid="emp-account">
              {ACCOUNT_LABEL[card.account]}
            </span>
            {card.roles
              .filter((r) => r !== 'employee')
              .map((r) => (
                <span key={r} className="badge badge-neutral">
                  {ROLE_LABEL[r]}
                </span>
              ))}
          </span>
        </div>
        {(canSave || actions.length > 0) && (
          <div className="emp-header-actions">
            {canSave && (
              <button type="button" className={dirty && !busy ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!dirty || busy} data-testid="emp-save" data-dirty={dirty || undefined} onClick={onSave}>
                {busy ? 'Saving' : 'Save'}
              </button>
            )}
            {actions.length > 0 && (
              <div ref={menuRef} style={{ position: 'relative' }}>
                <button type="button" className="btn btn-secondary" aria-label="More actions" aria-expanded={menu} data-testid="emp-menu" onClick={() => setMenu((m) => !m)} style={{ padding: '10px 12px' }}>
                  ⋯
                </button>
                {menu && (
                  <div className="deal-menu emp-menu" role="menu">
                    {actions.map(([label, run]) => (
                      <button
                        key={label}
                        type="button"
                        role="menuitem"
                        className={label === 'Delete' ? 'emp-menu-danger' : undefined}
                        onClick={() => {
                          setMenu(false);
                          run();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
