import { ChangeHistory } from '../../components/ChangeHistory';
import type { ApiMeeting } from '../../lib/api';
import { curOf } from '../../store/selectors';
import { useStore } from '../../store/store';

/** Who changed which field of the meeting (CD-69 history, entity "meeting"); CD-133 adds the send log. */
export function MeetingHistory({ meeting }: { meeting: ApiMeeting }) {
  const { s } = useStore();
  return <ChangeHistory entity="meeting" id={meeting.id} cur={curOf(s)} rev={meeting.updatedAt} />;
}
