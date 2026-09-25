import { CustomFieldRows } from '../../components/CustomFields';
import { IconRow } from '../../components/icons';
import { GhostInput, GhostSelect, PersonChip, Picker, PickerRow, usePicker } from '../../components/ui';
import { SOURCES } from '../../store/seed';
import { allPeople, closeIsoOf, companyOfPerson, contactsForLead, curOf, funnelOptions, initialsOf, linesOf, moneyExact, totalsOf, valueNum } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

/** The deal's key facts (CD-83): icons instead of labels, the deal value first. */
export function Summary({ lead }: { lead: Lead }) {
  const store = useStore();
  const { s } = store;
  const contactPicker = usePicker();

  const lines = linesOf(s, lead);
  const totals = totalsOf(s, lead);
  const cur = curOf(s, lead);
  const value = lines.length ? totals.subtotal : valueNum(lead.value);
  const contacts = contactsForLead(s, lead.id);
  const assigned = new Set(contacts.map((p) => p.id));

  const pq = contactPicker.search.toLowerCase().trim();
  const directory = allPeople(s)
    .filter((p) => !assigned.has(p.id))
    .filter((p) => !pq || String(p.name || '').toLowerCase().includes(pq) || companyOfPerson(s, p).toLowerCase().includes(pq));

  const patch = (key: keyof Lead) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => store.patchLead(lead.id, { [key]: e.target.value });

  return (
    <div className="card card-pad">
      <span style={{ fontSize: 15, fontWeight: 600 }}>Summary</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
        <IconRow icon="value" label="Deal value">
          <span style={{ padding: '6px 9px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span data-testid="deal-value" style={{ fontSize: 16, fontWeight: 600 }}>
                {moneyExact(value, cur)}
              </span>
              <button type="button" className="btn-link" data-testid="open-products" onClick={() => store.openDealProducts(lead.id)} style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', color: 'var(--brand)', fontSize: 12.5 }}>
                {lines.length ? `${lines.length} ${lines.length === 1 ? 'product' : 'products'}` : '+ Products'}
              </button>
            </span>
            {lines.length > 0 && (
              <span data-testid="deal-recurring" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                ACV {moneyExact(totals.acv, cur)} · ARR {moneyExact(totals.arr, cur)} · MRR {moneyExact(totals.mrr, cur)}
              </span>
            )}
          </span>
        </IconRow>

        <IconRow icon="contacts" label="Contacts">
          <Picker
            picker={contactPicker}
            placeholder={contacts.length ? 'Search contacts…' : 'Search or assign a contact…'}
            items={directory.map((p) => (
              <PickerRow
                key={p.id}
                initials={p.initials || initialsOf(p.name)}
                title={p.name}
                subtitle={companyOfPerson(s, p)}
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
        </IconRow>
        <IconRow icon="calendar" label="Closing date">
          <GhostInput type="date" aria-label="Closing date" value={closeIsoOf(lead)} onChange={patch('closeDate')} />
        </IconRow>
        <IconRow icon="funnel" label="Funnel">
          <GhostSelect chevron aria-label="Funnel" value={lead.segment} onChange={(e) => store.patchLeadSegment(lead.id, e.target.value)} options={funnelOptions(s)} />
        </IconRow>
        <IconRow icon="source" label="Source">
          <GhostSelect chevron aria-label="Source" value={lead.source} onChange={patch('source')} options={SOURCES} />
        </IconRow>
        <CustomFieldRows entity="deal" recordId={lead.id} />
      </div>
    </div>
  );
}
