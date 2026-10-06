import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, Picker, PickerRow, RemoveButton, usePicker } from '../../components/ui';
import { paths } from '../../lib/paths';
import { hasEmail } from '../../store/meetings';
import { allPeople, companyIdOfPerson, initialsOf, memberLabels } from '../../store/selectors';
import { useStore } from '../../store/store';

/** One guest of a meeting as the list shows it. */
export interface GuestRow {
  key: string;
  kind: 'internal' | 'external';
  name: string;
  /** Under the name: "Organizer", the email, "No email". */
  sub?: string;
  /** A contact's page. */
  to?: string;
  muted?: boolean;
  onRemove?: () => void;
}

/** The meeting company's contacts, one per contact (the people list repeats people with several roles). */
export function useCompanyContacts(companyId: string) {
  const { s } = useStore();
  return useMemo(() => {
    const seen = new Set<string>();
    return allPeople(s)
      .filter((p) => p.contactId && !seen.has(p.contactId) && !!seen.add(p.contactId))
      .filter((p) => !!companyId && companyIdOfPerson(s, p) === companyId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [s, companyId]);
}

/**
 * "Add guests" (CD-221, as in Google Calendar): one search over the workspace's members (internal
 * participants) and the meeting company's contacts (external ones), with "+ Add new contact" at
 * the company, and "Invite a colleague" (Settings → Team) while nobody else is in the workspace.
 * Below it, the guests. Used by the quick-create popover, the New meeting page, the deal's Meeting
 * tab and the meeting page.
 */
export function GuestsField({
  rows,
  companyId,
  companyName,
  users,
  contacts,
  onAddUser,
  onAddContact,
  editable = true,
  busy,
  testId = 'meeting-guests',
}: {
  rows: GuestRow[];
  companyId: string;
  companyName: string;
  /** Members already on the meeting (the organizer too). */
  users: string[];
  /** Contacts already on the meeting. */
  contacts: string[];
  onAddUser: (userId: string) => void;
  onAddContact: (contactId: string) => void;
  editable?: boolean;
  busy?: boolean;
  testId?: string;
}) {
  const { s, session, createContact } = useStore();
  const navigate = useNavigate();
  const picker = usePicker();
  const members = useMemo(() => [...memberLabels(s)].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [s]);
  const people = useCompanyContacts(companyId);
  const [newContact, setNewContact] = useState<{ name: string; email: string; role: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const admin = session.tenant.role === 'owner' || session.tenant.role === 'admin';

  const q = picker.search.trim().toLowerCase();
  const match = (...texts: (string | null | undefined)[]) => !q || texts.some((t) => (t || '').toLowerCase().includes(q));
  const colleagues = members.filter((m) => !users.includes(m.id) && match(m.name));
  const customers = people.filter((p) => !contacts.includes(p.contactId!) && match(p.name, p.email)).slice(0, 60);
  const alone = members.length <= 1;

  const addContact = async () => {
    if (!newContact?.name.trim() || !companyId) return;
    setAdding(true);
    const id = await createContact({ name: newContact.name.trim(), email: newContact.email.trim(), role: newContact.role.trim(), phone: '', linkedin: '', buyerRole: 'Influencer', notes: '' }, undefined, undefined, companyId);
    setAdding(false);
    if (!id) return; // the store said why
    setNewContact(null);
    onAddContact(id);
  };
  const heading = (text: string) => <div className="guest-group">{text}</div>;

  return (
    <div className="guests" data-testid={testId}>
      {editable && (
        <div className="meeting-picker guests-picker" data-testid={testId + '-add'}>
          <Picker
            picker={picker}
            placeholder="Add guests"
            items={
              <>
                {colleagues.length > 0 && heading('Colleagues')}
                {colleagues.map((m) => (
                  <PickerRow
                    key={m.id}
                    initials={initialsOf(m.name)}
                    title={m.name}
                    subtitle="Colleague"
                    onPick={() => {
                      picker.close();
                      onAddUser(m.id);
                    }}
                  />
                ))}
                {alone && (
                  <div className="guest-invite" data-testid="guests-invite">
                    {admin ? (
                      <button type="button" className="meeting-picker-add" data-testid="guests-invite-colleague" onClick={() => navigate(paths.settings('team') + '?invite=1')}>
                        Invite a colleague
                      </button>
                    ) : (
                      <span className="meeting-muted">Nobody else is in the workspace yet. An owner or admin can invite colleagues.</span>
                    )}
                  </div>
                )}
                {companyId ? (
                  <>
                    {customers.length > 0 && heading(companyName)}
                    {customers.map((p) => (
                      <PickerRow
                        key={p.contactId}
                        initials={p.initials || initialsOf(p.name)}
                        title={p.name}
                        subtitle={[p.role, hasEmail(p.email) ? p.email : null].filter((x) => x && x !== '—').join(' · ') || companyName}
                        trailing={!hasEmail(p.email) ? <span className="badge badge-neutral">No email</span> : undefined}
                        onPick={() => {
                          picker.close();
                          onAddContact(p.contactId!);
                        }}
                      />
                    ))}
                    {customers.length === 0 && <div className="guest-empty">{q ? `No contact of ${companyName} matches.` : `No more contacts at ${companyName}.`}</div>}
                  </>
                ) : (
                  <div className="guest-empty" data-testid="guests-pick-company">
                    Pick the company to add its contacts.
                  </div>
                )}
              </>
            }
            footer={
              companyId ? (
                <button
                  type="button"
                  className="meeting-picker-add"
                  data-testid="meeting-new-contact"
                  onClick={() => {
                    setNewContact({ name: picker.search.trim(), email: '', role: '' });
                    picker.close();
                  }}
                >
                  + Add new contact at {companyName}
                </button>
              ) : undefined
            }
          />
        </div>
      )}
      {newContact && (
        <div className="meeting-new-contact" data-testid="meeting-new-contact-form">
          <div className="meeting-form-grid">
            <label className="form-label">
              Full name
              <input className="form-input" data-testid="new-contact-name" autoFocus value={newContact.name} maxLength={200} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
            </label>
            <label className="form-label">
              Email
              <input className="form-input" type="email" data-testid="new-contact-email" value={newContact.email} placeholder="Optional" onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
            </label>
            <label className="form-label">
              Job title
              <input className="form-input" data-testid="new-contact-role" value={newContact.role} maxLength={120} placeholder="Optional" onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} />
            </label>
          </div>
          <div className="meeting-new-contact-actions">
            <span className="meeting-muted">Saved as a contact of {companyName}.</span>
            <button type="button" className="btn btn-secondary" onClick={() => setNewContact(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" data-testid="new-contact-save" disabled={!newContact.name.trim() || adding} onClick={() => void addContact()}>
              {adding ? 'Adding' : 'Add contact'}
            </button>
          </div>
        </div>
      )}
      <div className="guest-list" data-testid={testId + '-list'}>
        {rows.map((g) => {
          const body = (
            <>
              <Avatar initials={initialsOf(g.name)} size={26} font={10} />
              <span className="guest-text">
                <span className="guest-name" style={g.muted ? { color: 'var(--muted)' } : undefined}>
                  {g.name}
                </span>
                {g.sub && <span className="guest-sub">{g.sub}</span>}
              </span>
            </>
          );
          return (
            <div key={g.key} className="guest-row" data-testid="meeting-person" data-kind={g.kind}>
              {g.to ? (
                <Link to={g.to} className="meeting-person-row">
                  {body}
                </Link>
              ) : (
                <div className="meeting-person-row">{body}</div>
              )}
              {g.onRemove && editable && <RemoveButton box={24} size={13} title={`Remove ${g.name}`} onClick={() => !busy && g.onRemove?.()} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
