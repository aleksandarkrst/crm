import { useState } from 'react';
import { Modal, ModalHeader } from '../components/ui';
import { ApiError } from '../lib/api';
import { downloadText } from '../lib/csv';
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
};

/** The API's message, plus the first field problem when validation failed. */
const errText = (err: unknown) => {
  const issue = err instanceof ApiError ? (err.body as { issues?: { path?: string; message?: string }[] } | null)?.issues?.[0] : undefined;
  const msg = err instanceof Error ? err.message : String(err);
  return issue?.message ? `${msg}: ${issue.path ? issue.path + ' ' : ''}${issue.message}` : msg;
};
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * CSV import (CD-64): pick the type and a file, map columns to fields (guessed from the headers),
 * preview the rows with their errors and duplicates, import, then a summary with the failed rows
 * as a download. The server parses and validates; this dialog only shows what it says. (The
 * employee import of CD-141 was removed by CD-226: people join by invitation.)
 */
export function ImportDialog({ initialType, onClose }: { initialType: ImportType; onClose: () => void }) {
  const { s, reload } = useStore();
  const funnels = funnelOptions(s);
  const [step, setStep] = useState<Step>('File');
  const [type, setType] = useState<ImportType>(initialType);
  const [funnelId, setFunnelId] = useState(() => currentFunnelId(s) ?? '');
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [mapping, setMapping] = useState<Mapping>({});
  const [duplicates, setDuplicates] = useState<DuplicateMode>('skip');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const request = (over: { mapping?: Mapping; duplicates?: DuplicateMode; csv?: string } = {}) => ({
    csv: over.csv ?? csv,
    mapping: over.mapping,
    duplicates: over.duplicates ?? duplicates,
    funnelId: type === 'deals' && funnelId ? funnelId : undefined,
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
    if (file.size > MAX_IMPORT_BYTES) {
      setError(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
      return;
    }
    void run(async () => start(await file.text()));
  };
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
      await reload();
    });
  const downloadTemplate = () => run(async () => downloadText(`pultly-${type}-template.csv`, await importApi.template(type)));
  const restart = () => {
    setStep('File');
    setCsv('');
    setFileName('');
    setPreview(null);
    setResult(null);
    setError('');
  };

  const fields = preview?.fields ?? [];
  const isMapped = (key: string | undefined) => !!key && (mapping[key] ?? null) !== null;
  const missing = fields.filter((f) => f.required && !isMapped(f.key) && !isMapped(f.alternative)).map((f) => f.label);
  const shownFields = fields.filter((f) => isMapped(f.key)).slice(0, 4);
  const title = `Import ${TYPES.find((t) => t.key === type)!.label.toLowerCase()}`;
  const sub = 'Upload a CSV (UTF-8, comma or semicolon separated, with a header row). Nothing is saved until you import.';

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9 }}>
            {TYPES.map((t) => (
              <button key={t.key} type="button" className={t.key === type ? 'choice on' : 'choice'} onClick={() => setType(t.key)}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.label}</span>
                <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>{t.sub}</span>
              </button>
            ))}
          </div>
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
            CSV file
            <input className="form-input" type="file" accept=".csv,text/csv,text/plain" disabled={busy} onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>
          <div className="hint-box">
            Up to 5,000 rows and 2 MB per file.{' '}
            {type === 'deals' ? 'Rows without a funnel or stage go to the funnel above, in its first stage; companies are matched by name and created if new. ' : ''}
            Not sure about the columns?{' '}
            <button type="button" className="btn-plain" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => void downloadTemplate()}>
              Download the {type} template
            </button>
          </div>
        </>
      )}

      {step === 'Columns' && preview && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {fileName} · {plural(preview.counts.rows, 'row')} · {preview.delimiter === ';' ? 'semicolon' : 'comma'} separated. We matched the columns we recognised; check them below.
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
            {!!preview.counts.newCompanies && <span className="badge badge-neutral">{plural(preview.counts.newCompanies, 'new company', 'new companies')}</span>}
            {!!preview.counts.newContacts && <span className="badge badge-neutral">{plural(preview.counts.newContacts, 'new contact')}</span>}
          </div>
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
                  <span style={{ lineHeight: 1.4, color: r.status === 'invalid' ? 'var(--danger)' : 'var(--text-2)' }}>{[...r.messages, ...r.notes].join(' · ')}</span>
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
