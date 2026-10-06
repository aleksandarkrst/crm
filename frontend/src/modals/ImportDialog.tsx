import { useState } from 'react';
import { Modal, ModalHeader } from '../components/ui';
import { ApiError } from '../lib/api';
import { downloadBlob, downloadText } from '../lib/csv';
import type { SheetRows } from '../lib/spreadsheet';
import {
  currentFunnelId,
  type DuplicateMode,
  failuresCsv,
  funnelOptions,
  importApi,
  type ImportPreview,
  type ImportResult,
  type ImportType,
  type Mapping,
  MAX_IMPORT_BYTES,
  type RowStatus,
} from '../store/importExport';
import { useStore } from '../store/store';

const TYPES: { key: ImportType; label: string; sub: string }[] = [
  { key: 'companies', label: 'Companies', sub: 'Duplicates are matched by name' },
  { key: 'contacts', label: 'Contacts', sub: 'Duplicates are matched by email' },
  { key: 'deals', label: 'Deals', sub: 'Matched to companies, funnels, stages and owners' },
  { key: 'products', label: 'Products', sub: 'Duplicates are matched by name' },
];
const STEPS = ['File', 'Columns', 'Preview', 'Done'] as const;
type Step = (typeof STEPS)[number];

const STATUS: Record<RowStatus, { label: string; cls: string }> = {
  create: { label: 'New', cls: 'badge badge-brand' },
  update: { label: 'Update', cls: 'badge badge-warn' },
  skip: { label: 'Skip', cls: 'badge badge-neutral' },
  invalid: { label: 'Error', cls: 'badge badge-danger' },
};

const DUPLICATE_LABEL: Record<ImportType, string> = {
  companies: 'Same name as an existing company',
  contacts: 'Same email as an existing contact',
  deals: '',
  products: 'Same name as an existing product',
  employees: 'Same work email as an existing employee',
};

/** The API's message, plus the first field problem when validation failed. */
const errText = (err: unknown) => {
  const issue = err instanceof ApiError ? (err.body as { issues?: { path?: string; message?: string }[] } | null)?.issues?.[0] : undefined;
  const msg = err instanceof Error ? err.message : String(err);
  return issue?.message ? `${msg}: ${issue.path ? issue.path + ' ' : ''}${issue.message}` : msg;
};
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const isExcel = (name: string) => /\.xlsx?$/i.test(name);

/**
 * CSV import (CD-64): pick the type and a file, map columns to fields (guessed from the headers),
 * preview the rows with their errors and duplicates, import, then a summary with the failed rows
 * as a download. The server parses and validates; this dialog only shows what it says.
 *
 * Employees (CD-141) use the same steps from the Org structure page: an Excel workbook (.xlsx) is
 * read in the browser (lib/spreadsheet, loaded only then), the chosen sheet becomes CSV text for the
 * same API; the preview also lists new departments and teams and offers (Admins) to invite the new
 * employees. `onImported` lets the page re-read its lists (CRM types reload the workspace).
 */
export function ImportDialog({ initialType, onClose, onImported }: { initialType: ImportType; onClose: () => void; onImported?: () => void }) {
  const { s, reload } = useStore();
  const funnels = funnelOptions(s);
  const [step, setStep] = useState<Step>('File');
  const [type, setType] = useState<ImportType>(initialType);
  const employees = type === 'employees';
  const [funnelId, setFunnelId] = useState(() => currentFunnelId(s) ?? '');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<SheetRows[] | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [csv, setCsv] = useState('');
  const [mapping, setMapping] = useState<Mapping>({});
  const [duplicates, setDuplicates] = useState<DuplicateMode>('skip');
  const [invite, setInvite] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const request = (over: { mapping?: Mapping; duplicates?: DuplicateMode; csv?: string } = {}) => ({
    csv: over.csv ?? csv,
    mapping: over.mapping,
    duplicates: over.duplicates ?? duplicates,
    funnelId: type === 'deals' && funnelId ? funnelId : undefined,
    invite: employees ? invite : undefined,
  });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  /** Sends the file's text for the first preview, which guesses the mapping from the header names. */
  const start = async (text: string) => {
    if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new Error(`The data is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
    setCsv(text);
    const p = await importApi.preview(type, request({ csv: text }));
    setPreview(p);
    setMapping(p.mapping);
    setStep('Columns');
  };
  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setSheets(null);
    if (employees && isExcel(file.name)) {
      void run(async () => {
        const xl = await import('../lib/spreadsheet');
        const book = await xl.readWorkbook(file);
        if (!book.some(xl.hasData)) throw new Error('No sheet of this workbook has a header row and data.');
        setSheets(book);
        setSheetIndex(0);
        // With several sheets, ask which one (default: the first); otherwise go straight on.
        if (book.length === 1) await start(xl.sheetToCsv(book[0]!));
      });
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
      return;
    }
    void run(async () => start(await file.text()));
  };
  const chooseSheet = () =>
    run(async () => {
      const xl = await import('../lib/spreadsheet');
      await start(xl.sheetToCsv(sheets![sheetIndex]!));
    });
  const showPreview = (over: { mapping?: Mapping; duplicates?: DuplicateMode } = {}) =>
    run(async () => {
      const p = await importApi.preview(type, request({ mapping: over.mapping ?? mapping, duplicates: over.duplicates }));
      setPreview(p);
      setStep('Preview');
    });
  const commit = () =>
    run(async () => {
      const r = await importApi.commit(type, request({ mapping }));
      setResult(r);
      setStep('Done');
      if (onImported) onImported();
      else await reload();
    });
  const downloadTemplate = () => run(async () => downloadText(`pultly-${type}-template.csv`, await importApi.template(type)));
  const downloadExcelTemplate = () =>
    run(async () => {
      const [text, xl] = await Promise.all([importApi.template(type), import('../lib/spreadsheet')]);
      downloadBlob(`pultly-${type}-template.xlsx`, await xl.xlsxTemplate(text));
    });
  const restart = () => {
    setStep('File');
    setCsv('');
    setFileName('');
    setSheets(null);
    setPreview(null);
    setResult(null);
    setError('');
  };

  const fields = preview?.fields ?? [];
  const isMapped = (key: string | undefined) => !!key && (mapping[key] ?? null) !== null;
  const missing = fields.filter((f) => f.required && !isMapped(f.key) && !isMapped(f.alternative)).map((f) => f.label);
  const shownFields = fields.filter((f) => isMapped(f.key)).slice(0, 4);
  const sheetName = sheets && sheets.length > 1 ? sheets[sheetIndex]?.name : undefined;
  const title = employees ? 'Import employees' : `Import ${TYPES.find((t) => t.key === type)!.label.toLowerCase()}`;
  const sub = employees
    ? 'Upload an Excel workbook (.xlsx) or a CSV with a header row. Nothing is saved until you import.'
    : 'Upload a CSV (UTF-8, comma or semicolon separated, with a header row). Nothing is saved until you import.';

  return (
    <Modal maxWidth={760} gap={18}>
      <ModalHeader title={title} sub={sub} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} aria-label="Import steps">
        {STEPS.map((x, i) => (
          <span key={x} className={x === step ? 'badge badge-brand' : 'badge badge-neutral'}>
            {i + 1}. {x}
          </span>
        ))}
      </div>

      {step === 'File' && (
        <>
          {!employees && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9 }}>
              {TYPES.map((t) => (
                <button key={t.key} type="button" className={t.key === type ? 'choice on' : 'choice'} onClick={() => setType(t.key)}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>{t.sub}</span>
                </button>
              ))}
            </div>
          )}
          {type === 'deals' && (
            <label className="form-label" style={{ maxWidth: 360 }}>
              Funnel
              <select className="form-input" value={funnelId} onChange={(e) => setFunnelId(e.target.value)}>
                {funnels.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="form-label">
            {employees ? 'Excel or CSV file' : 'CSV file'}
            <input
              className="form-input"
              type="file"
              accept={employees ? '.xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '.csv,text/csv,text/plain'}
              disabled={busy}
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </label>
          {sheets && sheets.length > 1 && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label className="form-label" style={{ flex: '1 1 220px' }}>
                Sheet
                <select className="form-input" data-testid="import-sheet" value={sheetIndex} onChange={(e) => setSheetIndex(Number(e.target.value))}>
                  {sheets.map((sh, i) => (
                    <option key={sh.name + i} value={i}>
                      {sh.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void chooseSheet()}>
                {busy ? 'Reading…' : 'Use this sheet'}
              </button>
            </div>
          )}
          <div className="hint-box">
            {employees ? 'Up to 5,000 rows; 5 MB for an Excel file, 2 MB for a CSV. ' : 'Up to 5,000 rows and 2 MB per file. '}
            {type === 'deals' ? 'Rows without a funnel or stage go to the funnel above, in its first stage; companies are matched by name and created if new. ' : ''}
            {employees ? 'Departments and teams are matched by name and created if new; managers by their work email, also when they come later in the file. ' : ''}
            Not sure about the columns?{' '}
            {employees ? (
              <>
                Download the template:{' '}
                <button type="button" className="btn-plain" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => void downloadExcelTemplate()}>
                  Excel (.xlsx)
                </button>{' '}
                <button type="button" className="btn-plain" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => void downloadTemplate()}>
                  CSV
                </button>
              </>
            ) : (
              <button type="button" className="btn-plain" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => void downloadTemplate()}>
                Download the {type} template
              </button>
            )}
          </div>
        </>
      )}

      {step === 'Columns' && preview && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {fileName}
            {sheetName ? ` · sheet “${sheetName}”` : ''} · {plural(preview.counts.rows, 'row')}
            {isExcel(fileName) ? '' : ` · ${preview.delimiter === ';' ? 'semicolon' : 'comma'} separated`}. We matched the columns we recognised; check them below.
          </div>
          <div className="import-fields">
            {fields.map((f) => (
              <label key={f.key} className="form-label" title={f.hint}>
                {f.label}
                {f.required ? (f.alternative ? ` * (or ${fields.find((x) => x.key === f.alternative)?.label ?? f.alternative})` : ' *') : ''}
                <select
                  className="form-input"
                  data-field={f.key}
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                >
                  <option value="">— Don't import —</option>
                  {preview.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
                {f.hint && <span style={{ fontSize: 11, fontWeight: 400, letterSpacing: 0, textTransform: 'none', color: 'var(--muted)' }}>{f.hint}</span>}
              </label>
            ))}
          </div>
          {missing.length > 0 && <div className="hint-box">Choose a column for {missing.join(' and ')}.</div>}
        </>
      )}

      {step === 'Preview' && preview && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} data-testid="import-counts">
            <span className="badge badge-neutral">{plural(preview.counts.rows, 'row')}</span>
            <span className="badge badge-brand">{preview.counts.create} new</span>
            {preview.counts.update > 0 && <span className="badge badge-warn">{preview.counts.update} to update</span>}
            {preview.counts.skip > 0 && <span className="badge badge-neutral">{preview.counts.skip} to skip</span>}
            {preview.counts.invalid > 0 && <span className="badge badge-danger">{plural(preview.counts.invalid, 'row')} with errors</span>}
            {!!preview.counts.warnings && <span className="badge badge-warn">{plural(preview.counts.warnings, 'row')} with warnings</span>}
            {!!preview.counts.newCompanies && <span className="badge badge-neutral">{plural(preview.counts.newCompanies, 'new company', 'new companies')}</span>}
            {!!preview.counts.newContacts && <span className="badge badge-neutral">{plural(preview.counts.newContacts, 'new contact')}</span>}
            {!!preview.counts.newDepartments && <span className="badge badge-neutral">{plural(preview.counts.newDepartments, 'new department')}</span>}
            {!!preview.counts.newTeams && <span className="badge badge-neutral">{plural(preview.counts.newTeams, 'new team')}</span>}
          </div>
          {(!!preview.newDepartments?.length || !!preview.newTeams?.length) && (
            <div className="hint-box" data-testid="import-new-org">
              {!!preview.newDepartments?.length && <div>New departments: {preview.newDepartments.join(', ')}</div>}
              {!!preview.newTeams?.length && <div>New teams: {preview.newTeams.join(', ')}</div>}
            </div>
          )}
          {/* Only when some row matches an existing record (CD-224): otherwise there is nothing to skip or update. */}
          {type !== 'deals' && preview.counts.update + preview.counts.skip > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} data-testid="import-duplicates">
              <span className="caps">{DUPLICATE_LABEL[type]}</span>
              {(['skip', 'update'] as DuplicateMode[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={d === duplicates ? 'choice-pill on' : 'choice-pill'}
                  disabled={busy}
                  onClick={() => {
                    setDuplicates(d);
                    void showPreview({ duplicates: d });
                  }}
                >
                  {d === 'skip' ? 'Skip it' : 'Update it'}
                </button>
              ))}
            </div>
          )}
          {employees && preview.canInvite && (
            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" data-testid="import-invite" checked={invite} onChange={(e) => setInvite(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                Invite imported employees to Pultly
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)' }}>
                  {preview.counts.invitations
                    ? `${plural(preview.counts.invitations, 'new employee')} with a work email will get an invitation as Member.`
                    : 'No new employee in this file has a work email to invite.'}
                </span>
              </span>
            </label>
          )}
          {preview.warnings.map((w) => (
            <div key={w} className="hint-box">
              {w}
            </div>
          ))}
          <div className="card" style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 620 }}>
              <div className="table-head" style={{ gridTemplateColumns: `50px 70px repeat(${shownFields.length}, 1fr) 1.6fr` }}>
                <span className="th">Line</span>
                <span className="th">Status</span>
                {shownFields.map((f) => (
                  <span key={f.key} className="th">
                    {f.label}
                  </span>
                ))}
                <span className="th">Notes</span>
              </div>
              {preview.rows.map((r) => (
                <div key={r.line} className="table-row" data-status={r.status} style={{ gridTemplateColumns: `50px 70px repeat(${shownFields.length}, 1fr) 1.6fr`, padding: '9px 16px', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--muted)' }}>{r.line}</span>
                  <span className={STATUS[r.status].cls} style={{ justifySelf: 'start' }}>
                    {STATUS[r.status].label}
                  </span>
                  {shownFields.map((f) => (
                    <span key={f.key} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.values[f.key]}
                    </span>
                  ))}
                  <span style={{ lineHeight: 1.4 }}>
                    <span style={{ color: r.status === 'invalid' ? 'var(--danger)' : 'var(--text-2)' }}>{[...r.messages, ...r.notes].join(' · ')}</span>
                    {!!r.warnings?.length && <span style={{ display: 'block', color: 'var(--warn)' }}>{r.warnings.join(' · ')}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {preview.counts.rows > preview.rows.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Showing the first {preview.rows.length} rows; the counts cover all {preview.counts.rows.toLocaleString('en-US')}.</div>}
          {preview.problems.some((p) => !preview.rows.some((r) => r.line === p.line)) && (
            <div className="hint-box">
              Other rows with errors:{' '}
              {preview.problems
                .filter((p) => !preview.rows.some((r) => r.line === p.line))
                .slice(0, 10)
                .map((p) => `line ${p.line}: ${p.messages.join('; ')}`)
                .join(' · ')}
              {preview.counts.invalid > 10 ? ' …' : ''}
            </div>
          )}
          {preview.counts.invalid > 0 && <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Rows with errors are left out; you can download them after the import.</div>}
        </>
      )}

      {step === 'Done' && result && (
        <>
          <div className="import-summary" data-testid="import-summary">
            {(
              [
                ['Created', result.created],
                ['Updated', result.updated],
                ['Skipped', result.skipped],
                ['Failed', result.failed],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="card card-pad" style={{ padding: 14 }}>
                <div className="caps">{label}</div>
                <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4, color: label === 'Failed' && n > 0 ? 'var(--danger)' : 'var(--ink)' }}>{n.toLocaleString('en-US')}</div>
              </div>
            ))}
          </div>
          {(!!result.newCompanies || !!result.newContacts) && (
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              Also created {[result.newCompanies ? plural(result.newCompanies, 'company', 'companies') : '', result.newContacts ? plural(result.newContacts, 'contact') : ''].filter(Boolean).join(' and ')} for the rows.
            </div>
          )}
          {(!!result.newDepartments?.length || !!result.newTeams?.length) && (
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }} data-testid="import-new-org">
              {!!result.newDepartments?.length && <div>New departments: {result.newDepartments.join(', ')}</div>}
              {!!result.newTeams?.length && <div>New teams: {result.newTeams.join(', ')}</div>}
            </div>
          )}
          {!!result.invitationsQueued && <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{plural(result.invitationsQueued, 'invitation')} queued; they are sent in the background.</div>}
          {!!result.withoutManager?.length && (
            <div className="hint-box" data-testid="import-without-manager">
              {result.withoutManager.slice(0, 10).map((w) => (
                <div key={w.line}>
                  Line {w.line}: {w.reason}
                </div>
              ))}
              {result.withoutManager.length > 10 ? <div>…and {result.withoutManager.length - 10} more</div> : null}
            </div>
          )}
          {result.failed > 0 && (
            <div className="hint-box" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span>
                {plural(result.failed, 'row')} failed, e.g. line {result.failures[0]!.line}: {result.failures[0]!.reason}
              </span>
              <button type="button" className="btn-plain" onClick={() => downloadText(`pultly-${type}-import-failed.csv`, failuresCsv(result))}>
                Download failed rows
              </button>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="hint-box" role="alert" style={{ color: 'var(--danger)', background: 'var(--danger-soft)' }}>
          {error}
        </div>
      )}

      <div className="modal-actions">
        {step === 'Done' ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={restart}>
              Import another file
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="import-cancel"
              onClick={() => {
                // After the file was read, its columns are mapped: ask before throwing that away (CD-224).
                if (step !== 'File' && !window.confirm('Discard this import? The file and the column mapping are not kept.')) return;
                onClose();
              }}
            >
              Cancel
            </button>
            {step === 'Columns' && (
              <>
                <button type="button" className="btn btn-secondary" onClick={restart}>
                  Back
                </button>
                <button type="button" className="btn btn-primary" disabled={busy || missing.length > 0} onClick={() => void showPreview()}>
                  {busy ? 'Checking…' : 'Preview'}
                </button>
              </>
            )}
            {step === 'Preview' && preview && (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => setStep('Columns')}>
                  Back
                </button>
                <button type="button" className="btn btn-primary" disabled={busy || preview.counts.create + preview.counts.update === 0} onClick={() => void commit()}>
                  {busy ? 'Importing…' : `Import ${plural(preview.counts.create + preview.counts.update, 'row')}`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * "Import" on the Org structure page (CD-137 mounts it): the employee import of CD-141 for
 * Administration and Admins. `onImported` re-reads the page's lists after an import.
 */
export function EmployeeImportDialog({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  return <ImportDialog initialType="employees" onClose={onClose} onImported={onImported} />;
}
