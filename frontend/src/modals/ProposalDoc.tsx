import { itemById, leadById, linesOf, money, monthLabel, netOf, num, shiftIso, vatOf } from '../store/selectors';
import { useStore } from '../store/store';
import type { DealLine, State } from '../store/types';

const UNIT: Record<string, string> = { Hourly: 'h', Monthly: 'mo', Yearly: 'yr' };

/** Billing rows for the proposal: every payment each line produces, sorted by date. */
function billingRows(s: State, lines: DealLine[]) {
  const rows: { sort: number; when: string; label: string; amount: string }[] = [];
  for (const ln of lines) {
    const it = itemById(s, ln.itemId);
    const gross = num(ln.qty) * num(ln.price) * (1 + num(ln.vat) / 100);
    const add = (iso: string, when: string, label: string, amount: string) => rows.push({ sort: new Date(iso || '2100-01-01').getTime() || 0, when, label: it.name + ' · ' + label, amount });
    if (ln.schedule === 'Custom milestones')
      (ln.milestones || []).forEach((m, i) => {
        const iso = m.date || shiftIso(ln.start, i);
        add(iso, m.date ? monthLabel(m.date, 0) : monthLabel(ln.start, i), m.label, money((gross * num(m.pct)) / 100));
      });
    else if (ln.schedule === 'Equal monthly instalments') {
      const n = Math.max(1, Math.round(num(ln.months)) || 1);
      for (let i = 0; i < n; i++) add(ln.start, monthLabel(ln.start, i), `Instalment ${i + 1} of ${n}`, money(gross / n));
    } else if (ln.schedule === 'Recurring subscription') add(ln.start, 'from ' + monthLabel(ln.start, 0), 'Every month, no end date', money(gross) + ' / mo');
    else add(ln.start, monthLabel(ln.start, 0), 'Full amount', money(gross));
  }
  return rows.sort((a, b) => a.sort - b.sort);
}

/** The generated proposal, rendered from the deal record. Merge fields are highlighted. */
export function ProposalDoc() {
  const { s, set, sendDoc } = useStore();
  const lead = leadById(s, s.docLeadId) || s.leads[0]!;
  const merge = { background: s.showMerge ? '#FDF0E4' : 'transparent', padding: '1px 3px' };
  const lines = linesOf(s, lead);
  const net = netOf(lines);
  const vat = vatOf(lines);
  const billing = billingRows(s, lines);
  const first = (lead.contact || '').split(' ')[0];
  const docLines = lines.length
    ? lines.map((ln) => {
        const it = itemById(s, ln.itemId);
        const q = num(ln.qty);
        const unit = UNIT[it.kind];
        return {
          item: it.name,
          detail: `${q}${unit ? ' ' + unit : ' ×'} · ${money(num(ln.price))}${unit ? ' / ' + unit : ' each'} · ${ln.schedule.toLowerCase()}`,
          amount: money(q * num(ln.price)),
        };
      })
    : lead.lines.map(([item, amount]) => ({ item, amount, detail: '' }));

  const eyebrow = { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#475467' };

  // Discovery notes saved on the deal. Anything not captured yet shows as a bracketed gap to fill in.
  const gap = (what: string) => `[${what} — add it under Discovery on the deal]`;
  const headline = lead.headline || lead.title || lead.company;
  const callDate = lead.discoveryDate ? new Date(lead.discoveryDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : gap('call date');
  const need = lead.need.trim() ? lead.need.trim().replace(/([^.!?])$/, '$1.') : gap('need') + '.';
  const constraint = lead.constraint ? lead.constraint.replace(/[\s.]+$/, '') : gap('constraint');
  const decisionMaker = lead.decisionMaker ? lead.decisionMaker.replace(/[\s.]+$/, '') : gap('decision maker');

  return (
    <div className="overlay" style={{ zIndex: 50, alignItems: 'stretch', overflowY: 'auto', padding: 0 }}>
      <div style={{ background: 'var(--bg-soft)', width: '100%', maxWidth: 1080, minHeight: '100vh', animation: 'dcFade .25s ease-out both', margin: '0 auto' }}>
        <div style={{ position: 'sticky', top: 0, background: '#101828', color: '#F5F6F8', padding: '14px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', zIndex: 2 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Proposal — {lead.company}</span>
            <span style={{ fontSize: 10.5, color: '#98A2B3' }}>Proposal v4 · generated from CRM record · {s.sent ? 'marked sent (this session only)' : 'draft, not saved'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <button type="button" className="doc-btn" onClick={() => set((x) => ({ showMerge: !x.showMerge }))}>
              {s.showMerge ? 'Hide merge fields' : 'Show merge fields'}
            </button>
            <button type="button" onClick={sendDoc} title={`Emailing proposals to ${first || 'the contact'} is coming soon; this only marks it as sent here.`} style={{ border: 0, background: '#F5F6F8', color: '#101828', cursor: 'pointer', fontSize: 12.5, fontWeight: 500, padding: '9px 14px', borderRadius: 7 }}>
              {s.sent ? 'Marked as sent ✓' : 'Mark as sent'}
            </button>
            <button type="button" className="doc-btn" onClick={() => set({ docOpen: false })}>
              Close
            </button>
          </div>
        </div>

        <div style={{ padding: '26px 22px 60px' }}>
          <div style={{ background: '#FFFFFF', border: '1px solid #E4E7EC', padding: '56px 60px', display: 'flex', flexDirection: 'column', gap: 38 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 700, letterSpacing: '-0.02em', fontSize: 20 }}>{s.workspace.name}</span>
              </div>
              <span style={{ fontSize: 10.5, color: '#475467' }}>PRO-{lead.id.toUpperCase()}-2026</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderBottom: '1px solid #E4E7EC', paddingBottom: 34 }}>
              <span style={{ ...eyebrow, color: '#B4531B' }}>Proposal</span>
              <span style={{ fontWeight: 600, letterSpacing: '-0.028em', fontSize: 44, lineHeight: 1.1 }}>{headline}</span>
              <span style={{ fontSize: 15, color: '#475467', lineHeight: 1.6, maxWidth: 640 }}>
                Prepared for <span style={{ color: '#101828', ...merge }}>{lead.contact}</span>, <span style={{ color: '#101828', ...merge }}>{lead.role}</span> at <span style={{ color: '#101828', ...merge }}>{lead.company}</span>.{' '}
                {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · valid 30 days
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={eyebrow}>01 — What you told us</span>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, maxWidth: 680 }}>
                In our discovery call on <span style={merge}>{callDate}</span> you described <span style={merge}>{need}</span> The constraint is <span style={merge}>{constraint}</span> and the decision sits with <span style={merge}>{decisionMaker}</span>.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={eyebrow}>02 — Scope</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
                {lead.lines.map(([item]) => (
                  <div key={item} style={{ borderTop: '2px solid #101828', paddingTop: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{item}</span>
                    <span style={{ fontSize: 13.5, color: '#475467', lineHeight: 1.6 }}>Delivered by a named lead from our team, with a fixed review cadence and one point of contact.</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={eyebrow}>03 — Timeline</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {[
                  { when: 'Week 1–2', what: 'Immersion: interviews, audit, and a written point of view on the gap.' },
                  { when: 'Week 3–5', what: 'Build: ' + (lead.lines[0]?.[0] || 'scope').toLowerCase() + ' developed and reviewed with you.' },
                  { when: 'Week 6–8', what: 'Rollout: remaining workstreams delivered and handed over.' },
                  { when: 'Week 9', what: 'Readout against the goals agreed in discovery.' },
                ].map((t) => (
                  <div key={t.when} style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 18, padding: '13px 0', borderBottom: '1px solid #EEF0F4' }}>
                    <span style={{ fontSize: 12.5, color: '#B4531B' }}>{t.when}</span>
                    <span style={{ fontSize: 14.5, lineHeight: 1.5 }}>{t.what}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={eyebrow}>04 — Investment</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {docLines.map((l, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 18, padding: '13px 0', borderBottom: '1px solid #EEF0F4' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <span style={{ fontSize: 14.5 }}>{l.item}</span>
                      <span style={{ fontSize: 12.5, color: '#475467' }}>{l.detail}</span>
                    </span>
                    <span style={{ fontSize: 14, whiteSpace: 'nowrap', ...merge }}>{l.amount}</span>
                  </div>
                ))}
                <DocTotal label="Net" value={lines.length ? money(net) : lead.total} pad="13px 0 0" />
                <DocTotal label="VAT" value={lines.length ? money(vat) : '—'} pad="6px 0 0" />
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 18, padding: '14px 0 0' }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>Total incl. VAT</span>
                  <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 28, color: '#14503C' }}>{lines.length ? money(net + vat) : lead.total}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={eyebrow}>05 — Billing schedule</span>
              {billing.length === 0 && <span style={{ fontSize: 14, color: '#475467' }}>Billing is set once products and services are added to the deal.</span>}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {billing.map((b, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) auto', gap: 18, alignItems: 'baseline', padding: '11px 0', borderBottom: '1px solid #EEF0F4' }}>
                    <span style={{ fontSize: 13.5, color: '#475467' }}>{b.when}</span>
                    <span style={{ fontSize: 14 }}>{b.label}</span>
                    <span style={{ fontSize: 14, whiteSpace: 'nowrap', ...merge }}>{b.amount}</span>
                  </div>
                ))}
              </div>
              <span style={{ fontSize: 12.5, color: '#98A2B3' }}>Amounts include VAT.</span>
            </div>

            <div style={{ background: '#F5F6F8', borderLeft: '3px solid #14503C', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Next step</span>
              <span style={{ fontSize: 14, color: '#475467', lineHeight: 1.65, maxWidth: 620 }}>A 20-minute walkthrough of section 04 with {first}. Approve the scope and we hold the team's start date for 14 days.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocTotal({ label, value, pad }: { label: string; value: string; pad: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 18, padding: pad }}>
      <span style={{ fontSize: 13.5, color: '#475467' }}>{label}</span>
      <span style={{ fontSize: 14, color: '#475467' }}>{value}</span>
    </div>
  );
}
