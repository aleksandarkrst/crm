import { useState } from 'react';
import { useStore } from '../store/store';

/**
 * What an empty screen says in a new workspace (CD-68): what will be here, and the one action
 * that fills it. Owners and admins can also load sample data (see GettingStarted).
 */
export function EmptyState({ title, text, action, testId }: { title: string; text: string; action?: { label: string; onClick: () => void }; testId?: string }) {
  const { s, loadSampleData } = useStore();
  const [busy, setBusy] = useState(false);
  const canSample = s.onboarding && !s.onboarding.sampleData.loaded;
  return (
    <div className="empty-block" data-testid={testId ?? 'empty-state'}>
      <span className="empty-block-title">{title}</span>
      <span className="empty-block-text">{text}</span>
      <div className="empty-block-actions">
        {action && (
          <button type="button" className="btn btn-primary" onClick={action.onClick}>
            {action.label}
          </button>
        )}
        {canSample && (
          <button
            type="button"
            className="btn-outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void loadSampleData().finally(() => setBusy(false));
            }}
          >
            Or load sample data
          </button>
        )}
      </div>
    </div>
  );
}
