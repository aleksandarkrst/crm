import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { CustomFieldRows } from '../components/CustomFields';
import { DangerButton, FieldRow, GhostInput, GhostSelect, PersonChip, Picker, PickerRow, usePicker } from '../components/ui';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { CHANNEL_LABELS, INDUSTRIES, SOURCES, TEAM_SIZES } from '../store/seed';
import { allPeople, closeIsoOf, companyOfPerson, companyRecords, contactsForLead, initialsOf, stageOf, timelineFor } from '../store/selectors';
import { useStore } from '../store/store';
import type { Person } from '../store/types';

export function Company() {
  const store = useStore();
  const { s } = store;
  const { id = '' } = useParams();
  const picker = usePicker();
  const rec = companyRecords(s).find((c) => c.id === id);
  const leadIds = (rec?.leads ?? []).map((l) => l.id).join(',');
  const { ensureLog } = store;
  useEffect(() => {
    if (leadIds) ensureLog(leadIds.split(','));
  }, [leadIds, ensureLog]);
  if (!rec) return <Navigate to={paths.companies} replace />;

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
  const set = (key: 'name' | 'industry' | 'hq' | 'size' | 'source') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => store.setCompanyField(rec.id, key, e.target.value);

  /** Deals keep a company, so a company with deals can't be deleted; its contacts are kept. */
  const onDelete = () => {
    if (rec.leads.length) {
      const what = rec.leads.length === 1 ? 'a deal' : rec.leads.length + ' deals';
      window.alert(`${rec.name} has ${what}. Delete them or move them to another company first.`);
      return;
    }
    const own = allPeople(s).filter((p) => p.companyId === rec.id).length;
    const kept = own ? ` Its ${own === 1 ? 'contact is' : own + ' contacts are'} kept without a company.` : '';
    if (window.confirm(`Delete ${rec.name}?${kept} This can't be undone.`)) void store.deleteCompany(rec.id);
  };

  return (
    <Screen title={rec.name || 'Company'} crumb={{ label: 'Companies', to: paths.companies }}>
      <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card card-pad">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input className="ghost" value={rec.name} onChange={set('name')} style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', borderRadius: 8, padding: '5px 8px', marginLeft: -8 }} />
            {store.canDelete && <DangerButton onClick={onDelete}>Delete company</DangerButton>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>
            {rec.oppCount}
            {rec.oppCount === 1 ? ' opportunity · ' : ' opportunities · '}
            {rec.valueLabel} open
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
            <CustomFieldRows entity="company" recordId={rec.id} />
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
                  {s.funnels[l.segment]?.label ?? 'Funnel'} · {closeIsoOf(l) ? 'closes ' + closeIsoOf(l) : 'no closing date'}
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
