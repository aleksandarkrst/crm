/**
 * The Pultly mark: a control desk ("pult") with three rising bars, the last one lime. Same drawing
 * as the website's Logo (website/src/components/ds.tsx); the two apps share no code, so it's copied.
 */
export function Logo({ height = 30, onDark = false, wordmark = false }: { height?: number; onDark?: boolean; wordmark?: boolean }) {
  const panel = onDark ? '#FFFFFF' : '#0D241C';
  const bars = onDark ? '#0D241C' : '#FFFFFF';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: height * 0.32, color: panel }} aria-label="Pultly" role="img">
      <svg viewBox="0 0 64 48" height={height} width={(height * 64) / 48} fill="none" aria-hidden="true">
        <path d="M14 4h48L52 34H4z" fill={panel} />
        <path d="M20 28h5l2.7-8h-5z" fill={bars} />
        <path d="M28 28h5l4-12h-5z" fill={bars} />
        <path d="M36 28h5l5.3-16h-5z" fill="#C6F16A" />
        <rect x="4" y="39" width="36" height="5" rx="2.5" fill={panel} />
      </svg>
      {wordmark && (
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1, fontSize: height * 0.92 }}>pultly</span>
      )}
    </span>
  );
}
