import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { type MeetingDialogSeed, meetingSeedOf } from '../store/meetings';
import { MeetingForm } from './meeting/MeetingForm';

/**
 * The New meeting page (CD-221, "More options" of the Calendar's quick create, and every "New
 * meeting" in the app): laid out like Google Calendar's event page. The URL holds the prefill
 * (paths.newMeeting); guests, location and agenda typed in the quick create come in the history
 * state. Close and Save go back where it was opened from; opened from a link, Save opens the new
 * meeting and close the Calendar.
 */
export function NewMeeting() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const seed = meetingSeedOf(params, (location.state as { meeting?: MeetingDialogSeed } | null)?.meeting);
  const back = (to: string) => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(to, { replace: true });
  };
  return (
    <Screen title="New meeting" parent={{ label: 'Calendar', to: paths.calendar() }}>
      <div className="card mf-card" data-testid="new-meeting">
        <MeetingForm key={location.key} variant="page" seed={seed} onClose={() => back(paths.calendar())} onDone={(m) => back(paths.meeting(m.id))} />
      </div>
    </Screen>
  );
}
