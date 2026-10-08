import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '../../lib/paths';
import type { ApiProject } from '../../lib/projectsApi';
import { leadById, timelineFor, todayLabel } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { LogEntry } from '../../store/types';

/** The logged emails of a deal, newest first ("Email sent · <subject>" entries on its timeline). */
export const dealEmails = (log: LogEntry[]) => log.filter((e) => e.channel === 'EM');
const subjectOf = (e: LogEntry) => e.title.replace(/^Email sent · /, '') || e.title;

/**
 * The Communication tab (CD-271, design v2 §2): the emails logged on the project's deal (the CRM
 * composer's "Send & log" entries), newest first, and "New email", which logs one there the same
 * way, to the deal's contact. Without a deal there is nothing to show yet. Emails come from the
 * deal's timeline until a mail integration exists (Later: Integrations).
 */
export function ProjectCommunication({ project }: { project: ApiProject }) {
  const store = useStore();
  const { s, ensureLog } = store;
  const deal = project.dealId ? leadById(s, project.dealId) : undefined;
  useEffect(() => {
    if (project.dealId) ensureLog([project.dealId]);
  }, [project.dealId, ensureLog]);
  const emails = deal ? dealEmails(timelineFor(s, deal.id)) : [];
  const [selected, setSelected] = useState(0);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  if (!deal) {
    return (
      <div className="hint-box" data-testid="project-comms-empty">
        Emails come from the project's deal. Link a deal in the Linked card to see its emails here.
      </div>
    );
  }

  const current = composing ? null : emails[Math.min(selected, emails.length - 1)];
  const to = deal.contact && deal.contact !== 'No primary contact' ? `${deal.contact}${deal.email ? ` · ${deal.email}` : ''}` : 'the deal’s contact';
  const send = () => {
    const text = body.trim();
    if (!subject.trim() || !text) return store.flash('Write a subject and a message first.');
    store.pushLog(deal.id, { date: todayLabel(s.workspace.timezone), channel: 'EM', title: 'Email sent · ' + subject.trim(), detail: text.slice(0, 180) });
    store.flash('Email logged on the deal');
    setSubject('');
    setBody('');
    setComposing(false);
    setSelected(0);
  };

  return (
    <div className="comms" data-testid="project-comms">
      <div className="comms-list">
        <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
          <button type="button" className="btn-outline" data-testid="new-email" onClick={() => setComposing(true)} style={{ width: '100%' }}>
            New email
          </button>
        </div>
        {emails.map((e, i) => (
          <button
            key={i}
            type="button"
            className={'comms-item' + (!composing && i === selected ? ' on' : '')}
            data-testid="email-thread"
            onClick={() => {
              setComposing(false);
              setSelected(i);
            }}
          >
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span className="pt-main" style={{ fontSize: 13, fontWeight: 600 }}>
                {subjectOf(e)}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{e.date}</span>
            </span>
            <span className="pt-sub">{e.detail}</span>
          </button>
        ))}
        {emails.length === 0 && <span style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-2)' }}>No emails on the deal yet.</span>}
      </div>
      <div className="comms-thread">
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{composing ? 'New email' : current ? subjectOf(current) : 'No conversations yet'}</span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
            From the deal{' '}
            <Link to={paths.lead(deal.id)} className="crumb-link">
              {deal.title || deal.company}
            </Link>
          </span>
        </div>
        <div style={{ flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {composing ? (
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>The email is logged on the deal&apos;s timeline when you send it.</span>
          ) : current ? (
            <div className="comms-message">
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{current.date}</span>
              <span style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{current.detail}</span>
            </div>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Start a conversation with New email.</span>
          )}
        </div>
        {composing && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="box-input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="email-subject" />
            <textarea className="box-input" rows={5} placeholder="Write your email" value={body} onChange={(e) => setBody(e.target.value)} data-testid="email-body" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>To {to}</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setComposing(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" data-testid="send-email" onClick={send}>
                  Send & log
                </button>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
