import { useEffect, useState } from 'react';
import { askConfirm } from '../components/ConfirmDialog';
import { canManageTemplates, type DocTemplate, docMoment, fileSize, type PlaceholderReference } from '../store/documents';
import { useStore } from '../store/store';
import { mergeFieldGroupHeading, mergeFieldReference, opportunityCopy } from '../store/wording';
import { Block, Note, Table } from './settings/parts';

/**
 * Settings → Document templates (CD-13): the uploaded .docx templates, the built-in proposal preview,
 * and the merge field reference with a starter template to download. Owners and admins upload and
 * delete; everyone can download.
 */
export function TemplatesTab() {
  const { s, session, set, openDoc, loadTemplates, downloadTemplate, deleteTemplate } = useStore();
  const lead = s.leads[0];
  const canManage = canManageTemplates(session.tenant.role);
  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const onDelete = async (t: DocTemplate) => {
    if (!(await askConfirm({ title: `Delete the template "${t.name}"?`, message: 'Documents already generated from it are kept.', confirmLabel: 'Delete', danger: true }))) return;
    void deleteTemplate(t);
  };
  const onEdit = (t: DocTemplate) => set({ templateOpen: true, templateEditing: t });

  // Settings → CRM → Document templates (design G-Settings "templates", CD-524): a table of templates, then the merge fields.
  return (
    <>
      <Block title="Templates">
        <Table cols={[{ label: 'Template' }, { label: 'Type' }, { label: 'Merge fields' }, { label: '', align: 'actions' }]} minWidth={640}>
          {(s.templates || []).map((t) => {
            const unknown = t.placeholders.filter((p) => !p.known);
            const known = t.placeholders.length - unknown.length;
            return (
              <tr key={t.id} data-template={t.name}>
                <td>
                  <span className="ws-cell">
                    <b style={{ overflowWrap: 'anywhere' }}>{t.name}</b>
                    <span className="ws-row-hint">
                      {t.uploadedByName ? `${t.uploadedByName} · ` : ''}
                      {docMoment(t.createdAt, s.workspace.timezone)} · {fileSize(t.sizeBytes)}
                    </span>
                  </span>
                </td>
                <td>
                  <span className="badge badge-brand">{t.docType}</span>
                </td>
                <td>
                  <span className="ws-cell" title={t.placeholders.map((p) => (p.tag === 'lines' ? '{{#lines}}' : `{{${p.tag}}}`) + (p.label ? ` ${opportunityCopy(p.label)}` : ' not recognised')).join('\n')}>
                    <span>{t.placeholders.length ? `${known} ${known === 1 ? 'field' : 'fields'}` : 'None'}</span>
                    {unknown.length > 0 && (
                      <span className="ws-row-error" style={{ fontSize: 12 }}>
                        {unknown.length} not recognised, left as written: {unknown.map((p) => `{{${p.tag}}}`).join(', ')}
                      </span>
                    )}
                  </span>
                </td>
                <td className="actions">
                  <button type="button" className="btn-plain" style={{ padding: '6px 11px', fontSize: 12.5 }} onClick={() => void downloadTemplate(t)}>
                    Download
                  </button>
                  {canManage && (
                    <>
                      <button type="button" className="btn-plain" style={{ padding: '6px 11px', fontSize: 12.5 }} data-testid="edit-template" onClick={() => onEdit(t)}>
                        Edit
                      </button>
                      <button type="button" className="btn-danger-quiet" style={{ padding: '6px 11px', fontSize: 12.5 }} onClick={() => void onDelete(t)}>
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          <tr>
            <td>
              <span className="ws-cell">
                <b>Proposal v4</b>
                <span className="ws-row-hint">{lead ? 'Built in · a preview in the browser, not saved' : 'Built in · add an opportunity to preview it'}</span>
              </span>
            </td>
            <td>
              <span className="badge badge-neutral">Built in</span>
            </td>
            <td>
              <span className="ws-row-hint">From the discovery notes and lines</span>
            </td>
            <td className="actions">
              {lead && (
                <button type="button" className="btn-plain" style={{ padding: '6px 11px', fontSize: 12.5 }} onClick={() => openDoc(lead.id)}>
                  Preview with an opportunity
                </button>
              )}
            </td>
          </tr>
        </Table>
      </Block>
      {s.templates?.length === 0 && <Note>No templates uploaded yet. {canManage ? 'Download the starter template below, make it yours in Word, and upload it with New template.' : 'Owners and admins can upload them.'}</Note>}
      <Note>The built-in proposal is assembled from the opportunity's discovery notes and lines. To send a Word file, upload your own template.</Note>

      <PlaceholderReferenceCard />
    </>
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
    <Block
      title="Merge fields"
      desc={
        <>
          Type them into a Word document in double braces. Amounts come out in the opportunity's currency; a field the opportunity has no value for is left empty and named on the document. Opportunity lines repeat with{' '}
          <code>{'{{#lines}} … {{/lines}}'}</code>: put the opening tag in the first cell of a table row and the closing tag in its last cell, and the row repeats once per line.
        </>
      }
      actions={
        <button type="button" className="btn-plain" onClick={() => void downloadStarter()}>
          Download starter template
        </button>
      }
    >
      <div className="card" style={{ overflow: 'hidden' }}>
        {!ref && <div style={{ padding: '14px 18px', fontSize: 12.5, color: 'var(--muted)' }}>Loading…</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
          {[...groups].map(([group, fields]) => (
            <div key={group} style={{ padding: '14px 18px', borderBottom: '1px solid var(--divider-2)', display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span className="caps-muted">{mergeFieldGroupHeading(group)}</span>
              {fields.map((f) => {
                const shown = mergeFieldReference(f.tag, f.label);
                return (
                  // A token is never broken mid-word (CD-488): it keeps its width and the description
                  // takes the rest of the row, or goes under it when the token is long.
                  <div key={f.tag} style={{ display: 'flex', flexWrap: 'wrap', columnGap: 10, rowGap: 2, fontSize: 12.5, alignItems: 'baseline' }}>
                    <code style={{ whiteSpace: 'nowrap', flex: '0 0 auto' }}>{shown.token}</code>
                    <span style={{ color: 'var(--text-2)', flex: '1 1 140px', minWidth: 0 }}>
                      {shown.description} <span style={{ color: 'var(--muted)' }}>· {f.example}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {ref && Object.keys(ref.aliases).length > 0 && (
          <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text-2)' }}>
            Short forms:{' '}
            {Object.entries(ref.aliases).map(([a, t], i) => (
              <span key={a}>
                {i ? ', ' : ''}
                <code>{`{{${a}}}`}</code> = <code>{`{{${t}}}`}</code>
              </span>
            ))}
            .
          </div>
        )}
      </div>
    </Block>
  );
}
