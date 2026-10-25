import type { CSSProperties, DragEvent, ReactNode } from 'react';
import type { BoardView } from '../store/useBoardView';

const VIEWS: { id: BoardView; label: string; icon: string }[] = [
  { id: 'board', label: 'Kanban', icon: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v7h-4z' },
  { id: 'table', label: 'Table', icon: 'M4 6h16M4 12h16M4 18h16' },
];

/** The Kanban / Table toggle of the Pipeline and Companies (test ids `${testId}-board`, `${testId}-table`). */
export function ViewToggle({ value, onChange, testId }: { value: BoardView; onChange: (v: BoardView) => void; testId: string }) {
  return (
    <div className="view-toggle" role="group" aria-label="View">
      {VIEWS.map((v) => (
        <button key={v.id} type="button" title={v.label} aria-label={v.label} aria-pressed={value === v.id} data-testid={`${testId}-${v.id}`} onClick={() => onChange(v.id)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d={v.icon} />
          </svg>
        </button>
      ))}
    </div>
  );
}

/** A card on a Kanban column (the Pipeline's card shell). */
export const BOARD_CARD: CSSProperties = { background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-tile)', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 8 };

/** The board around the columns: full height, scrolling sideways (snapping at phone width). */
export function Board({ children, tall, testId }: { children: ReactNode; tall: boolean; testId?: string }) {
  return (
    <div className="pipeline-board" data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '0 -30px -44px', padding: '0 30px', minHeight: 'calc(100vh - 118px)' }}>
      <div className="pipeline-columns" style={{ display: 'flex', gap: 14, overflowX: 'auto', alignItems: 'stretch', flex: 1, minHeight: tall ? 520 : 260 }}>
        {children}
      </div>
    </div>
  );
}

/**
 * One Kanban column with the Pipeline's chevron head (the first has no notch, the last no point);
 * `active` while a card is dragged over it.
 */
export function BoardColumn({
  name,
  sub,
  first,
  last,
  active,
  testId,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  name: string;
  sub: ReactNode;
  first: boolean;
  last: boolean;
  active: boolean;
  testId?: string;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} style={{ flex: '0 0 268px', width: 268, border: `1px solid ${active ? 'var(--brand)' : 'transparent'}`, borderRadius: '6px 6px 0 0', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          position: 'relative',
          width: last ? 268 : 282,
          background: active ? 'var(--brand-head)' : 'var(--board-column)',
          clipPath: first
            ? 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%)'
            : last
              ? 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 16px 50%)'
              : 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%, 16px 50%)',
          padding: first ? '12px 30px 12px 12px' : last ? '12px 12px 12px 26px' : '12px 30px 12px 26px',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          borderRadius: last ? '6px 6px 0 0' : '6px 0 0 0',
          height: 57,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{sub}</span>
        </div>
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, background: active ? 'var(--brand-soft)' : 'var(--board-column)' }}>{children}</div>
    </div>
  );
}
