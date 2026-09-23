import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { FieldRow, GhostInput, GhostSelect, PersonChip, Picker, PickerRow, usePicker } from '../components/ui';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { CHANNEL_LABELS, INDUSTRIES, SOURCES, TEAM_SIZES } from '../store/seed';
import { allPeople, closeIsoOf, companyOfPerson, companyRecords, contactsForLead, initialsOf, stageOf, timelineFor } from '../store/selectors';
import { useStore } from '../store/store';
import type { Person } from '../store/types';

export function Company() {
  const store = useStore();
  const { s } = store;
  const { name = '' } = useParams();
  const picker = usePicker();
  const all = companyRecords(s);
  const rec = all.find((c) => c.name === name) || all[0];
  const leadIds = (rec?.leads ?? []).map((l) => l.id).join(',');
  const { ensureLog } = store;
  useEffect(() => {
    if (leadIds) ensureLog(leadIds.split(','));
  }, [leadIds, ensureLog]);
  if (!rec) return <Screen title="Company">No companies yet.</Screen>;

  const people: Person[] = [];
  const seen = new Set<string>();
  rec.leads.forEach((l) =>
    contactsForLead(s, l.id).forEach((p) => {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        people.push(p);
      }
    }),
  );
  const q = picker.search.toLowerCase().trim();
  const directory = allPeople(s)
    .filter((p) => !seen.has(p.id))
    .filter((p) => !q || String(p.name || '').toLowerCase().includes(q));
  const target = rec.leads[0];

  const activities = rec.leads.flatMap((l) => timelineFor(s, l.id)).slice(0, 10);
  const set = (key: 'name' | 'industry' | 'hq' | 'size' | 'source') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => store.setCompanyField(rec.name, key, e.target.value);

  return (
    <Screen title={rec.name || 'Company'} crumb={{ label: 'Companies', to: paths.companies }}>
      <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card card-pad">
          <input className="ghost" value={rec.name} onChange={set('name')} style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', borderRadius: 8, padding: '5px 8px', marginLeft: -8 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>
            {rec.oppCount}
            {rec.oppCount === 1 ? ' opportunity · ' : ' opportunities · '}
            {rec.valueLabel || '€0'} open
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--divider)' }}>
            <FieldRow label="Industry">
              <GhostSelect value={rec.industry} onChange={set('industry')} options={INDUSTRIES} />
            </FieldRow>
            <FieldRow label="HQ">
              <GhostInput value={rec.hq} onChange={set('hq')} />
            </FieldRow>
            <FieldRow label="Team size">
              <GhostSelect value={rec.size} onChange={set('size')} options={TEAM_SIZES} />
            </FieldRow>
            <FieldRow label="Source">
              <GhostSelect value={rec.source} onChange={set('source')} options={SOURCES} />
            </FieldRow>
            <FieldRow label="Contacts">
              <Picker
                picker={picker}
                placeholder="Search contacts…"
                items={directory.map((p) => (
                  <PickerRow
                    key={p.id}
                    initials={p.initials || initialsOf(p.name)}
                    title={p.name}
                    subtitle={companyOfPerson(s, p)}
                    onPick={() => {
                      if (target) {
                        store.linkPerson(target.id, p.id);
                        picker.setSearch('');
                      }
                    }}
                  />
                ))}
              >
                {people.map((p, i) => (
                  <PersonChip
                    key={p.id}
                    initials={p.initials || initialsOf(p.name)}
                    label={i < people.length - 1 ? p.name + ',' : p.name}
                    onDrop={(e) => {
                      e.stopPropagation();
                      rec.leads.forEach((l) => store.unlinkPerson(l.id, p.id));
                    }}
                  />
                ))}
              </Picker>
            </FieldRow>
            <FieldRow label="Owner">
              <span className="field-value">{rec.owner}</span>
            </FieldRow>
          </div>
        </div>

        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card-title">Opportunities</div>
          {rec.leads.map((l) => (
            <div key={l.id} onClick={() => store.openLead(l.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: '1px solid var(--divider)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{l.title || l.company}</span>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {l.segment === 'smb' ? 'SMB funnel' : 'Enterprise funnel'} · closes {closeIsoOf(l)}
                </span>
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--brand)', whiteSpace: 'nowrap' }}>{l.value}</span>
              <span className="badge badge-neutral">{stageOf(s, l).name}</span>
            </div>
          ))}
        </div>

        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 8 }}>
            Activity
          </div>
          {activities.map((e, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '78px 1fr auto', gap: 14, padding: '11px 0', borderTop: '1px solid var(--divider)', alignItems: 'start' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.date}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{e.title}</span>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45 }}>{e.detail}</div>
              </div>
              <span className="badge badge-neutral">{CHANNEL_LABELS[e.channel] || e.channel}</span>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
