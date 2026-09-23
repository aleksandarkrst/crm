import { useState } from 'react';
import { FilterBar, GhostInput } from '../components/ui';
import { Screen } from '../components/Layout';
import { DATE_RANGES, DEFAULT_FILTERS, SOURCES } from '../store/seed';
import { billedShare, bonusOf, bonusRule, grossOf, linesOf, money, num, ownerOf, salesPeople, shiftIso, stageOf, valueNum } from '../store/selectors';
import { useStore } from '../store/store';
import type { SegKey } from '../store/types';

const CONVERSION = [
  { name: 'New lead → first touch', pct: 86 },
  { name: 'First touch → discovery', pct: 61 },
  { name: 'Discovery → proposal', pct: 73 },
  { name: 'Proposal → negotiation', pct: 58 },
  { name: 'Negotiation → won', pct: 41 },
];
const DOC_STATS = [
  { tag: 'PRO', name: 'Proposals', count: 38, saved: '57h saved' },
  { tag: 'QTE', name: 'Quotes', count: 12, saved: '9h saved' },
  { tag: 'CON', name: 'Contracts', count: 9, saved: '22h saved' },
  { tag: 'INV', name: 'First invoices', count: 5, saved: '8h saved' },
];
const STAGE_SHADES = ['#E7F2EE', '#CBE3DA', '#A3CFC0', '#2F7A5E', '#1B6148', '#14503C', '#0C3226'];
const TIME_SHADES = ['#F1F3F6', '#E0E3E9', '#C6CBD4', '#8A919F', '#5B6272', '#343B49'];
const TIME_BUCKETS = [
  { label: 'Up to 12 months', range: [9, 999] },
  { label: 'Up to 9 months', range: [6, 9] },
  { label: 'Up to 6 months', range: [3, 6] },
  { label: 'Up to 3 months', range: [1, 3] },
  { label: 'Up to 1 month', range: [0.5, 1] },
  { label: 'Now', range: [-999, 0.5] },
] as const;
const BONUS_COLS = 'minmax(0,1.6fr) 90px 120px 120px 120px 120px';
const clip = 'polygon(0 0, 100% 0, calc(100% - 14px) 100%, 14px 100%)';

export function Dashboard() {
  const { s, set } = useStore();
  const [dashSeg, setDashSeg] = useState<SegKey>(s.segment);
  const f = s.filters;
  const audLabel = (seg: SegKey) => s.funnels[seg].label;
  const dashLeads = s.leads
    .filter((l) => f.audience === 'Audience' || audLabel(l.segment) === f.audience)
    .filter((l) => f.owner === 'Salesperson' || ownerOf(l) === f.owner)
    .filter((l) => f.source === 'Source' || l.source === f.source);
  const dashValue = dashLeads.reduce((a, l) => a + valueNum(l.value), 0);
  const setFilter = (k: keyof typeof f) => (v: string) => set((x) => ({ filters: { ...x.filters, [k]: v } }));
  const dirty = (['audience', 'owner', 'dates', 'source'] as const).some((k) => f[k] !== DEFAULT_FILTERS[k]);
  const drill = (kicker: string, title: string, leadIds: string[]) => set({ drill: { kicker, title, leadIds } });

  const metrics = [
    { label: 'Open pipeline', value: '€' + Math.round(dashValue / 1000) + 'k', note: dashLeads.length + ' active leads in the current filter' },
    { label: 'Proposal → won', value: '41%', note: 'Up from 24% before the playbook' },
    { label: 'Days to proposal', value: '3.1', note: 'Was 11 when proposals were written by hand' },
    { label: 'Docs generated', value: '64', note: '≈ 96 hours of authoring avoided' },
  ];

  const stages = s.funnels[dashSeg].stages;
  const stageFunnel = stages.map((x, i) => {
    const rows = s.leads.filter((l) => l.segment === dashSeg && l.stage === x.id);
    const val = rows.reduce((a, l) => a + valueNum(l.value), 0);
    return {
      name: x.name,
      ids: rows.map((l) => l.id),
      meta: rows.length + (rows.length === 1 ? ' lead · €' : ' leads · €') + val.toLocaleString('en-US'),
      width: 100 - i * (58 / Math.max(1, stages.length - 1)) + '%',
      bg: STAGE_SHADES[Math.min(i, STAGE_SHADES.length - 1)],
      fg: i >= 3 ? '#F5F6F8' : '#101828',
      subFg: i >= 3 ? '#DCEBE4' : '#475467',
    };
  });

  const today = new Date();
  const payments: { leadId: string; when: Date; amount: number }[] = [];
  for (const l of s.leads)
    for (const ln of linesOf(s, l)) {
      const gross = grossOf(ln);
      const start = ln.start || '2026-10-01';
      const push = (iso: string, amount: number) => {
        const d = new Date(iso);
        if (!isNaN(d.getTime())) payments.push({ leadId: l.id, when: d, amount });
      };
      if (ln.schedule === 'Custom milestones') (ln.milestones || []).forEach((m, i) => push(m.date || shiftIso(start, i), (gross * num(m.pct)) / 100));
      else if (ln.schedule === 'Equal monthly instalments') {
        const n = Math.max(1, Math.round(num(ln.months)) || 1);
        for (let i = 0; i < n; i++) push(shiftIso(start, i), gross / n);
      } else if (ln.schedule === 'Recurring subscription') for (let i = 0; i < 12; i++) push(shiftIso(start, i), gross);
      else push(start, gross);
    }
  const timeFunnel = TIME_BUCKETS.map((b, i) => {
    const due = payments.filter((p) => {
      const diff = (p.when.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30.4);
      return diff > b.range[0] && diff <= b.range[1];
    });
    return {
      label: b.label,
      ids: [...new Set(due.map((p) => p.leadId))],
      value: money(due.reduce((a, p) => a + p.amount, 0)),
      width: 100 - i * 11 + '%',
      bg: TIME_SHADES[i],
      fg: i >= 3 ? '#F5F6F8' : '#101828',
      subFg: i >= 3 ? '#E4E7EC' : '#475467',
    };
  });

  const trigger = s.workspace.bonusTrigger || 'On contract signed';
  let totalEarned = 0;
  let totalPending = 0;
  const bonusRows = salesPeople(s).map((owner) => {
    const rule = bonusRule(s, owner);
    const mine = s.leads.filter((l) => ownerOf(l) === owner);
    let earned = 0;
    let pending = 0;
    const earnedIds: string[] = [];
    const pendingIds: string[] = [];
    for (const l of mine) {
      const bonus = bonusOf(l, rule);
      const won = stageOf(s, l).id === 'won';
      const full = rule.trigger === 'When fully billed' ? billedShare(s, l) >= 0.999 : true;
      if (won && full) {
        earned += bonus;
        earnedIds.push(l.id);
      } else {
        pending += bonus;
        pendingIds.push(l.id);
      }
    }
    totalEarned += earned;
    totalPending += pending;
    return { owner, rule, earned, pending, earnedIds, pendingIds };
  });
  const setRule = (owner: string, key: 'rate' | 'floor' | 'fixed') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    set((x) => {
      const { rate, floor, fixed } = bonusRule(x, owner);
      return { bonusRules: { ...x.bonusRules, [owner]: { rate, floor, fixed, [key]: v } } };
    });
  };

  const stalled = dashLeads.filter((l) => l.stall >= 3);

  return (
    <Screen title="Overview">
      <FilterBar
        chips={[
          { value: f.audience, options: ['Audience', s.funnels.smb.label, s.funnels.ent.label], onChange: setFilter('audience') },
          { value: f.owner, options: ['Salesperson', ...salesPeople(s)], onChange: setFilter('owner') },
          { value: f.dates, options: DATE_RANGES, onChange: setFilter('dates') },
          { value: f.source, options: ['Source', ...SOURCES], onChange: setFilter('source') },
        ]}
        dirty={dirty}
        onClear={() => set((x) => ({ filters: { ...x.filters, ...DEFAULT_FILTERS } }))}
        meta={`${dashLeads.length} leads in view · ${f.dates.toLowerCase()}`}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
          {metrics.map((m) => (
            <div key={m.label} className="card" style={{ padding: '16px 17px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div className="caps">{m.label}</div>
              <div style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 32, lineHeight: 1 }}>{m.value}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>{m.note}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span className="card-title">Pipeline funnel</span>
                <span className="card-sub">Open value by stage</span>
              </div>
              <select value={dashSeg} onChange={(e) => setDashSeg(e.target.value as SegKey)} style={{ border: '1px solid var(--border)', background: 'var(--white)', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, color: 'var(--ink)' }}>
                <option value="smb">{s.funnels.smb.label}</option>
                <option value="ent">{s.funnels.ent.label}</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
              {stageFunnel.map((b) => (
                <div key={b.name} onClick={() => drill('Stage', b.name, b.ids)} style={{ width: b.width, background: b.bg, clipPath: clip, padding: '11px 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: b.fg, textAlign: 'center' }}>{b.name}</span>
                  <span style={{ fontSize: 11.5, color: b.subFg, textAlign: 'center' }}>{b.meta}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div className="card-title" style={{ marginBottom: 4 }}>Funnel by payment due date</div>
            <div className="card-sub" style={{ marginBottom: 16 }}>Product and service payments falling due inside each horizon, incl. VAT</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
              {timeFunnel.map((b) => (
                <div key={b.label} onClick={() => drill('Payments due', b.label, b.ids)} style={{ width: b.width, background: b.bg, clipPath: clip, padding: '11px 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: b.fg, textAlign: 'center' }}>{b.label}</span>
                  <span style={{ fontSize: 11.5, color: b.subFg, textAlign: 'center' }}>{b.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <div className="card-title" style={{ marginBottom: 4 }}>Sales bonuses</div>
              <div className="card-sub">Rate per salesperson, with a flat amount on deals under the minimum · earned {trigger.toLowerCase()}</div>
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              {money(totalEarned)} earned · {money(totalPending)} pending
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 640 }}>
              <div style={{ display: 'grid', gridTemplateColumns: BONUS_COLS, gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                {['Salesperson', 'Rate %', 'Min deal (€)', 'Flat under min', 'Earned', 'Pending'].map((h) => (
                  <span key={h} className="th">
                    {h}
                  </span>
                ))}
              </div>
              {bonusRows.map((r) => (
                <div key={r.owner} style={{ display: 'grid', gridTemplateColumns: BONUS_COLS, gap: 12, padding: '7px 0', borderBottom: '1px solid var(--divider)', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.owner}</span>
                  <GhostInput className="ghost-sm" value={r.rule.rate} onChange={setRule(r.owner, 'rate')} />
                  <GhostInput className="ghost-sm" value={r.rule.floor} onChange={setRule(r.owner, 'floor')} />
                  <GhostInput className="ghost-sm" value={r.rule.fixed} onChange={setRule(r.owner, 'fixed')} />
                  <span className="hover-underline" onClick={() => r.earnedIds.length && drill('Bonus earned · ' + r.owner, r.rule.trigger, r.earnedIds)} style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand)', cursor: r.earnedIds.length ? 'pointer' : 'default' }}>
                    {money(r.earned)}
                  </span>
                  <span className="hover-underline" onClick={() => r.pendingIds.length && drill('Bonus pending · ' + r.owner, r.rule.trigger, r.pendingIds)} style={{ fontSize: 13, color: 'var(--text-2)', cursor: r.pendingIds.length ? 'pointer' : 'default' }}>
                    {money(r.pending)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
          <div className="card" style={{ padding: 18 }}>
            <div className="card-title" style={{ marginBottom: 4 }}>Stage conversion</div>
            <div className="card-sub" style={{ marginBottom: 16 }}>Last 90 days, both funnels</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {CONVERSION.map((row) => (
                <div key={row.name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span>{row.name}</span>
                    <span style={{ color: 'var(--text-2)' }}>{row.pct}%</span>
                  </div>
                  <div style={{ height: 7, background: 'var(--segment)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'var(--brand)', borderRadius: 4, transformOrigin: 'left', animation: 'dcBar .6s ease-out both', width: row.pct + '%' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div className="card-title" style={{ marginBottom: 4 }}>Documents generated</div>
            <div className="card-sub" style={{ marginBottom: 16 }}>Time saved versus manual authoring</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {DOC_STATS.map((d) => (
                <div key={d.tag} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--divider)', paddingBottom: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ fontSize: 9.5, background: 'var(--warn-soft)', color: 'var(--warn)', padding: '3px 5px', borderRadius: 4 }}>{d.tag}</span>
                    <span style={{ fontSize: 13 }}>{d.name}</span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {d.count} · {d.saved}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <StalledLeads rows={stalled.map((l) => ({ id: l.id, company: l.company, stageName: stageOf(s, l).name, next: stageOf(s, l).activity, stall: l.stall }))} />
      </div>
    </Screen>
  );
}

function StalledLeads({ rows }: { rows: { id: string; company: string; stageName: string; next: string; stall: number }[] }) {
  const { openLead } = useStore();
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="card-title" style={{ marginBottom: 14 }}>Stalled leads — nudge sent automatically</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => (
          <div key={r.id} onClick={() => openLead(r.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, cursor: 'pointer', border: '1px solid var(--divider)', borderRadius: 8, padding: '11px 13px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.company}</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {r.stageName} · {r.next}
              </span>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--danger)' }}>{r.stall} days silent</span>
          </div>
        ))}
      </div>
    </div>
  );
}
