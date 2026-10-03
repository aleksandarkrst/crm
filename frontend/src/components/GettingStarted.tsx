import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ApiOnboardingStep, ApiSampleKind } from '../lib/api';
import { paths } from '../lib/paths';
import { useStore } from '../store/store';

/** The workspace's activation steps (CD-115). */
const STEPS: Record<ApiOnboardingStep, { label: string; hint: string; to: string }> = {
  invite: { label: 'Invite your team', hint: 'Work on deals together', to: paths.settings('team') },
  records: { label: 'Add your first records', hint: 'A contact, a company, a product and a deal', to: paths.pipeline },
  template: { label: 'Set up a document template', hint: 'Proposals and quotes filled from a deal', to: paths.settings('templates') },
  funnel: { label: 'Set up your funnel', hint: 'Rename stages, set their to-dos', to: paths.settings('funnel') },
};
/** The parts of "Add your first records", each with the screen where it is added. */
const RECORDS: Record<ApiSampleKind, { label: string; to: string }> = {
  contact: { label: 'Contact', to: paths.contacts },
  company: { label: 'Company', to: paths.companies },
  product: { label: 'Product', to: paths.products },
  deal: { label: 'Deal', to: paths.pipeline },
};

/** The main screens show it; a deal, contact or settings page is left to the task at hand. */
const SHOWN_ON: string[] = [paths.overview, paths.pipeline, paths.today, paths.companies, paths.contacts, paths.products];

/**
 * Getting started (CD-68), for owners and admins of a new workspace: the four activation steps
 * (CD-115: team invited, first records, a document template, the funnel) that tick themselves from
 * the workspace's records, until they are all done or the user hides the list.
 * Sample data can be loaded to look around, and removed again in one click; while it is loaded,
 * a slim bar says so even after the checklist is gone.
 */
export function GettingStarted() {
  const { s, setOnboardingDismissed, loadSampleData, removeSampleData } = useStore();
  const [busy, setBusy] = useState(false);
  // On phones the steps fold away behind the progress line (CSS), so the screen stays in view.
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const ob = s.onboarding;
  if (!ob || !SHOWN_ON.includes(pathname)) return null;
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const sample = ob.sampleData.loaded;
  const sampleButton = sample ? (
    <button type="button" className="btn-outline" disabled={busy} onClick={run(removeSampleData)} data-testid="remove-sample-data">
      Remove sample data
    </button>
  ) : (
    <button type="button" className="btn-outline" disabled={busy} onClick={run(loadSampleData)} data-testid="load-sample-data">
      Load sample data
    </button>
  );

  if (ob.dismissed || ob.complete) {
    if (!sample) return null;
    return (
      <div className="sample-bar" role="status">
        <span>You are looking at sample data. Your own records stay when you remove it.</span>
        {sampleButton}
      </div>
    );
  }
  const doneCount = ob.steps.filter((x) => x.done).length;
  return (
    <section className={open ? 'getting-started open' : 'getting-started'} aria-label="Getting started" data-testid="getting-started">
      <div className="getting-started-head">
        <div>
          <strong>Get started with Pultly</strong>
          <span>
            {doneCount} of {ob.steps.length} done
            <button type="button" className="getting-started-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide steps' : 'Show steps'}
            </button>
          </span>
        </div>
        <div className="getting-started-actions">
          {sampleButton}
          <button type="button" className="getting-started-hide" disabled={busy} onClick={run(() => setOnboardingDismissed(true))}>
            Hide
          </button>
        </div>
      </div>
      <div className="getting-started-bar" aria-hidden="true">
        <span style={{ width: `${(doneCount / ob.steps.length) * 100}%` }} />
      </div>
      <ol className="getting-started-items">
        {ob.steps.map(({ key, done, items }) => {
          // "Add your first records" leads to the first one still missing.
          const next = items?.find((x) => !x.done);
          return (
            <li key={key} className={done ? 'done' : ''} data-step={key} data-done={done}>
              <Link to={next ? RECORDS[next.key].to : STEPS[key].to}>
                <span className="getting-started-check">{done ? '✓' : ''}</span>
                <span>
                  <span className="getting-started-label">{STEPS[key].label}</span>
                  <span className="getting-started-hint">{STEPS[key].hint}</span>
                  {items && !done && (
                    <span className="getting-started-parts">
                      {items.map((x) => (
                        <span key={x.key} className={x.done ? 'done' : ''} data-part={x.key} data-done={x.done}>
                          {x.done ? '✓ ' : ''}
                          {RECORDS[x.key].label}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      {!sample && <span className="getting-started-note">Want to look around first? Sample data adds a few companies, contacts and deals, and removes them again in one click.</span>}
    </section>
  );
}
