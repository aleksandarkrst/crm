// The Pultly design system pieces the site uses (Claude Design "Pultly" design system, components/*),
// ported to typed React. Their look comes from the classes in styles/site.css.
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import { ICON_PATHS, type IconName } from './icons';

/** The control-desk mark, with the "pultly" wordmark when it is tall enough to read. */
export function Logo({ height = 30, onDark = false, wordmark = true }: { height?: number; onDark?: boolean; wordmark?: boolean }) {
  const panel = onDark ? '#FFFFFF' : '#0D241C';
  const bars = onDark ? '#0D241C' : '#FFFFFF';
  const showWord = wordmark && height * 3.1 >= 88;
  return (
    <span className="logo" style={{ gap: height * 0.32, color: panel }} aria-label="pultly">
      <svg viewBox="0 0 64 48" height={height} width={(height * 64) / 48} fill="none" aria-hidden="true">
        <path d="M14 4h48L52 34H4z" fill={panel} />
        <path d="M20 28h5l2.7-8h-5z" fill={bars} />
        <path d="M28 28h5l4-12h-5z" fill={bars} />
        <path d="M36 28h5l5.3-16h-5z" fill="#C6F16A" />
        <rect x="4" y="39" width="36" height="5" rx="2.5" fill={panel} />
      </svg>
      {showWord && <span className="logo-word" style={{ fontSize: height * 0.92 }}>pultly</span>}
    </span>
  );
}

export function Icon({ name, size = 16, color }: { name: IconName; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' };

export function Button({ variant = 'primary', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={`btn btn-${variant}${className ? ' ' + className : ''}`} {...rest} />;
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

export function FormField({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="form-label">
      {label}
      <input className="form-input" {...input} />
    </label>
  );
}
