import { useEffect, useState } from 'react';
import { type DealDoc, docBusy } from '../store/documents';
import { estimatedProgress } from '../store/docProgress';

/** A progress bar with a percentage while a document is generated (CD-120); see estimatedProgress. */
export function DocProgress({ doc }: { doc: DealDoc }) {
  const [now, setNow] = useState(() => Date.now());
  const busy = docBusy(doc);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy]);
  if (!busy) return null;
  const pct = estimatedProgress(doc, now);
  return (
    <div data-testid="doc-progress" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div className="vp-progress-bar" role="progressbar" aria-label={`Generating ${doc.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ flex: 1 }}>
        <span style={{ width: `${pct}%`, transition: 'width .5s linear' }} />
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--text-2)', minWidth: 34, textAlign: 'right' }}>{pct} %</span>
    </div>
  );
}
