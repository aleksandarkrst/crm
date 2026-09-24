import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar } from '../components/ui';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { DATE_RANGES, dateRangeLabel, DEFAULT_FILTERS, SOURCES } from '../store/seed';
import { billedShare, bonusOf, bonusRule, closeIsoOf, closeRangeOf, curOf, currencySymbol, funnelOptions, inCloseRange, linePayments, linesOf, moneyTotal, num, salesPeople, stageOf, stagesFor, todayIso, valueNum, valueTotal } from '../store/selectors';
import { conversionMetrics, daysLabel, MIN_MOVED_DEALS } from '../store/metrics';
import { useStore } from '../store/store';
import type { Lead, SegKey } from '../store/types';

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
const CONV_COLS = 'minmax(0,1.3fr) minmax(0,1fr) 44px 64px 84px';
const clip = 'polygon(0 0, 100% 0, calc(100% - 14px) 100%, 14px 100%)';
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const pct = (r: number | null) => (r === null ? '—' : Math.round(r * 100) + '%');

export function Dashboard() {
  const { s, set, refreshHistory, canSeeBonuses } = useStore();
  const [dashSeg, setDashSeg] = useState<SegKey>(s.segment);
  // The stage history is loaded each time Overview opens, so it includes the latest moves.
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);
  const f = s.filters;
  // "This quarter" and "this year" are fiscal ones, and "today" is the workspace's (CD-73).
  const range = closeRangeOf(f.dates, todayIso(s.workspace.timezone), s.workspace.fiscalMonth);
  const rangeLabel = (v: string) => dateRangeLabel(v, s.workspace.fiscalMonth);
  // Every panel below works on these deals, so the filter chips (including the closing-date range) apply everywhere.
  const beforeDates = s.leads
    .filter((l) => f.audience === 'Audience' || l.segment === f.audience)
    .filter((l) => f.owner === 'Salesperson' || l.ownerId === f.owner)
    .filter((l) => f.source === 'Source' || l.source === f.source);
  const dashLeads = beforeDates.filter((l) => inCloseRange(l, range));
  const undatedHidden = range ? beforeDates.filter((l) => !closeIsoOf(l)).length : 0;
  const setFilter = (k: keyof typeof f) => (v: string) => set((x) => ({ filters: { ...x.filters, [k]: v } }));
  const dirty = (['audience', 'owner', 'dates', 'source'] as const).some((k) => f[k] !== DEFAULT_FILTERS[k]);
  const drill = (kicker: string, title: string, leadIds: string[]) => set({ drill: { kicker, title, leadIds } });

  // Lost deals (CD-60) count nowhere in the pipeline: not open, not weighted, not stalled.
  const liveLeads = dashLeads.filter((l) => l.outcome !== 'lost');
  const openLeads = dashLeads.filter((l) => l.outcome === 'open');
  const wonLeads = dashLeads.filter((l) => l.outcome === 'won');
  // Sums are per currency: a deal in another currency than the workspace's is listed next to it, not added in.
  const openValue = valueTotal(s, openLeads, true);
  const wonValue = valueTotal(s, wonLeads, true);
  const weighted = moneyTotal(s, openLeads.map((l) => ({ currency: l.currency, amount: (valueNum(l.value) * num(stageOf(s, l).prob)) / 100 })), true);
  const stalled = openLeads.filter((l) => l.stall >= 3);
  const metrics = [
    { label: 'Open pipeline', value: openValue, note: plural(openLeads.length, 'open deal') + ' in the current filter' },
    { label: 'Weighted pipeline', value: weighted, note: "Open value × each stage's win probability" },
    { label: 'Won', value: wonValue, note: plural(wonLeads.length, 'deal') + ' in the won stage' },
    { label: 'Stalled', value: String(stalled.length), note: 'Open deals with no contact for 3+ days' },
  ];

  const stages = stagesFor(s, dashSeg);
  const stageFunnel = stages.map((x, i) => {
    const rows = liveLeads.filter((l) => l.segment === dashSeg && l.stage === x.id);
    return {
      name: x.name,
      ids: rows.map((l) => l.id),
      meta: plural(rows.length, 'deal') + ' · ' + valueTotal(s, rows),
      width: 100 - i * (58 / Math.max(1, stages.length - 1)) + '%',
      bg: STAGE_SHADES[Math.min(i, STAGE_SHADES.length - 1)],
      fg: i >= 3 ? '#F5F6F8' : '#101828',
      subFg: i >= 3 ? '#DCEBE4' : '#475467',
    };
  });

  const today = new Date();
  const payments: { leadId: string; currency?: string; when: Date; amount: number }[] = [];
  // Payments without a date (no start date, and no date of their own on a milestone) can't be
  // placed, so they are left out and their lines counted below.
  let undatedLines = 0;
  for (const l of liveLeads)
    for (const ln of linesOf(s, l)) {
      const { payments: dated, undated } = linePayments(ln);
      if (undated) undatedLines++;
      for (const p of dated) payments.push({ leadId: l.id, currency: l.currency, ...p });
    }
  const timeFunnel = TIME_BUCKETS.map((b, i) => {
    const due = payments.filter((p) => {
      const diff = (p.when.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30.4);
      return diff > b.range[0] && diff <= b.range[1];
    });
    return {
      label: b.label,
      ids: [...new Set(due.map((p) => p.leadId))],
      value: moneyTotal(s, due),
      width: 100 - i * 11 + '%',
      bg: TIME_SHADES[i],
      fg: i >= 3 ? '#F5F6F8' : '#101828',
      subFg: i >= 3 ? '#E4E7EC' : '#475467',
    };
  });

  // Sales bonuses (CD-17): owners and admins only, from the rules saved in Settings → Sales bonuses.
  const trigger = s.bonusTrigger || 'On contract signed';
  const totalEarned: { currency?: string; amount: number }[] = [];
  const totalPending: { currency?: string; amount: number }[] = [];
  const bonusRows = (canSeeBonuses ? salesPeople(s) : [])
    .filter(({ value: ownerId }) => f.owner === 'Salesperson' || ownerId === f.owner)
    .map(({ value: ownerId, label: owner }) => {
    const rule = bonusRule(s, ownerId);
    const mine = liveLeads.filter((l) => l.ownerId === ownerId);
    const earned: { currency?: string; amount: number }[] = [];
    const pending: { currency?: string; amount: number }[] = [];
    const earnedIds: string[] = [];
    const pendingIds: string[] = [];
    for (const l of mine) {
      const bonus = bonusOf(l, rule, s.workspace.currency);
      const won = l.outcome === 'won';
      const full = rule.trigger === 'When fully billed' ? billedShare(s, l) >= 0.999 : true;
      if (won && full) {
        earned.push({ currency: l.currency, amount: bonus });
        earnedIds.push(l.id);
      } else {
        pending.push({ currency: l.currency, amount: bonus });
        pendingIds.push(l.id);
      }
    }
    totalEarned.push(...earned);
    totalPending.push(...pending);
    return { ownerId, owner, rule, earned, pending, earnedIds, pendingIds };
  });
  const ruleText = (v: number | string, suffix = '') => (v === '' ? '—' : String(v) + suffix);

  return (
    <Screen title="Overview">
      <FilterBar
        chips={[
          { value: f.audience, options: [{ value: 'Audience', label: 'Audience' }, ...funnelOptions(s)], onChange: setFilter('audience') },
          { value: f.owner, options: ['Salesperson', ...salesPeople(s)], onChange: setFilter('owner') },
          { value: f.dates, options: DATE_RANGES.map((v) => ({ value: v, label: rangeLabel(v) })), onChange: setFilter('dates'), keepFirst: true },
          { value: f.source, options: ['Source', ...SOURCES], onChange: setFilter('source') },
        ]}
        dirty={dirty}
        onClear={() => set((x) => ({ filters: { ...x.filters, ...DEFAULT_FILTERS } }))}
        meta={`${plural(dashLeads.length, 'deal')} in view · ${range ? rangeLabel(f.dates).toLowerCase() : 'any closing date'}${undatedHidden ? ` · ${undatedHidden} without a closing date hidden` : ''}`}
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
                <span className="card-sub">Deals and value by stage</span>
              </div>
              <select value={dashSeg} onChange={(e) => setDashSeg(e.target.value)} style={{ border: '1px solid var(--border)', background: 'var(--white)', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, color: 'var(--ink)' }}>
                {funnelOptions(s).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
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
            <div className="card-sub" style={{ marginBottom: 16 }}>
              Product and service payments falling due inside each horizon, incl. VAT
              {undatedLines ? ` · ${plural(undatedLines, 'line')} without payment dates left out` : ''}
            </div>
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

        {canSeeBonuses && (
        <div className="card" data-testid="bonus-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <div className="card-title" style={{ marginBottom: 4 }}>Sales bonuses</div>
              <div className="card-sub">
                Rate per salesperson, with a flat amount on deals under the minimum · earned {trigger.toLowerCase()} · only owners and admins see this ·{' '}
                <Link to={paths.settings('bonuses')} style={{ color: 'var(--brand)' }}>
                  Edit the rules
                </Link>
              </div>
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              {moneyTotal(s, totalEarned)} earned · {moneyTotal(s, totalPending)} pending
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 640 }}>
              <div style={{ display: 'grid', gridTemplateColumns: BONUS_COLS, gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                {['Salesperson', 'Rate %', `Min deal (${currencySymbol(curOf(s))})`, 'Flat under min', 'Earned', 'Pending'].map((h) => (
                  <span key={h} className="th">
                    {h}
                  </span>
                ))}
              </div>
              {bonusRows.map((r) => (
                <div key={r.ownerId} style={{ display: 'grid', gridTemplateColumns: BONUS_COLS, gap: 12, padding: '7px 0', borderBottom: '1px solid var(--divider)', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.owner}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{ruleText(r.rule.rate, '%')}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{ruleText(r.rule.floor)}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{ruleText(r.rule.fixed)}</span>
                  <span className="hover-underline" onClick={() => r.earnedIds.length && drill('Bonus earned · ' + r.owner, r.rule.trigger, r.earnedIds)} style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand)', cursor: r.earnedIds.length ? 'pointer' : 'default' }}>
                    {moneyTotal(s, r.earned)}
                  </span>
                  <span className="hover-underline" onClick={() => r.pendingIds.length && drill('Bonus pending · ' + r.owner, r.rule.trigger, r.pendingIds)} style={{ fontSize: 13, color: 'var(--text-2)', cursor: r.pendingIds.length ? 'pointer' : 'default' }}>
                    {moneyTotal(s, r.pending)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
          <StageConversion leads={dashLeads} initialSeg={dashSeg} />

          <div className="card" style={{ padding: 18 }}>
            <div className="card-title" style={{ marginBottom: 4 }}>Documents generated</div>
            <div className="card-sub" style={{ marginBottom: 16 }}>Proposals, quotes, contracts and invoices</div>
            <div className="empty-dashed">Document counts appear once generated documents are saved to the workspace.</div>
          </div>
        </div>

        <StalledLeads rows={stalled.map((l) => ({ id: l.id, company: l.company, stageName: stageOf(s, l).name, next: stageOf(s, l).activity, stall: l.stall }))} />
      </div>
    </Screen>
  );
}

/**
 * Stage-to-stage conversion, win rate, time in stage and time to proposal (CD-62), computed in the
 * browser from the stage history of the deals in view, so the Overview filters apply as elsewhere.
 */
function StageConversion({ leads, initialSeg }: { leads: Lead[]; initialSeg: SegKey }) {
  const { s, set } = useStore();
  const [seg, setSeg] = useState<SegKey>(initialSeg);
  const stages = stagesFor(s, seg);
  const inFunnel = leads.filter((l) => l.segment === seg);
  const m = s.stageHistory ? conversionMetrics(stages, inFunnel, s.stageHistory) : null;
  const drill = (title: string, leadIds: string[]) => leadIds.length && set({ drill: { kicker: 'Stage conversion', title, leadIds } });
  const stats = m && [
    { label: 'Win rate', value: pct(m.winRate), note: m.won + m.lost ? `${m.won} won · ${m.lost} lost` : 'No won or lost deals yet' },
    {
      label: m.proposal ? `To ${m.proposal.name.toLowerCase()}` : 'To proposal',
      value: daysLabel(m.toProposalDays),
      note: !m.proposal ? 'This funnel has no proposal stage' : m.toProposalDeals ? `Average from ${stages[0]!.name.toLowerCase()}, ${plural(m.toProposalDeals, 'deal')}` : 'No deal has reached it yet',
    },
    { label: 'Deals that moved', value: String(m.moved), note: `of ${plural(inFunnel.length, 'deal')} in view` },
  ];

  return (
    <div className="card" style={{ padding: 18 }} data-testid="stage-conversion">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 auto', minWidth: 0 }}>
          <span className="card-title">Stage conversion</span>
          <span className="card-sub">Share of deals that reached a stage and moved on to a later one</span>
        </div>
        <select value={seg} onChange={(e) => setSeg(e.target.value)} style={{ flex: '0 1 auto', minWidth: 0, maxWidth: '55%', border: '1px solid var(--border)', background: 'var(--white)', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, color: 'var(--ink)' }}>
          {funnelOptions(s).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {!m ? (
        <div className="empty-dashed">Loading the stage history…</div>
      ) : m.moved < MIN_MOVED_DEALS ? (
        <div className="empty-dashed">
          Conversion rates appear once at least {MIN_MOVED_DEALS} deals in view have moved between stages ({m.moved} so far).
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
            {stats!.map((x) => (
              <div key={x.label} style={{ border: '1px solid var(--divider)', borderRadius: 8, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                <span className="caps">{x.label}</span>
                <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 22, lineHeight: 1 }}>{x.value}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.35 }}>{x.note}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: CONV_COLS, gap: 10, padding: '0 0 8px', borderBottom: '1px solid var(--border)' }}>
              {['Stage', 'Moved on', '', 'Deals', 'Avg in stage'].map((h, i) => (
                <span key={i} className="th" style={{ textAlign: i >= 2 ? 'right' : undefined }}>
                  {h}
                </span>
              ))}
            </div>
            {m.stages.map((r) => (
              <div
                key={r.stage.id}
                data-stage={r.stage.name}
                onClick={() => drill(`Reached ${r.stage.name}`, r.reached)}
                style={{ display: 'grid', gridTemplateColumns: CONV_COLS, gap: 10, padding: '8px 0', borderBottom: '1px solid var(--divider)', alignItems: 'center', cursor: r.reached.length ? 'pointer' : 'default' }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.stage.name}</span>
                <span style={{ height: 6, borderRadius: 3, background: 'var(--chip)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: (r.rate ?? 0) * 100 + '%', background: 'var(--brand)' }} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{pct(r.rate)}</span>
                <span style={{ fontSize: 12, color: 'var(--text-2)', textAlign: 'right' }}>
                  {r.advanced.length}/{r.reached.length}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-2)', textAlign: 'right' }}>{daysLabel(r.avgDays)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StalledLeads({ rows }: { rows: { id: string; company: string; stageName: string; next: string; stall: number }[] }) {
  const { openLead } = useStore();
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="card-title" style={{ marginBottom: 14 }}>Stalled deals — no contact for 3+ days</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.length === 0 && <div className="empty-dashed">No stalled deals in the current filter.</div>}
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
