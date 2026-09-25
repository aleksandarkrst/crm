import { useEffect, useRef, useState } from 'react';
import { datedName, downloadText } from '../lib/csv';
import { ImportDialog } from '../modals/ImportDialog';
import { canImportExport, type ImportType } from '../store/importExport';
import { useStore } from '../store/store';

/**
 * The "⋯" menu of the Pipeline, Companies, Contacts and Products screens (CD-81), for owners and
 * admins: "Export filter results" downloads the rows the screen shows (its filters applied) as CSV
 * (CD-65), "Import data" opens the CSV import for this kind of record (CD-64).
 */
export function DataActions({ type, exportCsv, count }: { type: ImportType; exportCsv: () => string; count: number }) {
  const { session, flash } = useStore();
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!canImportExport(session.tenant.role)) return null;

  const doExport = () => {
    setOpen(false);
    if (count === 0) {
      flash('Nothing to export: no rows match the filters');
      return;
    }
    downloadText(datedName(type), exportCsv());
    flash(`Exported ${count.toLocaleString('en-US')} ${count === 1 ? 'row' : 'rows'} to CSV`);
  };
  return (
    <div ref={ref} className="new-menu">
      <button type="button" className="btn btn-secondary" data-testid="data-menu" aria-label="More actions" title="Import and export" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} style={{ padding: '9px 13px' }}>
        ⋯
      </button>
      {open && (
        <div className="menu-pop" role="menu" style={{ right: 0, width: 240 }}>
          <button type="button" role="menuitem" className="menu-item" onClick={doExport} title="Download the rows shown, as CSV">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--text-2)' }}>
              <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v4h14v-4" />
            </svg>
            <span className="menu-item-title">Export filter results</span>
            <span className="menu-item-sub">{count.toLocaleString('en-US')}</span>
          </button>
          <div className="menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              setImporting(true);
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--text-2)' }}>
              <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 15v4h14v-4" />
            </svg>
            <span className="menu-item-title">Import data</span>
          </button>
        </div>
      )}
      {importing && <ImportDialog initialType={type} onClose={() => setImporting(false)} />}
    </div>
  );
}
