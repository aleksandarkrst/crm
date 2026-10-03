import { useState } from 'react';
import { Modal, ModalHeader } from '../components/ui';
import { paths } from '../lib/paths';
import { canManageTemplates, DOC_TYPES, type DocType, docBusy, fileSize, type ScanResult, suggestedTemplate, templateFileProblem } from '../store/documents';
import { leadById, stageOf } from '../store/selectors';
import { useStore } from '../store/store';

/**
 * Generating a document on a deal (CD-13): pick a template, the worker fills it with the deal's
 * data, and the dialog follows the real job until the file is ready to download. Opens from the
 * deal's Documents tab and when a deal enters a stage whose entry document is a Proposal.
 */
export function GenerationModal() {
  const { s, set, session, navigate, generateInDialog, downloadDoc, openDoc } = useStore();
  const lead = leadById(s, s.genLead);
  const stageDoc = lead ? stageOf(s, lead).doc : undefined;
  const templates = s.templates;
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!lead) return null;
  const templateId = picked ?? (templates ? suggestedTemplate(templates, stageDoc)?.id : undefined);
  const doc = s.genDocId ? (s.dealDocs[lead.id] || []).find((d) => d.id === s.genDocId) : undefined;
  const template = templates?.find((t) => t.id === (doc?.templateId ?? templateId));
  const close = () => set({ genOpen: false, genDocId: null });

  const steps = doc
    ? [
        { label: 'Queued for the worker', done: doc.status !== 'queued' },
        { label: `Filling in ${template ? template.placeholders.filter((p) => p.known).length + ' merge fields' : 'the merge fields'} from this deal`, done: doc.status === 'ready' || doc.status === 'failed' },
        { label: 'Saved on the deal, under Documents', done: doc.status === 'ready' },
      ]
    : [];

  return (
    <Modal maxWidth={520} z={40}>
      <div>
        <div className="caps">{stageDoc && stageDoc !== 'None' ? `Stage document · ${stageDoc}` : 'Generate a document'}</div>
        <div style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 24, lineHeight: 1.15, margin: '7px 0 6px' }}>
          {doc ? `Building ${doc.name}` : `Generate a document for ${lead.company || lead.title}`}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {doc ? `Template: ${doc.templateName}` : 'The template is filled in with this deal: company, contact, discovery notes, products and amounts in the deal currency.'}
        </div>
      </div>

      {!doc && templates === null && <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Loading templates…</div>}

      {!doc && templates && templates.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-soft)', borderRadius: 10, padding: 14 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>No document templates yet</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            {canManageTemplates(session.tenant.role)
              ? 'Upload a Word template in Settings → Document templates. There is a starter template to download there.'
              : 'Ask an owner or admin to upload one in Settings → Document templates.'}{' '}
            Meanwhile you can preview the built-in proposal in the browser.
          </span>
        </div>
      )}

      {!doc && templates && templates.length > 0 && (
        <label className="form-label">
          Template
          <select className="form-input" aria-label="Template" value={templateId} onChange={(e) => setPicked(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.docType}
              </option>
            ))}
          </select>
        </label>
      )}

      {doc && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {steps.map((step, i) => {
            const current = !step.done && (i === 0 || steps[i - 1]!.done) && docBusy(doc);
            return (
              <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <span style={{ flex: '0 0 18px', width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${step.done ? '#14503C' : current ? '#B4531B' : '#CAD3CE'}`, background: step.done ? '#14503C' : 'transparent', color: '#FFFFFF', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{step.done ? '✓' : ''}</span>
                <span style={{ fontSize: 13.5, color: step.done || current ? '#0F1B16' : '#93A39B' }}>{step.label}</span>
              </div>
            );
          })}
          {doc.status === 'failed' && <div style={{ fontSize: 12.5, color: 'var(--danger)', lineHeight: 1.5 }}>{doc.error || 'The document could not be generated.'}</div>}
          {doc.status === 'ready' && doc.missingFields.length > 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--warn)', lineHeight: 1.5 }}>Left empty because the deal has no value yet: {doc.missingFields.join(', ')}.</div>
          )}
        </div>
      )}

      <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={close}>
          Close
        </button>
        {!doc && templates && templates.length === 0 && (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                close();
                openDoc(lead.id);
              }}
            >
              Preview built-in proposal
            </button>
            {canManageTemplates(session.tenant.role) && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  close();
                  navigate(paths.settings('templates'));
                }}
              >
                Upload a template
              </button>
            )}
          </>
        )}
        {!doc && templateId && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await generateInDialog(templateId);
              setBusy(false);
            }}
          >
            {busy ? 'Starting…' : 'Generate'}
          </button>
        )}
        {doc && (
          <button type="button" className={doc.status === 'ready' ? 'btn btn-primary' : 'btn btn-disabled'} disabled={doc.status !== 'ready'} onClick={() => void downloadDoc(doc)}>
            {docBusy(doc) ? 'Generating…' : 'Download .docx'}
          </button>
        )}
      </div>
    </Modal>
  );
}

/**
 * Uploading a template (owners and admins): the file is checked and its merge fields listed before
 * it is saved, so a typo like {{deal.amoutn}} shows up as "not recognised" right away.
 */
export function NewTemplateModal() {
  const { set, uploadTemplate, scanTemplate } = useStore();
  const [docType, setDocType] = useState<DocType>('Proposal');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState<'' | 'scan' | 'save'>('');
  const close = () => set({ templateOpen: false });

  const pick = async (f: File | undefined) => {
    setScan(null);
    setProblem('');
    setFile(f ?? null);
    if (!f) return;
    const bad = templateFileProblem(f);
    if (bad) return setProblem(bad);
    if (!name.trim()) setName(f.name.replace(/\.docx$/i, ''));
    setBusy('scan');
    try {
      setScan(await scanTemplate(f));
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    if (!file || !scan) return;
    setBusy('save');
    try {
      await uploadTemplate(file, name.trim(), docType);
      close();
    } catch (err) {
      setProblem((err as Error).message);
      setBusy('');
    }
  };

  const unknown = scan?.placeholders.filter((p) => !p.known) ?? [];
  const known = scan?.placeholders.filter((p) => p.known) ?? [];

  return (
    <Modal maxWidth={600}>
      <ModalHeader title="New template" sub="Upload the Word document you already use. Every {{parameter}} it contains becomes a merge field the CRM fills from the deal." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <span className="caps">Document type</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {DOC_TYPES.map((d) => (
            <button key={d} type="button" className={docType === d ? 'choice-pill on' : 'choice-pill'} onClick={() => setDocType(d)}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <label className="form-label">
        Template name
        <input className="form-input" placeholder="e.g. Proposal — brand programme v1" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>
      <label
        style={{ position: 'relative', cursor: 'pointer', textAlign: 'left', border: `1px dashed ${scan ? '#14503C' : '#CAD3CE'}`, background: scan ? '#E7F2EE' : '#F5F7F6', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 5 }}
      >
        <input
          type="file"
          aria-label="Template file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{file ? file.name : 'Upload a .docx'}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45 }}>
          {busy === 'scan'
            ? 'Checking the document…'
            : scan
              ? `Scanned · ${fileSize(scan.sizeBytes)} · ${known.length} merge field${known.length === 1 ? '' : 's'} recognised${unknown.length ? `, ${unknown.length} not` : ''}`
              : 'Word (.docx), up to 5 MB. Write merge fields in double braces, e.g. {{company.name}}; the reference below the templates lists them all.'}
        </span>
      </label>
      {problem && <div style={{ fontSize: 12.5, color: 'var(--danger)', lineHeight: 1.5 }}>{problem}</div>}
      {scan && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, background: 'var(--bg-soft)', borderRadius: 10, padding: 14 }}>
          <span className="caps">Parameters found</span>
          {scan.placeholders.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>None. The document will be copied as it is.</span>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {scan.placeholders.map((p) => (
              <span key={p.tag} style={{ fontSize: 12, background: 'var(--white)', border: `1px solid ${p.known ? 'var(--border)' : 'var(--danger)'}`, borderRadius: 6, padding: '5px 9px', color: 'var(--ink)' }}>
                {p.tag === 'lines' ? '{{#lines}}' : `{{${p.tag}}}`} <span style={{ color: p.known ? 'var(--muted)' : 'var(--danger)' }}>→ {p.known ? p.label : 'not recognised'}</span>
              </span>
            ))}
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            These fill automatically each time the template runs. {unknown.length ? 'Anything not recognised stays in the document as written; fix the spelling in Word and upload again.' : ''}
          </span>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Cancel
        </button>
        <button type="button" className={scan && name.trim() && !busy ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!scan || !name.trim() || !!busy} onClick={() => void save()}>
          {busy === 'save' ? 'Saving…' : 'Save template'}
        </button>
      </div>
    </Modal>
  );
}
