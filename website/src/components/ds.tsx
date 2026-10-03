// The Pultly design system pieces the site uses (Claude Design "Pultly" design system, components/*),
// ported to typed React. Their look comes from the classes in styles/site.css.
import type { AnchorHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { ICON_PATHS, type IconName } from './icons';

/**
 * The Pultly logo (CD-203): a lowercase p whose bowl is a dial, with the reading in lime, on a
 * rounded forest tile, and the "pultly" wordmark as outlines. On dark surfaces the tile turns
 * brand green. Same drawing as frontend/src/components/Logo.tsx.
 */
export function Logo({ height = 30, onDark = false, wordmark = true }: { height?: number; onDark?: boolean; wordmark?: boolean }) {
  const width = wordmark ? 171.3 : 48;
  return (
    <svg className="logo" viewBox={`0 0 ${width} 48`} height={height} width={(height * width) / 48} fill="none" role="img" aria-label="pultly">
      <rect width="48" height="48" rx="12" fill={onDark ? '#14503C' : '#0D241C'} />
      <path d="M15 13.5v22" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
      <circle cx="25" cy="20.5" r="8" stroke="#FFFFFF" strokeWidth="6" />
      <path d="M25 12.5a8 8 0 0 1 8 8" stroke="#C6F16A" strokeWidth="6" />
      {wordmark && <path transform="translate(57.96 34.03) scale(0.34)" fill={onDark ? '#FFFFFF' : '#0D241C'} d={WORDMARK} />}
    </svg>
  );
}

/** "pultly" set in Unbounded SemiBold at -0.04em. */
const WORDMARK =
  'M6 16.5L6-57L24.5-57L24.5-45Q28.6-51.3 34.8-54.9Q41.2-58.6 49.1-58.6Q57.5-58.6 63.9-54.8Q70.2-51 73.8-44.2Q77.4-37.5 77.4-28.5Q77.4-19.5 73.8-12.7Q70.2-6 63.9-2.2Q57.5 1.6 49.1 1.6Q41.1 1.6 34.8-2.2Q28.6-5.8 24.5-12.2L24.5 16.5L6 16.5M58.6-28.5Q58.6-33.1 56.7-36.6Q54.8-40.2 51.5-42.2Q48.1-44.3 43.8-44.3Q39.4-44.3 35.4-42.2Q31.4-40.2 28.5-36.6Q25.5-33.1 23.9-28.5Q25.5-23.9 28.5-20.4Q31.4-16.8 35.4-14.7Q39.4-12.7 43.8-12.7Q48.1-12.7 51.5-14.7Q54.8-16.8 56.7-20.4Q58.6-23.9 58.6-28.5M107.1 1.5Q99.1 1.5 93.5-1.7Q87.9-5 85-11Q82-17 82-25.2L82-57L100.6-57L100.6-27.9Q100.6-21 103.9-17.3Q107.2-13.6 113.4-13.6Q118-13.6 121.2-15.5Q124.4-17.4 126.2-21Q127.9-24.6 127.9-29.5L127.9-57L146.5-57L146.5-19.4L150.1 0L131.5 0L129.5-12.2Q129.2-11.6 129-11.2Q125.2-4.9 119.5-1.7Q113.9 1.5 107.1 1.5M155.4 0L155.4-77L173.9-77L173.9 0M188.2-43.2L176.4-43.2L176.4-51.3L188.2-55.6L196.2-72.2L206.8-72.2L206.8-57L231.4-57L231.4-43.2L206.8-43.2L206.8-24.4Q206.8-18 209.4-15.5Q212-12.9 218.7-12.9Q223-12.9 226.2-13.7Q229.5-14.4 232.4-15.7L232.4-1.6Q229.4-0.4 224.5 0.6Q219.7 1.6 214.5 1.6Q205.4 1.6 199.5-1.3Q193.7-4.2 190.9-9.5Q188.2-14.7 188.2-21.8M237 0L237-77L255.5-77L255.5 0M280.9 18.1Q274.9 18.1 270.3 16.6Q265.6 15.1 261.2 12.1L261.2-1Q265.7 1.9 269.6 3.2Q273.6 4.4 278.3 4.4Q282.5 4.4 285.6 2.6Q288.8 0.8 290.9-4L291.1-4.5L283.1-4.5L258.4-57L278.8-57L296.1-16.1L313.7-57L333.4-57L305.5 1.8Q302.7 7.8 298.8 11.4Q294.9 15 290.4 16.6Q285.8 18.1 280.9 18.1';

export function Icon({ name, size = 16, color }: { name: IconName; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'primary' | 'secondary' };

/** A link that looks like Button, for actions that leave the site (sign in, sign up). */
export function ButtonLink({ variant = 'primary', className, ...rest }: ButtonLinkProps) {
  return <a className={`btn btn-${variant}${className ? ' ' + className : ''}`} {...rest} />;
}

export function ChoicePill({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" className={on ? 'choice-pill on' : 'choice-pill'} aria-pressed={on} onClick={onClick}>{children}</button>;
}

export function Avatar({ initials, size = 26, square = false }: { initials: string; size?: number; square?: boolean }) {
  const style: CSSProperties = { width: size, height: size, fontSize: 10, flex: `0 0 ${size}px` };
  if (square) Object.assign(style, { borderRadius: 6, background: 'var(--segment)', color: 'var(--text-2)' });
  return <span className="avatar" style={style}>{initials}</span>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'brand' | 'warn' | 'danger'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function FitScore({ score }: { score: number }) {
  const bg = score >= 80 ? '#E7F2EE' : score >= 65 ? '#FDF0E4' : '#F2F5F3';
  const fg = score >= 80 ? '#14503C' : score >= 65 ? '#B4531B' : '#475750';
  return <span style={{ fontSize: 10, padding: '3px 5px', borderRadius: 4, background: bg, color: fg, whiteSpace: 'nowrap' }}>fit {score}</span>;
}

/** Funnel stages as chevrons; on the site it only illustrates, so the stages aren't clickable. */
export function StageBar({ stages, current }: { stages: string[]; current: number }) {
  return (
    <div className="stage-bar">
      {stages.map((s, i) => (
        <span key={s} className={'stage-chev' + (i === current ? ' current' : i < current ? ' done' : '')}>{s}</span>
      ))}
    </div>
  );
}

export function TaskCheck({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button type="button" className={done ? 'task-check done' : 'task-check'} aria-pressed={done} aria-label={done ? 'Reopen' : 'Mark done'} onClick={onClick}>
      {done ? '✓' : ''}
    </button>
  );
}
