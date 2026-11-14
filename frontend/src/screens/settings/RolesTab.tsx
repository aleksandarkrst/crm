import { Icon } from '../../components/icons';
import { TEAM_ROLES } from '../../store/seed';
import { Block, Note, Table } from './parts';

/** What each workspace role may do. Enforced by the API with the workspace role. */
const ROLE_RULES: { label: string; roles: (typeof TEAM_ROLES)[number][] }[] = [
  { label: 'View and edit opportunities, companies, contacts and products', roles: ['Owner', 'Admin', 'Member'] },
  { label: 'Delete opportunities, companies, contacts and products', roles: ['Owner', 'Admin'] },
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
  // No artboard of its own: it takes the design's table (G-Settings, CD-524) with a mark per role.
  return (
    <>
      <Block title="Workspace roles" desc="Owner, admin and member control the account: inviting, workspace settings, deleting CRM records, funnels, custom fields and bonuses." testId="workspace-roles">
        <Table cols={[{ label: 'Permission' }, ...TEAM_ROLES.map((r) => ({ label: r, align: 'center' as const }))]} minWidth={560}>
          {ROLE_RULES.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              {TEAM_ROLES.map((r) => {
                const on = p.roles.includes(r);
                return (
                  <td key={r} className="center">
                    <span className={'ws-mark' + (on ? ' on' : '')} role="img" aria-label={on ? `${r}: yes` : `${r}: no`}>
                      <Icon name="check" size={12} />
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </Table>
      </Block>
      <Note>Every workspace keeps at least one owner. Anyone can leave a workspace from the Team page.</Note>
    </>
  );
}
