import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { paths } from '../lib/paths';
import { meetingSeedParams } from '../store/meetings';
import { useStore } from '../store/store';

/**
 * `meetings.openDialog(seed)` from anywhere (Calendar, company and contact cards, visit plans, the
 * command palette) opens the New meeting page (CD-221), prefilled with the seed; a seed with an
 * `id` opens that meeting's page, where it is edited in place.
 */
export function MeetingDialog() {
  const { s, meetings } = useStore();
  const navigate = useNavigate();
  const seed = s.meetingDialog;
  useEffect(() => {
    if (!seed) return;
    meetings.closeDialog();
    if (seed.id) navigate(paths.meeting(seed.id));
    else navigate(paths.newMeeting(meetingSeedParams(seed)), { state: { meeting: seed } });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per seed
  }, [seed]);
  return null;
}
