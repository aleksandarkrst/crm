import type { ApiMeeting } from '../../lib/api';

/** The internal minutes of a meeting (CD-132 replaces this placeholder). */
export function InternalMinutes({ meeting }: { meeting: ApiMeeting }) {
  return (
    <div className="empty-dashed" data-testid="internal-minutes" data-meeting={meeting.id}>
      Coming in this milestone: the summary, agreements and next steps your team keeps for this meeting.
    </div>
  );
}
