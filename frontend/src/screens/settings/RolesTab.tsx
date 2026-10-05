import { useState } from 'react';
import { Avatar, Picker, PickerRow, RemoveButton, usePicker } from '../../components/ui';
import type { ApiPermissionMatrix, ApiRoleHolder, AssignedRole, PermissionScope } from '../../lib/api';
import { initialsOf } from '../../store/selectors';
import { TEAM_ROLES } from '../../store/seed';
import { ASSIGNED_ROLE_LABELS, useDirectory, usePermissionMatrix, useRoleHolders, useSetEmployeeRole } from '../../store/roles';
import { useStore } from '../../store/store';

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
 * Settings → Roles & permissions (CD-142, spec 9.6): the workspace roles (owner, admin, member),
 * the functional roles' matrix as the server defines and enforces it (grouped by module; modules
 * that aren't live yet say so), and who has which role, where Admins add and remove
 * Administration and Payroll.
 */
export function RolesTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <WorkspaceRoles />
      <FunctionalRoles />
      <RoleHolders />
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

const FN_COLS = 'minmax(220px, 1.8fr) repeat(5, minmax(96px, 1fr))';
const SCOPE_CLASS: Record<PermissionScope, string> = { none: 'perm-cell none', own: 'perm-cell own', direct: 'perm-cell some', indirect: 'perm-cell some', all: 'perm-cell all' };

/** The matrix of spec 9.3, from GET /people/permissions: the same definition the API checks. */
function FunctionalRoles() {
  const { matrix, error } = usePermissionMatrix();
  return (
    <div className="card" data-testid="functional-roles">
      <div className="card-pad" style={{ paddingBottom: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="card-title">Functional roles</div>
        <span className="card-sub">
          What people may see and do with employee data, by what they do in the company. Roles add up: a person has the rights of all their roles. Own = their own data, Direct = their direct reports, Indirect = all their reports at
          any depth, All = every employee.
        </span>
      </div>
      {error && <div className="empty-state">{error}</div>}
      {!matrix && !error && <div className="empty-state">Loading…</div>}
      {matrix && (
        <>
          <RoleDescriptions matrix={matrix} />
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 760 }}>
              <div className="table-head th" style={{ gridTemplateColumns: FN_COLS }}>
                <span>Action</span>
                {matrix.roles.map((r) => (
                  <span key={r.id} style={{ justifySelf: 'center' }}>
                    {r.label}
                  </span>
                ))}
              </div>
              {matrix.modules.map((m) => (
                <div key={m.id} data-testid="perm-module" data-module={m.id} data-live={m.live}>
                  <div className="perm-module-head" style={{ gridTemplateColumns: FN_COLS }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                      {!m.live && (
                        <span className="caps-muted" data-testid="perm-coming">
                          Coming with {m.name}
                        </span>
                      )}
                    </span>
                  </div>
                  {m.rows.map((row) => (
                    <div key={row.id} className={m.live ? 'table-row perm-row' : 'table-row perm-row soon'} style={{ gridTemplateColumns: FN_COLS }} data-testid="perm-row" data-row={row.id}>
                      <span>{row.action}</span>
                      {matrix.roles.map((r) => {
                        const c = row.cells[r.id];
                        return (
                          <span key={r.id} className={SCOPE_CLASS[c.scope]} data-role={r.id}>
                            {c.label}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RoleDescriptions({ matrix }: { matrix: ApiPermissionMatrix }) {
  return (
    <div className="role-descriptions">
      {matrix.roles.map((r) => (
        <div key={r.id} className="role-description">
          <span style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {r.who} {r.given}
          </span>
        </div>
      ))}
    </div>
  );
}

/** "Who has which role": Administration and Payroll (Admins add and remove), Admins and Managers (derived). */
function RoleHolders() {
  const { session } = useStore();
  const isAdmin = session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const { holders, error } = useRoleHolders();
  return (
    <div className="card card-pad" data-testid="role-holders" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="card-title">Who has which role</div>
      <span className="card-sub">
        {isAdmin
          ? 'Give Administration and Payroll to anyone, with or without an account; it applies from their next click. Admin comes from the workspace role (Team tab), Manager from reporting lines.'
          : 'Admins give Administration and Payroll. Admin comes from the workspace role, Manager from reporting lines.'}
      </span>
      {error && <span style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</span>}
      {!holders ? (
        <span style={{ fontSize: 13, color: 'var(--muted)', padding: '10px 0' }}>Loading…</span>
      ) : (
        <div className="role-holder-grid">
          <AssignedList role="administration" people={holders.administration} editable={isAdmin} />
          <AssignedList role="payroll" people={holders.payroll} editable={isAdmin} />
          <HolderList
            title="Admin"
            testId="holders-admin"
            note="Workspace owners and admins"
            people={holders.admins.map((a) => ({ ...a, trailing: a.workspaceRole === 'owner' ? 'Owner' : 'Admin' }))}
            empty="Nobody"
          />
          <HolderList
            title="Manager"
            testId="holders-manager"
            note="Everyone with an active direct report"
            people={holders.managers.map((m) => ({ ...m, trailing: m.reports === 1 ? '1 report' : `${m.reports} reports` }))}
            empty="Nobody has direct reports yet"
          />
        </div>
      )}
    </div>
  );
}

function HolderRow({ person, trailing, onRemove }: { person: ApiRoleHolder; trailing?: string; onRemove?: () => void }) {
  return (
    <div className="role-holder" data-testid="role-holder">
      <Avatar initials={initialsOf(person.name)} style={{ flex: '0 0 auto' }} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.name}</span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{[person.jobTitle, person.hasAccount ? null : 'No account'].filter(Boolean).join(' · ') || ' '}</span>
      </span>
      {trailing && <span style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{trailing}</span>}
      {onRemove && <RemoveButton title={`Remove ${person.name}`} onClick={onRemove} />}
    </div>
  );
}

function HolderList({ title, note, people, empty, testId }: { title: string; note: string; people: (ApiRoleHolder & { trailing?: string })[]; empty: string; testId: string }) {
  return (
    <div className="role-holder-list" data-testid={testId}>
      <div className="role-holder-head">
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{note}</span>
      </div>
      {people.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--muted)', padding: '6px 0' }}>{empty}</span>}
      {people.map((p) => (
        <HolderRow key={(p.employeeId ?? '') + (p.userId ?? '')} person={p} trailing={p.trailing} />
      ))}
    </div>
  );
}

function AssignedList({ role, people, editable }: { role: AssignedRole; people: (ApiRoleHolder & { employeeId: string })[]; editable: boolean }) {
  const setRole = useSetEmployeeRole();
  const label = ASSIGNED_ROLE_LABELS[role];
  const [adding, setAdding] = useState(false);
  return (
    <div className="role-holder-list" data-testid={`holders-${role}`}>
      <div className="role-holder-head">
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{role === 'administration' ? 'HR and office administration' : 'Payroll and accounting'}</span>
      </div>
      {people.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--muted)', padding: '6px 0' }}>Nobody yet</span>}
      {people.map((p) => (
        <HolderRow
          key={p.employeeId}
          person={p}
          onRemove={
            editable
              ? () => {
                  if (window.confirm(`Remove the ${label} role from ${p.name}? They get an email.`)) void setRole(p.employeeId, role, false, p.name);
                }
              : undefined
          }
        />
      ))}
      {editable &&
        (adding ? (
          <AddPerson
            role={role}
            taken={new Set(people.map((p) => p.employeeId))}
            onDone={() => setAdding(false)}
            onPick={(id, name) => {
              setAdding(false);
              void setRole(id, role, true, name);
            }}
          />
        ) : (
          <button type="button" className="btn-outline" style={{ alignSelf: 'flex-start', marginTop: 6 }} data-testid={`add-${role}`} onClick={() => setAdding(true)}>
            Add person
          </button>
        ))}
    </div>
  );
}

/** An employee picker (active employees without the role), searchable by name and job title. */
function AddPerson({ role, taken, onPick, onDone }: { role: AssignedRole; taken: ReadonlySet<string>; onPick: (employeeId: string, name: string) => void; onDone: () => void }) {
  const picker = usePicker();
  const directory = useDirectory(true);
  const q = picker.search.trim().toLowerCase();
  const options = (directory ?? []).filter((e) => !taken.has(e.id) && (!q || e.fullName.toLowerCase().includes(q) || (e.jobTitle ?? '').toLowerCase().includes(q))).slice(0, 50);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }} data-testid={`add-${role}-picker`}>
      <Picker
        picker={picker}
        placeholder={`Add someone to ${ASSIGNED_ROLE_LABELS[role]}…`}
        items={
          directory === null ? (
            <div className="picker-item" style={{ color: 'var(--muted)' }}>
              Loading…
            </div>
          ) : options.length === 0 ? (
            <div className="picker-item" style={{ color: 'var(--muted)' }}>
              No one to add
            </div>
          ) : (
            options.map((e) => <PickerRow key={e.id} initials={initialsOf(e.fullName)} title={e.fullName} subtitle={[e.jobTitle, e.departmentName, e.userId ? null : 'No account'].filter(Boolean).join(' · ')} onPick={() => onPick(e.id, e.fullName)} />)
          )
        }
      />
      <button type="button" className="btn-outline" onClick={onDone}>
        Cancel
      </button>
    </div>
  );
}
