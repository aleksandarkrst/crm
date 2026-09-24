import { FieldRow, GhostInput } from '../../components/ui';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

/** What discovery found out. Saved on the deal and merged into the proposal ("What you told us"). */
export function Discovery({ lead }: { lead: Lead }) {
  const { patchLead } = useStore();
  const patch = (key: 'headline' | 'need' | 'constraint' | 'decisionMaker' | 'discoveryDate') => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    patchLead(lead.id, { [key]: e.target.value });

  return (
    <div className="card card-pad">
      <span style={{ fontSize: 15, fontWeight: 600 }}>Discovery</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
        <FieldRow label="Discovery date">
          <GhostInput type="date" value={lead.discoveryDate} onChange={patch('discoveryDate')} />
        </FieldRow>
        <FieldRow label="Need">
          <textarea className="ghost" rows={3} maxLength={1000} style={{ resize: 'vertical', lineHeight: 1.5 }} value={lead.need} onChange={patch('need')} placeholder="What they told you they need" />
        </FieldRow>
        <FieldRow label="Constraint">
          <GhostInput maxLength={500} value={lead.constraint} onChange={patch('constraint')} placeholder="Deadline, budget, approvals…" />
        </FieldRow>
        <FieldRow label="Decision maker">
          <GhostInput maxLength={200} value={lead.decisionMaker} onChange={patch('decisionMaker')} placeholder="Who signs off" />
        </FieldRow>
        <FieldRow label="Proposal headline">
          <GhostInput maxLength={200} value={lead.headline} onChange={patch('headline')} placeholder={lead.title || 'One line for the proposal cover'} />
        </FieldRow>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 10 }}>These go into the proposal.</div>
    </div>
  );
}
