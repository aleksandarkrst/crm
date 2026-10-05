import type { ApiMeeting } from '../../lib/api';

/** The external minutes sent to the customer (CD-133 replaces this placeholder). */
export function ExternalMinutes({ meeting }: { meeting: ApiMeeting }) {
  return (
    <div className="empty-dashed" data-testid="external-minutes" data-meeting={meeting.id}>
      Coming in this milestone: minutes written for the customer and sent by email.
    </div>
  );
}
