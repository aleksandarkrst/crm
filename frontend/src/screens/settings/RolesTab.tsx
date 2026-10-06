import { TEAM_ROLES } from '../../store/seed';

/** What each workspace role may do. Enforced by the API with the workspace role. */
const ROLE_RULES: { label: string; roles: (typeof TEAM_ROLES)[number][] }[] = [
  { label: 'View and edit deals, companies, contacts and products', roles: ['Owner', 'Admin', 'Member'] },
  { label: 'Delete deals, companies, contacts and products', roles: ['Owner', 'Admin'] },
  { label: 'Edit funnels and stages', roles: ['Owner', 'Admin'] },
  { label: 'Define custom fields (everyone fills them in)', roles: ['Owner', 'Admin'] },
  { label: 'See and set sales bonus rules and bonus figures', roles: ['Owner', 'Admin'] },
  { label: 'Invite members and change their roles', roles: ['Owner', 'Admin'] },
  { label: 'Make someone an owner or remove an owner', roles: ['Owner'] },
];

/**
 * Settings → Roles & permissions (CD-142, spec 9.6): the workspace roles (owner, admin, member).
 * Owners and admins do all HR work; Managers come from reporting lines. The functional roles'
 * matrix and "Who has which role" went with the Administration and Payroll roles (CD-225).
 */
export function RolesTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <WorkspaceRoles />
    </div>
  );
}

function WorkspaceRoles() {
  const cols = '1.8fr repeat(3, 90px)';
  return (
    <div className="card" style={{ overflowX: 'auto' }} data-testid="workspace-roles">
      <div style={{ minWidth: 560 }}>
        <div className="card-pad" style={{ paddingBottom: 6 }}>
          <div className="card-title">Workspace roles</div>
          <span className="card-sub">Owner, admin and member control the account: inviting, workspace settings, deleting CRM records, funnels, custom fields and bonuses.</span>
        </div>
        <div className="table-head th" style={{ gridTemplateColumns: cols }}>
          <span>Permission</span>
          {TEAM_ROLES.map((r) => (
            <span key={r} style={{ justifySelf: 'center' }}>
              {r}
            </span>
          ))}
        </div>
        {ROLE_RULES.map((p) => (
          <div key={p.label} className="table-row" style={{ gridTemplateColumns: cols, padding: '11px 16px' }}>
            <span>{p.label}</span>
            {TEAM_ROLES.map((r) => {
              const on = p.roles.includes(r);
              return (
                <span
                  key={r}
                  style={{ justifySelf: 'center', width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${on ? '#14503C' : '#CAD3CE'}`, background: on ? '#14503C' : '#FFFFFF', color: '#F5F7F6', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {on ? '✓' : ''}
                </span>
              );
            })}
          </div>
        ))}
        <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-2)' }}>Every workspace keeps at least one owner. Anyone can leave a workspace from the Team tab.</div>
      </div>
    </div>
  );
}
