import { useEffect, useState } from 'react';
import { canManageTemplates, type DocTemplate, docMoment, fileSize, type PlaceholderReference } from '../store/documents';
import { useStore } from '../store/store';

/**
 * Settings → Document templates (CD-13): the uploaded .docx templates, the built-in proposal preview,
 * and the merge field reference with a starter template to download. Owners and admins upload and
 * delete; everyone can download.
 */
export function TemplatesTab() {
  const { s, session, openDoc, loadTemplates, downloadTemplate, deleteTemplate } = useStore();
  const lead = s.leads[0];
  const canManage = canManageTemplates(session.tenant.role);
  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const onDelete = (t: DocTemplate) => {
    if (window.confirm(`Delete the template "${t.name}"? Documents already generated from it are kept.`)) void deleteTemplate(t);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        {(s.templates || []).map((t) => {
          const unknown = t.placeholders.filter((p) => !p.known);
          return (
            <div key={t.id} className="card" data-template={t.name} style={{ padding: 17, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{t.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {t.uploadedByName ? `${t.uploadedByName} · ` : ''}
                    {docMoment(t.createdAt, s.workspace.timezone)} · {fileSize(t.sizeBytes)}
                  </span>
                </div>
                <span className="tag" style={{ padding: '4px 6px', background: '#E7F2EE', color: '#14503C' }}>
                  {t.docType}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                {t.placeholders.length ? `${t.placeholders.length - unknown.length} merge field${t.placeholders.length - unknown.length === 1 ? '' : 's'} filled from the deal.` : 'No merge fields: generating copies the document as it is.'}
                {unknown.length > 0 && <span style={{ color: 'var(--danger)' }}> {unknown.length} not recognised, left as written.</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {t.placeholders.slice(0, 12).map((p) => (
                  <span key={p.tag} className="merge-tag" title={p.label ?? 'Not recognised'} style={p.known ? undefined : { background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                    {p.tag === 'lines' ? '{{#lines}}' : `{{${p.tag}}}`}
                  </span>
                ))}
                {t.placeholders.length > 12 && <span style={{ fontSize: 11.5, color: 'var(--muted)', alignSelf: 'center' }}>+{t.placeholders.length - 12} more</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                <button type="button" className="btn-outline" onClick={() => void downloadTemplate(t)}>
                  Download
                </button>
                {canManage && (
                  <button type="button" className="btn btn-secondary" style={{ fontSize: 12.5, padding: '8px 13px', borderRadius: 7 }} onClick={() => onDelete(t)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div className="card" style={{ padding: 17, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Proposal v4</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{lead ? 'Built in · a preview in the browser, not saved' : 'Built in · add a deal to preview it'}</span>
            </div>
            <span className="tag" style={{ padding: '4px 6px', background: '#F2F5F3', color: '#475750' }}>
              built-in
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>The design's proposal, assembled from the deal's discovery notes and lines. To send a Word file, upload your own template.</div>
          {lead && (
            <button type="button" className="btn-outline" style={{ alignSelf: 'flex-start', marginTop: 'auto' }} onClick={() => openDoc(lead.id)}>
              Preview with a lead
            </button>
          )}
        </div>
      </div>

      {s.templates?.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
          No templates uploaded yet. {canManage ? 'Download the starter template below, make it yours in Word, and upload it with New template.' : 'Owners and admins can upload them.'}
        </div>
      )}

      <PlaceholderReferenceCard />
    </div>
  );
}

/** Every merge field, grouped, with an example; and the starter template. */
function PlaceholderReferenceCard() {
  const { loadPlaceholders, downloadStarter } = useStore();
  const [ref, setRef] = useState<PlaceholderReference | null>(null);
  useEffect(() => {
    let live = true;
    void loadPlaceholders().then((r) => live && setRef(r));
    return () => {
      live = false;
    };
  }, [loadPlaceholders]);

  const groups = new Map<string, PlaceholderReference['fields']>();
  for (const f of [...(ref?.fields ?? []), ...(ref?.lineFields ?? [])]) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 320px' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Merge fields</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            Type them into a Word document in double braces. Amounts come out in the deal's currency; a field the deal has no value for is left empty and named on the document. Deal lines repeat with{' '}
            <code>{'{{#lines}} … {{/lines}}'}</code>: put the opening tag in the first cell of a table row and the closing tag in its last cell, and the row repeats once per line.
          </span>
        </div>
        <button type="button" className="btn-outline" onClick={() => void downloadStarter()}>
          Download starter template
        </button>
      </div>
      {!ref && <div style={{ padding: '14px 18px', fontSize: 12.5, color: 'var(--muted)' }}>Loading…</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        {[...groups].map(([group, fields]) => (
          <div key={group} style={{ padding: '14px 18px', borderBottom: '1px solid var(--divider-2)', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span className="caps-muted">{group === 'Deal lines' ? 'Deal lines · inside {{#lines}}' : group}</span>
            {fields.map((f) => (
              <div key={f.tag} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10, fontSize: 12.5, alignItems: 'baseline' }}>
                <code style={{ overflowWrap: 'anywhere' }}>{`{{${f.tag}}}`}</code>
                <span style={{ color: 'var(--text-2)' }}>
                  {f.label} <span style={{ color: 'var(--muted)' }}>· {f.example}</span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {ref && Object.keys(ref.aliases).length > 0 && (
        <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text-2)' }}>
          Short forms: {Object.entries(ref.aliases).map(([a, t], i) => (
            <span key={a}>
              {i ? ', ' : ''}
              <code>{`{{${a}}}`}</code> = <code>{`{{${t}}}`}</code>
            </span>
          ))}
          .
        </div>
      )}
    </div>
  );
}
