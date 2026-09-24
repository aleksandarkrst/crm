import { useState } from 'react';
import { ImportDialog } from '../modals/ImportDialog';
import { canImportExport, type ImportType } from '../store/importExport';
import { useStore } from '../store/store';

/**
 * "Import" on the Companies, Contacts and Pipeline screens (CD-64), for owners and admins.
 */
export function DataActions({ type }: { type: ImportType }) {
  const { session } = useStore();
  const [importing, setImporting] = useState(false);
  if (!canImportExport(session.tenant.role)) return null;
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setImporting(true)}>
        Import
      </button>
      {importing && <ImportDialog initialType={type} onClose={() => setImporting(false)} />}
    </>
  );
}
