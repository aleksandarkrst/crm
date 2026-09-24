import { useEffect, useState } from 'react';
import { canManageTemplates, type DealDoc, docBusy, docMoment, fileSize, suggestedTemplate } from '../../store/documents';
import { stageOf } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';
import { docState, docStateClass } from './docs';

/**
 * The deal's Documents tab (CD-13): generate a document from a template, follow it while the worker
 * fills it in, and download or delete what was generated.
 */
export function DealDocuments({ lead }: { lead: Lead }) {
  const { s, session, ensureDocs, loadTemplates, generateDoc, downloadDoc, deleteDoc, openDoc, startGeneration } = useStore();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ensureDocs(lead.id);
    void loadTemplates();
  }, [lead.id, ensureDocs, loadTemplates]);

  const templates = s.templates;
  const docs = s.dealDocs[lead.id] || [];
  const templateId = picked ?? (templates ? suggestedTemplate(templates, stageOf(s, lead).doc)?.id : undefined);
  const isAdmin = canManageTemplates(session.tenant.role);

  const generate = async () => {
    if (!templateId) return;
    setBusy(true);
    await generateDoc(lead.id, templateId);
    setBusy(false);
  };
  const onDelete = (d: DealDoc) => {
    if (window.confirm(`Delete ${d.name}? The file is removed for everyone.`)) void deleteDoc(d);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {templates && templates.length > 0 ? (
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
              {d.templateName} · {d.createdByName || 'someone who left'} · {docMoment(d.createdAt, s.workspace.timezone)}
              {d.sizeBytes ? ` · ${fileSize(d.sizeBytes)}` : ''}
            </span>
            {d.status === 'failed' && <span style={{ fontSize: 11.5, color: 'var(--danger)', lineHeight: 1.45 }}>{d.error}</span>}
            {d.status === 'ready' && d.missingFields.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.45 }}>Left empty: {d.missingFields.join(', ')}</span>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {d.status === 'ready' && (
                <button type="button" className="btn-outline" style={{ fontSize: 12, padding: '7px 11px', borderRadius: 6, fontWeight: 400 }} onClick={() => void downloadDoc(d)}>
                  Download .docx
                </button>
              )}
              {(isAdmin || d.createdByUserId === session.userId) && !docBusy(d) && (
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 11px', borderRadius: 6, fontWeight: 400 }} onClick={() => onDelete(d)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        );
      })}
      {docs.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>No documents yet. Generate one here; entering a stage whose entry document is a Proposal offers it too.</div>}
      <button type="button" className="btn-outline" style={{ alignSelf: 'flex-start', fontSize: 12, padding: '7px 11px', borderRadius: 6, fontWeight: 400 }} onClick={() => openDoc(lead.id)}>
        Preview built-in proposal
      </button>
    </div>
  );
}
