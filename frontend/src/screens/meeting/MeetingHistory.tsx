import { useEffect, useRef, useState } from 'react';
import { ChangeHistory } from '../../components/ChangeHistory';
import type { ApiMeeting, ApiMinutesSend } from '../../lib/api';
import { curOf } from '../../store/selectors';
import { useStore } from '../../store/store';
import { SendStatus, sentLabel } from './ExternalMinutes';

/**
 * Who changed which field of the meeting (CD-69 history, entity "meeting"), its internal minutes
 * included (CD-132), and the send log of the external minutes (CD-133): every send with its time,
 * sender, recipients and their delivery, subject and the exact text sent.
 */
export function MeetingHistory({ meeting }: { meeting: ApiMeeting }) {
  const { s } = useStore();
  return (
    <>
      <SendLog meeting={meeting} />
      <ChangeHistory entity="meeting" id={meeting.id} cur={curOf(s)} rev={`${meeting.updatedAt}|${meeting.minutesUpdatedAt ?? ''}`} />
    </>
  );
}

function SendLog({ meeting }: { meeting: ApiMeeting }) {
  const { s, meetings } = useStore();
  const [sends, setSends] = useState<ApiMinutesSend[] | null>(null);
  const actions = useRef(meetings);
  actions.current = meetings;
  const [rev, setRev] = useState(0);
  // Read again when a delivery changed (sendsUpdatedAt) or after a retry from here.
  useEffect(() => {
    if (meeting.externalDelivery === 'not_sent') return setSends([]);
    let alive = true;
    actions.current.loadSends(meeting.id).then(
      (x) => alive && setSends(x),
      () => alive && setSends((x) => x ?? []),
    );
    return () => {
      alive = false;
    };
  }, [meeting.id, meeting.sendsUpdatedAt, meeting.externalDelivery, rev]);

  if (!sends?.length) return null;
  return (
    <div className="ext-log" data-testid="send-log" style={{ marginTop: 0, marginBottom: 20 }}>
      <div className="form-label">Minutes sent to the customer</div>
      {sends.map((x) => (
        <div key={x.id} className="ext-log-item" data-testid="send-log-item">
          <div>
            <strong>{sentLabel(x.createdAt, s.workspace.timezone)}</strong> · {x.senderName} <span className="meeting-muted">({x.senderEmail})</span>
          </div>
          <div>
            Subject: <span data-testid="send-log-subject">{x.subject}</span>
          </div>
          <SendStatus m={meeting} send={x} onRetried={() => setRev((n) => n + 1)} />
          <details>
            <summary>Show the text as sent</summary>
            <div className="ext-log-body" data-testid="send-log-body">
              {x.body}
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}
