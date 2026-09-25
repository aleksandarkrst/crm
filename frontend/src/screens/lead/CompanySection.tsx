import { IconRow } from '../../components/icons';
import { GhostInput, GhostSelect, Picker, PickerRow, usePicker } from '../../components/ui';
import { INDUSTRIES, TEAM_SIZES } from '../../store/seed';
import { companyLabels, companyRecords, initialsOf } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

/** The deal's company (CD-83): which one, and its industry, HQ and size. */
export function CompanySection({ lead }: { lead: Lead }) {
  const store = useStore();
  const { s } = store;
  const picker = usePicker();
  const q = picker.search.toLowerCase().trim();
  const records = companyRecords(s);
  const labels = companyLabels(records);
  const options = records.filter((c) => c.id !== lead.companyId).filter((c) => !q || c.name.toLowerCase().includes(q));
  const patch = (key: keyof Lead) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => store.patchLead(lead.id, { [key]: e.target.value });

  return (
    <div className="card card-pad" data-testid="company-section">
      <span style={{ fontSize: 15, fontWeight: 600 }}>Company</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
        <IconRow icon="company" label="Company">
          <Picker
            picker={picker}
            items={options.map((c) => (
              <PickerRow
                key={c.id}
                square
                initials={initialsOf(c.name)}
                title={labels.get(c.id) ?? c.name}
                subtitle={c.oppCount ? c.oppCount + (c.oppCount === 1 ? ' deal' : ' deals') : 'No deals yet'}
                onPick={() => {
                  store.patchLead(lead.id, { companyId: c.id });
                  picker.close();
                }}
              />
            ))}
          >
            <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{lead.company}</span>
          </Picker>
        </IconRow>
        <IconRow icon="industry" label="Industry">
          <GhostSelect chevron aria-label="Industry" value={lead.industry} onChange={patch('industry')} options={INDUSTRIES} />
        </IconRow>
        <IconRow icon="location" label="HQ">
          <GhostInput aria-label="HQ" value={lead.hq} onChange={patch('hq')} />
        </IconRow>
        <IconRow icon="team" label="Team size">
          <GhostSelect chevron aria-label="Team size" value={lead.size} onChange={patch('size')} options={TEAM_SIZES} />
        </IconRow>
      </div>
    </div>
  );
}
