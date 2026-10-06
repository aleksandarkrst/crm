import { billingDates, billingText, dealTotals } from '../store/dealMath';
import { type Cur, curOf, isoLabel, itemById, leadById, linesOf, money, num } from '../store/selectors';
import { useStore } from '../store/store';
import type { Lead, State } from '../store/types';

/** Billing rows for the proposal (CD-83): the installments, or each product's billings, by date. */
function billingRows(s: State, lead: Lead, c: Cur) {
  const rows: { sort: number; when: string; label: string; amount: string }[] = [];
  const add = (iso: string, when: string, label: string, amount: string) => rows.push({ sort: new Date(iso || '2100-01-01').getTime() || 0, when, label, amount });
  if (lead.installments.length) {
    lead.installments.forEach((x, i) => add(x.date, x.date ? isoLabel(x.date) : 'No date', x.description || `Installment ${i + 1} of ${lead.installments.length}`, money(num(x.amount), c)));
    return rows.sort((a, b) => a.sort - b.sort);
  }
  const lines = linesOf(s, lead);
  const totals = dealTotals(lines, lead.taxMode, lead.discounts);
  lines.forEach((ln, i) => {
    const it = itemById(s, ln.itemId);
    const t = totals.lines[i]!;
    const each = money(t.tcv / t.cycles, c);
    const dates = billingDates(ln);
    if (ln.frequency === 'one_time') add(ln.start, ln.start ? isoLabel(ln.start) : 'No date', it.name + ' · Full amount', each);
    else add(ln.start, ln.start ? 'from ' + isoLabel(ln.start) + (dates.length > 1 && ln.cycles ? ' to ' + isoLabel(dates.at(-1)!) : '') : 'No date', it.name + ' · ' + billingText(ln.frequency, ln.cycles), each + ' each');
  });
  return rows.sort((a, b) => a.sort - b.sort);
}

/** The generated proposal, rendered from the deal record. Merge fields are highlighted. */
export function ProposalDoc() {
  const { s, set, sendDoc } = useStore();
  const lead = leadById(s, s.docLeadId) || s.leads[0]!;
  const merge = { background: s.showMerge ? '#FDF0E4' : 'transparent', padding: '1px 3px' };
  const lines = linesOf(s, lead);
  const totals = dealTotals(lines, lead.taxMode, lead.discounts);
  const net = totals.subtotal;
  const vat = totals.tax;
  const c = curOf(s, lead);
  const billing = billingRows(s, lead, c);
  const first = (lead.contact || '').split(' ')[0];
  const docLines = lines.length
    ? lines.map((ln, i) => {
        const it = itemById(s, ln.itemId);
        const q = num(ln.qty);
        const unit = it.unit;
        return {
          item: it.name,
          detail: `${q}${unit ? ' ' + unit : ' ×'} · ${money(num(ln.price), c)}${unit ? ' / ' + unit : ' each'} · ${billingText(ln.frequency, ln.cycles).toLowerCase()}`,
          amount: money(totals.lines[i]!.tcv, c),
        };
      })
    : lead.lines.map(([item, amount]) => ({ item, amount, detail: '' }));

  const eyebrow = { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#475750' };

  // Discovery notes saved on the deal. Anything not captured yet shows as a bracketed gap to fill in.
  const gap = (what: string) => `[${what} — add it under Discovery on the deal]`;
  const headline = lead.headline || lead.title || lead.company;
  const callDate = lead.discoveryDate ? new Date(lead.discoveryDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : gap('call date');
  const need = lead.need.trim() ? lead.need.trim().replace(/([^.!?])$/, '$1.') : gap('need') + '.';
  const constraint = lead.constraint ? lead.constraint.replace(/[\s.]+$/, '') : gap('constraint');
  const decisionMaker = lead.decisionMaker ? lead.decisionMaker.replace(/[\s.]+$/, '') : gap('decision maker');

  return (
    <div className="overlay" style={{ zIndex: 50, alignItems: 'flex-start', overflowY: 'auto', padding: 0 }}>
      <div style={{ background: 'var(--bg-soft)', width: '100%', maxWidth: 1080, minHeight: '100vh', animation: 'dcFade .25s ease-out both', margin: '0 auto' }}>
        <div style={{ position: 'sticky', top: 0, background: '#0F1B16', color: '#F5F7F6', padding: '14px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', zIndex: 2 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Proposal — {lead.company}</span>
            <span style={{ fontSize: 10.5, color: '#93A39B' }}>Proposal v4 · generated from CRM record · {s.sent ? 'marked sent (this session only)' : 'draft, not saved'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <button type="button" className="doc-btn" onClick={() => set((x) => ({ showMerge: !x.showMerge }))}>
              {s.showMerge ? 'Hide merge fields' : 'Show merge fields'}
            </button>
            <button type="button" onClick={sendDoc} title={`Emailing proposals to ${first || 'the contact'} is coming soon; this only marks it as sent here.`} style={{ border: 0, background: '#F5F7F6', color: '#0F1B16', cursor: 'pointer', fontSize: 12.5, fontWeight: 500, padding: '9px 14px', borderRadius: 7 }}>
              {s.sent ? 'Marked as sent ✓' : 'Mark as sent'}
            </button>
            <button type="button" className="doc-btn" onClick={() => set({ docOpen: false })}>
              Close
            </button>
          </div>
        </div>

        <div style={{ padding: '26px 22px 60px' }}>
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8E4', padding: '56px 60px', display: 'flex', flexDirection: 'column', gap: 38 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 700, letterSpacing: '-0.02em', fontSize: 20 }}>{s.workspace.name}</span>
              </div>
              <span style={{ fontSize: 10.5, color: '#475750' }}>PRO-{lead.id.toUpperCase()}-2026</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderBottom: '1px solid #E2E8E4', paddingBottom: 34 }}>
              <span style={{ ...eyebrow, color: '#B4531B' }}>Proposal</span>
              <span style={{ fontWeight: 600, letterSpacing: '-0.028em', fontSize: 44, lineHeight: 1.1 }}>{headline}</span>
              <span style={{ fontSize: 15, color: '#475750', lineHeight: 1.6, maxWidth: 640 }}>
                Prepared for <span style={{ color: '#0F1B16', ...merge }}>{lead.contact}</span>, <span style={{ color: '#0F1B16', ...merge }}>{lead.role}</span> at <span style={{ color: '#0F1B16', ...merge }}>{lead.company}</span>.{' '}
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
                  <div key={item} style={{ borderTop: '2px solid #0F1B16', paddingTop: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{item}</span>
                    <span style={{ fontSize: 13.5, color: '#475750', lineHeight: 1.6 }}>Delivered by a named lead from our team, with a fixed review cadence and one point of contact.</span>
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
                  <div key={t.when} style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 18, padding: '13px 0', borderBottom: '1px solid #EBF0ED' }}>
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
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 18, padding: '13px 0', borderBottom: '1px solid #EBF0ED' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <span style={{ fontSize: 14.5 }}>{l.item}</span>
                      <span style={{ fontSize: 12.5, color: '#475750' }}>{l.detail}</span>
                    </span>
                    <span style={{ fontSize: 14, whiteSpace: 'nowrap', ...merge }}>{l.amount}</span>
                  </div>
                ))}
                <DocTotal label="Net" value={lines.length ? money(net, c) : lead.total} pad="13px 0 0" />
                <DocTotal label="Tax" value={lines.length ? money(vat, c) : '—'} pad="6px 0 0" />
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 18, padding: '14px 0 0' }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>Total incl. VAT</span>
                  <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 28, color: '#14503C' }}>{lines.length ? money(net + vat, c) : lead.total}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={eyebrow}>05 — Billing schedule</span>
              {billing.length === 0 && <span style={{ fontSize: 14, color: '#475750' }}>Billing is set once products and services are added to the deal.</span>}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {billing.map((b, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) auto', gap: 18, alignItems: 'baseline', padding: '11px 0', borderBottom: '1px solid #EBF0ED' }}>
                    <span style={{ fontSize: 13.5, color: '#475750' }}>{b.when}</span>
                    <span style={{ fontSize: 14 }}>{b.label}</span>
                    <span style={{ fontSize: 14, whiteSpace: 'nowrap', ...merge }}>{b.amount}</span>
                  </div>
                ))}
              </div>
              <span style={{ fontSize: 12.5, color: '#93A39B' }}>Amounts include VAT.</span>
            </div>

            <div style={{ background: '#F5F7F6', borderLeft: '3px solid #14503C', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Next step</span>
              <span style={{ fontSize: 14, color: '#475750', lineHeight: 1.65, maxWidth: 620 }}>A 20-minute walkthrough of section 04 with {first}. Approve the scope and we hold the team's start date for 14 days.</span>
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
      <span style={{ fontSize: 13.5, color: '#475750' }}>{label}</span>
      <span style={{ fontSize: 14, color: '#475750' }}>{value}</span>
    </div>
  );
}
