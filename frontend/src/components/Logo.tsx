/**
 * The Pultly logo from the Pultly Brand Guide (01 · Logo): a slanted pult with three rising bars,
 * the last one always lime. On light grounds the pult is ink with white bars; on dark grounds it
 * is white with forest bars. The wordmark is Unbounded 600, lowercase, −0.04em; below 88 px wide
 * the guide wants the mark alone.
 */
export function Logo({ height = 30, onDark = false, wordmark = false }: { height?: number; onDark?: boolean; wordmark?: boolean }) {
  const pult = onDark ? '#FFFFFF' : '#0F1B16';
  const bars = onDark ? '#0D241C' : '#FFFFFF';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: height * 0.21, color: pult }} aria-label="Pultly" role="img">
      <svg viewBox="0 0 64 64" width={height} height={height} fill="none" aria-hidden="true" style={{ flex: '0 0 auto' }}>
        <path d="M6 46L18 16H58L46 46Z" fill={pult} stroke={pult} strokeWidth="2" strokeLinejoin="round" />
        <path d="M22 38L24.4 32" stroke={bars} strokeWidth="4" strokeLinecap="round" />
        <path d="M30 38L33.6 29" stroke={bars} strokeWidth="4" strokeLinecap="round" />
        <path d="M38 38L43.2 25" stroke="#C6F16A" strokeWidth="4" strokeLinecap="round" />
        <path d="M10 54H44" stroke={pult} strokeWidth="4" strokeLinecap="round" />
      </svg>
      {wordmark && (
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1, fontSize: height * 0.63 }}>pultly</span>
      )}
    </span>
  );
}
