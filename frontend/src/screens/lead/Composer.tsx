import { useState } from 'react';
import { CHANNEL_LABELS, OBJECTIONS } from '../../store/seed';
import { initialsOf, script, stageOf, todayLabel } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';
import { MeetingForm } from '../meeting/MeetingForm';
import { DealDocuments } from './DealDocuments';

const TABS = [
  { k: 'email', label: 'Email', ch: 'EM' },
  // Hidden per CD-224 until the WhatsApp and LinkedIn integrations exist; the product owner may bring them back.
  // { k: 'whatsapp', label: 'WhatsApp', ch: 'WA' },
  // { k: 'linkedin', label: 'LinkedIn', ch: 'LI' },
  { k: 'meeting', label: 'Meeting', ch: 'MT' },
  { k: 'note', label: 'Note', ch: 'NT' },
  { k: 'docs', label: 'Documents', ch: 'DOC' },
] as const;
type TabKey = (typeof TABS)[number]['k'] | 'whatsapp' | 'linkedin';
// WhatsApp and LinkedIn steps open the Note tab while their tabs are hidden (CD-224).
const DEFAULT_TAB: Record<string, TabKey> = { EM: 'email', /* WA: 'whatsapp', LI: 'linkedin', */ MT: 'meeting' };
const SEND_LABEL: Partial<Record<TabKey, string>> = { email: 'Send & log', whatsapp: 'Send on WhatsApp', linkedin: 'Send on LinkedIn', note: 'Save note' };

/** "Next best action": the stage's playbook step, with a composer per channel. */
export function Composer({ lead }: { lead: Lead }) {
  const store = useStore();
  const { s } = store;
  const stage = stageOf(s, lead);
  const def = DEFAULT_TAB[stage.channel] || 'note';
  const [picked, setTab] = useState<TabKey | null>(null);
  const tab = picked ?? def; // follows the stage until the user picks a tab
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [objectionsOpen, setObjectionsOpen] = useState(false);
  /** A new form after each meeting scheduled here. */
  const [meetingForm, setMeetingForm] = useState(0);

  const tdef = TABS.find((t) => t.k === tab) ?? TABS[0];
  const get = (k: string, v: string) => drafts[tab + '.' + k] ?? v;
  const setDraft = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setDrafts((d) => ({ ...d, [tab + '.' + k]: v }));
  };

  const first = (lead.contact || '').split(' ')[0];
  const isMessage = tab === 'email' || tab === 'whatsapp' || tab === 'linkedin';
  const playbookScript = tdef.ch === stage.channel ? script(stage.activity, lead) : '';
  const body = get('body', playbookScript || (isMessage ? `Hi ${first},\n\n` : ''));
  const subject = get('subject', `${stage.activity} · ${lead.company}`);

  const send = () => {
    const short = (body || '').trim().slice(0, 180);
    const entry = {
      email: { channel: 'EM', title: 'Email sent · ' + subject, detail: short },
      whatsapp: { channel: 'WA', title: 'WhatsApp message sent', detail: short },
      linkedin: { channel: 'LI', title: 'LinkedIn message sent', detail: short },
      note: { channel: 'NT', title: 'Note', detail: short },
    }[tab as 'email' | 'whatsapp' | 'linkedin' | 'note'];
    if (!entry) return;
    if ((tab === 'note' || isMessage) && !short) return store.flash('Write something first.');
    store.pushLog(lead.id, { date: todayLabel(s.workspace.timezone), ...entry });
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(tab + '.'))));
    store.flash(entry.title + ' · added to history');
  };

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '14px 18px', background: 'var(--brand-tint)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span className="caps" style={{ color: 'var(--brand)' }}>
            Next best action · {stage.name}
          </span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{stage.activity}</span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
            Due {lead.stall >= 4 ? lead.stall + ' days ago' : 'today'} · {CHANNEL_LABELS[stage.channel] || stage.channel}
          </span>
        </div>
        {tab !== def && (
          <button type="button" className="btn-outline" style={{ padding: '8px 12px' }} onClick={() => setTab(def)}>
            Open {TABS.find((t) => t.k === def)?.label}
          </button>
        )}
        <button type="button" onClick={() => setObjectionsOpen((o) => !o)} style={{ border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12.5, padding: '8px 12px', borderRadius: 7 }}>
          Objection handling
        </button>
      </div>

      {objectionsOpen && (
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--divider)', background: 'var(--panel)' }}>
          {OBJECTIONS.map((o) => (
            <div key={o.q} style={{ borderLeft: '2px solid var(--brand)', paddingLeft: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{o.q}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 3 }}>{o.a}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 2, overflowX: 'auto', borderBottom: '1px solid var(--divider)', padding: '0 8px' }}>
        {TABS.map((t) => (
          <button
            key={t.k}
            type="button"
            className="composer-tab"
            onClick={() => setTab(t.k)}
            style={{ borderBottom: `2px solid ${t.k === tab ? '#14503C' : 'transparent'}`, fontWeight: t.k === tab ? 600 : 500, color: t.k === tab ? '#14503C' : '#475750' }}
          >
            {t.label}
            {t.ch === stage.channel && <span title="Next step in the playbook" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand)' }} />}
          </button>
        ))}
      </div>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isMessage && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-2)', flexWrap: 'wrap' }}>
              <span className="caps">To</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--bg-soft)', borderRadius: 20, padding: '4px 10px 4px 4px', color: 'var(--ink)' }}>
                <span className="avatar" style={{ width: 20, height: 20, fontSize: 9.5 }}>
                  {lead.initials || initialsOf(lead.contact)}
                </span>
                {lead.contact}
              </span>
              <span>{tab === 'email' ? lead.email : tab === 'whatsapp' ? lead.phone : 'LinkedIn'}</span>
            </div>
            {tab === 'email' && <input className="box-input" style={{ fontWeight: 500 }} placeholder="Subject" value={subject} onChange={setDraft('subject')} />}
            <textarea className="box-input" rows={6} placeholder={`Write your message to ${first}`} value={body} onChange={setDraft('body')} />
          </div>
        )}

        {tab === 'meeting' &&
          (lead.companyId ? (
            // A real meeting on the calendar (CD-130): with the deal, its company and primary contact.
            <MeetingForm key={meetingForm} variant="inline" seed={{ dealId: lead.id, companyId: lead.companyId, contactId: lead.contactId }} submitLabel="Schedule meeting" onDone={() => setMeetingForm((n) => n + 1)} />
          ) : (
            <div className="hint-box">Every meeting belongs to a customer company. Pick this deal's company in Summary first.</div>
          ))}

        {tab === 'note' && <textarea className="box-input" rows={5} placeholder="Write a note about this deal. Only your team sees it." value={body} onChange={setDraft('body')} style={{ background: 'var(--note)' }} />}


        {tab === 'docs' && <DealDocuments lead={lead} />}

        {tab !== 'docs' && tab !== 'meeting' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={send}>
              {SEND_LABEL[tab]}
            </button>
            {!!playbookScript && body === playbookScript && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Script from the {stage.name} stage</span>}
          </div>
        )}
      </div>
    </div>
  );
}
