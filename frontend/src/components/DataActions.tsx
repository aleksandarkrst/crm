import { useState } from 'react';
import { datedName, downloadText } from '../lib/csv';
import { ImportDialog } from '../modals/ImportDialog';
import { canImportExport, type ImportType } from '../store/importExport';
import { useStore } from '../store/store';

/**
 * "Import" and "Export" on the Companies, Contacts and Pipeline screens (CD-64, CD-65), for owners
 * and admins. `exportCsv` builds the file from the rows the screen shows (its filters applied).
 */
export function DataActions({ type, exportCsv, count }: { type: ImportType; exportCsv: () => string; count: number }) {
  const { session, flash } = useStore();
  const [importing, setImporting] = useState(false);
  if (!canImportExport(session.tenant.role)) return null;
  const doExport = () => {
    if (count === 0) {
      flash('Nothing to export: no rows match the filters');
      return;
    }
    downloadText(datedName(type), exportCsv());
    flash(`Exported ${count.toLocaleString('en-US')} ${count === 1 ? 'row' : 'rows'} to CSV`);
  };
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setImporting(true)}>
        Import
      </button>
      <button type="button" className="btn btn-secondary" title="Download the rows shown, as CSV" onClick={doExport}>
        Export
      </button>
      {importing && <ImportDialog initialType={type} onClose={() => setImporting(false)} />}
    </>
  );
}
