import { useEffect, useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { DocProgress } from '../../components/DocProgress';
import { canManageTemplates, type DealDoc, docBusy, docMoment, fileExtension, fileSize, MAX_UPLOAD_FILES, suggestedTemplate, UPLOAD_TYPES, type UploadType, uploadFileProblem } from '../../store/documents';
import { stageOf } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';
import { opportunityCopy } from '../../store/wording';
import { docState, docStateClass } from './docs';
import { ProposalActions } from './ProposalActions';

/**
 * The deal's Documents tab (CD-13): generate a document from a template, follow it while the worker
 * fills it in, and download or delete what was generated. Or import your own (CD-120): proposals
 * and documents made outside Pultly, each with its type; one Proposal per opportunity. Once a
 * proposal is generated or imported (owner's call, 25 Oct), the Generate / Import choice gives way
 * to "Add documents" for supporting files. The proposal's next step (request approval, approve, send) sits at the bottom.
 */
export function DealDocuments({ lead }: { lead: Lead }) {
  const { s, session, ensureDocs, loadTemplates, generateDoc, downloadDoc, deleteDoc, startGeneration } = useStore();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'generate' | 'import'>('generate');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    ensureDocs(lead.id);
    void loadTemplates();
  }, [lead.id, ensureDocs, loadTemplates]);

  const templates = s.templates;
  const docs = s.dealDocs[lead.id] || [];
  const templateId = picked ?? (templates ? suggestedTemplate(templates, stageOf(s, lead).doc)?.id : undefined);
  const isAdmin = canManageTemplates(session.tenant.role);
  const hasProposal = docs.some((d) => d.docType === 'Proposal');
  // A proposal generated (or being generated) or imported; a failed generation doesn't count.
  const settled = docs.some((d) => d.docType === 'Proposal' && d.status !== 'failed');

  const generate = async () => {
    if (!templateId) return;
    setBusy(true);
    await generateDoc(lead.id, templateId);
    setBusy(false);
  };
  const onDelete = async (d: DealDoc) => {
    if (await askConfirm({ title: `Delete ${d.name}?`, message: 'The file is removed for everyone.', confirmLabel: 'Delete', danger: true })) void deleteDoc(d);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="caps">Proposal</span>
      {settled ? (
        adding && <ImportDocuments lead={lead} hasProposal={hasProposal} onDone={() => setAdding(false)} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
            <button type="button" className={'choice' + (mode === 'generate' ? ' on' : '')} data-testid="docs-mode-generate" onClick={() => setMode('generate')}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Generate automatically</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Built from the deal, its products and the discovery notes.</span>
            </button>
            <button type="button" className={'choice' + (mode === 'import' ? ' on' : '')} data-testid="docs-mode-import" onClick={() => setMode('import')}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Import my own</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Upload a proposal and documents you made outside Pultly.</span>
            </button>
          </div>

          {mode === 'import' ? (
            <ImportDocuments lead={lead} hasProposal={hasProposal} onDone={() => setMode('generate')} />
          ) : templates && templates.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="box-input" aria-label="Document template" style={{ flex: '1 1 200px', minWidth: 0 }} value={templateId} onChange={(e) => setPicked(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.docType}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-primary" disabled={busy || !templateId} onClick={() => void generate()}>
                {busy ? 'Starting…' : 'Generate document'}
              </button>
            </div>
          ) : (
            templates && (
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                No document templates yet. {isAdmin ? 'Upload a Word template in Settings → Document templates.' : 'Ask an owner or admin to upload one in Settings → Document templates.'}{' '}
                <button type="button" style={{ border: 0, background: 'none', padding: 0, color: 'var(--brand)', cursor: 'pointer', fontSize: 12.5 }} onClick={() => startGeneration(lead.id)}>
                  More options
                </button>
              </div>
            )
          )}
        </>
      )}

      {docs.map((d) => {
        const state = docState(d);
        return (
          <div key={d.id} data-doc={d.name} style={{ border: '1px solid var(--divider)', borderRadius: 8, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 9 }}>
              <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{d.name}</span>
              <span className={'badge ' + docStateClass(state)} style={{ fontSize: 9.5, textTransform: 'uppercase', padding: '3px 5px', borderRadius: 4 }}>
                {state}
              </span>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
              {d.source === 'uploaded' ? `${d.docType} · uploaded` : d.templateName} · {d.createdByName || 'someone who left'} · {docMoment(d.createdAt, s.workspace.timezone)}
              {d.sizeBytes ? ` · ${fileSize(d.sizeBytes)}` : ''}
            </span>
            <DocProgress doc={d} />
            {d.status === 'failed' && <span style={{ fontSize: 11.5, color: 'var(--danger)', lineHeight: 1.45 }}>{d.error}</span>}
            {d.status === 'ready' && d.missingFields.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.45 }}>Left empty: {d.missingFields.map(opportunityCopy).join(', ')}</span>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {d.status === 'ready' && (
                <button type="button" className="btn-outline" style={{ fontSize: 12, padding: '7px 11px', borderRadius: 6, fontWeight: 400 }} onClick={() => void downloadDoc(d)}>
                  Download .{fileExtension(d)}
                </button>
              )}
              {(isAdmin || d.createdByUserId === session.userId) && !docBusy(d) && (
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 11px', borderRadius: 6, fontWeight: 400 }} onClick={() => void onDelete(d)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        );
      })}
      {docs.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>No documents yet. Generate one or import your own here; entering a stage whose entry document is a Proposal offers it too.</div>}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        {settled && (
          <button type="button" className="btn-outline" data-testid="docs-add" style={{ fontSize: 12, padding: '7px 11px', borderRadius: 6, fontWeight: 400 }} onClick={() => setAdding((x) => !x)}>
            {adding ? 'Cancel' : 'Add documents'}
          </button>
        )}
        {/* "Preview built-in proposal" is switched off (owner, 25 Oct); it opened openDoc(lead.id).
        {!settled && (
          <button type="button" className="btn-outline" data-testid="docs-preview" style={{ fontSize: 12, padding: '7px 11px', borderRadius: 6, fontWeight: 400 }} onClick={() => openDoc(lead.id)}>
            Preview built-in proposal
          </button>
        )} */}
        <span style={{ marginLeft: 'auto' }} />
        <ProposalActions lead={lead} />
      </div>
    </div>
  );
}

/** "Import my own" (CD-120): pick or drop files, give each a document type, then save them together. */
function ImportDocuments({ lead, hasProposal, onDone }: { lead: Lead; hasProposal: boolean; onDone: () => void }) {
  const { uploadDocs } = useStore();
  const [files, setFiles] = useState<{ file: File; type: UploadType | '' }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = (list: FileList | null | undefined) => {
    if (!list?.length) return;
    const picked = [...list];
    const bad = picked.map((f) => [f, uploadFileProblem(f)] as const).find(([, p]) => p);
    if (bad) return setProblem(`${bad[0].name}: ${bad[1]}`);
    if (files.length + picked.length > MAX_UPLOAD_FILES) return setProblem(`Up to ${MAX_UPLOAD_FILES} files at a time.`);
    setProblem(null);
    setFiles((cur) => [...cur, ...picked.map((file) => ({ file, type: '' as const }))]);
  };
  const untyped = files.filter((f) => !f.type).length;
  const proposals = files.filter((f) => f.type === 'Proposal').length;
  const blocker = untyped
    ? `${untyped} ${untyped === 1 ? 'file still needs' : 'files still need'} a document type`
    : proposals > 1
      ? 'Only one file can be the Proposal'
      : proposals && hasProposal
        ? 'This opportunity already has a proposal; delete it first, or pick another type'
        : null;
  const save = async () => {
    setBusy(true);
    const ok = await uploadDocs(
      lead.id,
      files.map((f) => ({ file: f.file, type: f.type as UploadType })),
    );
    setBusy(false);
    if (ok) {
      setFiles([]);
      onDone();
    }
  };

  return (
    <div data-testid="docs-import" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        style={{ position: 'relative', cursor: 'pointer', border: `1px dashed ${over ? 'var(--brand)' : 'var(--border)'}`, background: over ? 'var(--brand-soft)' : 'var(--bg-soft)', borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', textAlign: 'center' }}
      >
        <input
          type="file"
          multiple
          aria-label="Documents to upload"
          data-testid="docs-import-input"
          accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>
          Drop files here or <span style={{ color: 'var(--brand)' }}>browse</span>
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>PDF, DOCX or XLSX, up to 25 MB each. Pick a document type for every file.</span>
      </label>
      {problem && (
        <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', lineHeight: 1.5 }}>
          {problem}
        </div>
      )}
      {files.map((f, i) => (
        <div key={i} data-testid="docs-import-file" style={{ border: '1px solid var(--divider)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{f.file.name}</span>
            <span style={{ fontSize: 11.5, color: f.type ? 'var(--text-2)' : 'var(--warn)' }}>{f.type ? fileSize(f.file.size) : 'Choose a document type to save this file'}</span>
          </div>
          <select
            className="box-input"
            aria-label={`Document type of ${f.file.name}`}
            value={f.type}
            onChange={(e) => {
              const type = e.target.value as UploadType | '';
              setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, type } : x)));
            }}
            style={{ flex: '0 1 210px' }}
          >
            <option value="">Choose a type</option>
            {UPLOAD_TYPES.filter((t) => t !== 'Proposal' || !hasProposal).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button type="button" className="pill-x" title={`Remove ${f.file.name}`} aria-label={`Remove ${f.file.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
        {hasProposal
          ? 'This opportunity has its proposal already; these files are attached as supporting documents.'
          : 'The file typed Proposal is the one sent for approval and to the client. Only one Proposal per opportunity; the rest are attached as supporting documents.'}
      </span>
      {files.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {blocker && <span style={{ fontSize: 12, color: 'var(--warn)', marginRight: 'auto' }}>{blocker}</span>}
          <button type="button" className="btn btn-secondary" style={{ marginLeft: blocker ? undefined : 'auto' }} disabled={busy} onClick={() => setFiles([])}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" data-testid="docs-import-save" disabled={busy || !!blocker} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save documents'}
          </button>
        </div>
      )}
    </div>
  );
}
