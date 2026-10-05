import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen } from '../components/Layout';
import type { ApiEmployeeCard } from '../lib/api';
import { paths } from '../lib/paths';
import { ROLE_LABEL } from '../store/employeeCard';
import { initialsOf } from '../store/selectors';
import { useStore } from '../store/store';
import { useEmployeeCard } from '../store/useEmployeeCard';
import { DeactivateDialog, InviteDialog, LinkDialog, ReactivateDialog } from './employee/dialogs';
import { dateLabel } from './employee/parts';
import { AppAccessSection, BankSection, HistorySection, PersonalSection, ReportingSection, RolesSection, WorkSection } from './employee/sections';

/** The Org structure page (CD-137). */
const ORG = paths.org();

type Dialog = 'invite' | 'link' | 'deactivate' | 'reactivate' | null;

/**
 * The employee card (CD-140, spec 4.5): `/people/:id`. Header with status, account and roles and
 * the actions the caller may take; sections Work, Reporting, Personal details and Bank account
 * (only for people allowed to see them), App access, Roles and History. Each section edits in
 * place. `?deactivate=1` opens the Deactivate dialog (Settings → Team, "also left the company").
 * On phones the sections stack and the header's buttons move into its menu.
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
      <div className="emp-page" data-testid="employee-card">
        <CardHeader card={card} open={setDialog} />
        <div className="emp-grid">
          <div className="emp-col">
            <WorkSection card={card} />
            <ReportingSection card={card} />
            <RolesSection card={card} />
          </div>
          <div className="emp-col">
            {card.personal && <PersonalSection card={card} />}
            {card.bank && <BankSection card={card} />}
            <AppAccessSection card={card} onInvite={() => setDialog('invite')} onLink={() => setDialog('link')} />
            {card.permissions.canSeeHistory && <HistorySection card={card} />}
          </div>
        </div>
      </div>
      {dialog === 'invite' && <InviteDialog card={card} onClose={() => setDialog(null)} onLinkInstead={() => setDialog('link')} />}
      {dialog === 'link' && <LinkDialog card={card} onClose={() => setDialog(null)} />}
      {dialog === 'deactivate' && <DeactivateDialog card={card} onClose={() => setDialog(null)} />}
      {dialog === 'reactivate' && <ReactivateDialog card={card} onClose={() => setDialog(null)} />}
    </Screen>
  );
}

function statusBadge(card: ApiEmployeeCard): { label: string; className: string } {
  if (card.status === 'inactive') return { label: `Inactive since ${dateLabel(card.employment?.endDate) || 'leaving'}`, className: 'badge badge-neutral' };
  if (card.status === 'leaving') return { label: `Leaving on ${dateLabel(card.employment?.endDate)}`, className: 'badge badge-warn' };
  return { label: 'Active', className: 'badge badge-brand' };
}

const ACCOUNT_LABEL: Record<ApiEmployeeCard['account'], string> = { linked: 'Has account', invited: 'Invited', none: 'No account' };

/** Name, job, badges and the actions; on phones every action is in the "⋯" menu. */
function CardHeader({ card, open }: { card: ApiEmployeeCard; open: (d: Dialog) => void }) {
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
  const remove = async () => {
    if (!window.confirm(`Delete ${card.fullName}? This is for records made by mistake; it can't be undone.`)) return;
    if (await employeeCard.remove(card.id)) navigate(ORG);
  };
  const deleteInstead = () => {
    window.alert(`${card.fullName} has or had an app account, so the record can't be deleted. Deactivate instead.`);
    if (p.canDeactivate) open('deactivate');
  };

  // [label, action, shown in the wide header too]
  const actions: [string, () => void, boolean][] = [];
  if (p.canInvite && card.account === 'none') actions.push(['Invite to Pultly', () => (card.workEmail ? open('invite') : window.alert('Add a work email first: the invitation goes there.')), true]);
  if (p.canDeactivate && card.status !== 'leaving') actions.push(['Deactivate', () => open('deactivate'), true]);
  if (p.canReactivate) actions.push([card.status === 'inactive' ? 'Reactivate' : 'Cancel leaving', () => open('reactivate'), true]);
  if (p.canLink) actions.push(['Link to member', () => open('link'), false]);
  // Admins (who see App access) always find Delete; a record that had an account says "Deactivate instead".
  if (p.canDelete) actions.push(['Delete', () => void remove(), false]);
  else if (card.appAccess) actions.push(['Delete', deleteInstead, false]);

  return (
    <div className="card emp-header" data-testid="emp-header">
      <div className="emp-header-top">
        <span className="avatar emp-avatar">{initialsOf(card.fullName)}</span>
        <div className="emp-header-text">
          <h2 className="emp-name" data-testid="emp-name">
            {card.fullName}
          </h2>
          <span className="emp-note">{[card.jobTitle, card.departmentName, card.teamName].filter(Boolean).join(' · ') || 'No job title or department yet'}</span>
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
        {actions.length > 0 && (
          <div className="emp-header-actions">
            {actions
              .filter(([, , wide]) => wide)
              .map(([label, run]) => (
                <button key={label} type="button" className={label === 'Deactivate' ? 'btn btn-secondary emp-wide' : 'btn btn-primary emp-wide'} onClick={run}>
                  {label}
                </button>
              ))}
            <div ref={menuRef} style={{ position: 'relative' }} className={actions.some(([, , wide]) => !wide) ? undefined : 'emp-narrow'}>
              <button type="button" className="btn btn-secondary" aria-label="More actions" aria-expanded={menu} data-testid="emp-menu" onClick={() => setMenu((m) => !m)} style={{ padding: '10px 12px' }}>
                ⋯
              </button>
              {menu && (
                <div className="deal-menu emp-menu" role="menu">
                  {actions.map(([label, run, wide]) => (
                    <button
                      key={label}
                      type="button"
                      role="menuitem"
                      className={wide ? 'emp-narrow' : undefined}
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
          </div>
        )}
      </div>
    </div>
  );
}
