import { FieldRow, GhostInput, GhostSelect, PersonChip, Picker, PickerRow, usePicker } from '../../components/ui';
import { INDUSTRIES, SOURCES, TEAM_SIZES } from '../../store/seed';
import { allPeople, closeIsoOf, companyRecords, contactsForLead, initialsOf, leadById, linesOf, money, netOf, vatOf } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead, SegKey } from '../../store/types';

export function Summary({ lead }: { lead: Lead }) {
  const store = useStore();
  const { s } = store;
  const companyPicker = usePicker();
  const contactPicker = usePicker();

  const lines = linesOf(s, lead);
  const net = netOf(lines);
  const vat = vatOf(lines);
  const contacts = contactsForLead(s, lead.id);
  const assigned = new Set(contacts.map((p) => p.id));

  const cq = companyPicker.search.toLowerCase().trim();
  const companyOptions = companyRecords(s)
    .filter((c) => c.name !== lead.company)
    .filter((c) => !cq || c.name.toLowerCase().includes(cq));

  const pq = contactPicker.search.toLowerCase().trim();
  const directory = allPeople(s)
    .filter((p) => !assigned.has(p.id))
    .filter((p) => !pq || String(p.name || '').toLowerCase().includes(pq) || String(leadById(s, p.leadId)?.company || '').toLowerCase().includes(pq));

  const patch = (key: keyof Lead) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => store.patchLead(lead.id, { [key]: e.target.value });

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Summary</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
        <FieldRow label="Company">
          <Picker
            picker={companyPicker}
            items={companyOptions.map((c) => (
              <PickerRow
                key={c.name}
                square
                initials={initialsOf(c.name)}
                title={c.name}
                onPick={() => {
                  store.patchLead(lead.id, { company: c.name });
                  companyPicker.close();
                }}
              />
            ))}
          >
            <span style={{ whiteSpace: 'nowrap' }}>{lead.company}</span>
          </Picker>
        </FieldRow>

        <FieldRow label="Contacts">
          <Picker
            picker={contactPicker}
            placeholder={contacts.length ? 'Search contacts…' : 'Search or assign a contact…'}
            items={directory.map((p) => (
              <PickerRow
                key={p.id}
                initials={p.initials || initialsOf(p.name)}
                title={p.name}
                subtitle={leadById(s, p.leadId)?.company || ''}
                onPick={() => {
                  store.linkPerson(lead.id, p.id);
                  contactPicker.setSearch('');
                }}
              />
            ))}
          >
            {contacts.map((p, i) => (
              <PersonChip
                key={p.id}
                initials={p.initials || initialsOf(p.name)}
                label={i < contacts.length - 1 ? p.name + ',' : p.name}
                onDrop={(e) => {
                  e.stopPropagation();
                  store.unlinkPerson(lead.id, p.id);
                }}
              />
            ))}
          </Picker>
        </FieldRow>

        <FieldRow label="Deal value">
          <span style={{ fontSize: 13.5, padding: '6px 9px', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            {money(net)}
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              net · {money(net + vat)} incl. VAT {money(vat)}
            </span>
          </span>
        </FieldRow>
        <FieldRow label="Closing date">
          <GhostInput type="date" value={closeIsoOf(lead)} onChange={patch('closeDate')} />
        </FieldRow>
        <FieldRow label="Industry">
          <GhostSelect chevron value={lead.industry} onChange={patch('industry')} options={INDUSTRIES} />
        </FieldRow>
        <FieldRow label="HQ">
          <GhostInput value={lead.hq} onChange={patch('hq')} />
        </FieldRow>
        <FieldRow label="Team size">
          <GhostSelect chevron value={lead.size} onChange={patch('size')} options={TEAM_SIZES} />
        </FieldRow>
        <FieldRow label="Funnel">
          <GhostSelect
            chevron
            value={lead.segment}
            onChange={(e) => store.patchLeadSegment(lead.id, e.target.value as SegKey)}
            options={[
              { value: 'smb', label: s.funnels.smb.label },
              { value: 'ent', label: s.funnels.ent.label },
            ]}
          />
        </FieldRow>
        <FieldRow label="Source">
          <GhostSelect chevron value={lead.source} onChange={patch('source')} options={SOURCES} />
        </FieldRow>
      </div>
    </div>
  );
}
