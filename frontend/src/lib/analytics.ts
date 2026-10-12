/**
 * Product analytics with Amplitude (CD-116): Analytics with autocapture plus Session Replay, only in
 * builds with VITE_AMPLITUDE_API_KEY. The key is inlined at build time like the Sentry DSN, so a
 * missing variable is a loud no-op in the console rather than a silent one.
 */
import * as amplitude from '@amplitude/unified';

// Screens track through this module, not the package: importing the package from a lazily loaded
// screen made the bundler put the whole SDK in that screen's chunk and load it at startup anyway.
export { track } from '@amplitude/unified';

const KEY = import.meta.env.VITE_AMPLITUDE_API_KEY;

let started = false;

/** Initializes Amplitude once for the lifetime of the page. */
export function startAnalytics(): void {
  if (started) return;
  started = true;
  if (!KEY) {
    console.warn('Amplitude API key missing — analytics disabled');
    return;
  }
  void amplitude.initAll(KEY, { analytics: { autocapture: true }, sessionReplay: { sampleRate: 1 } });
}
