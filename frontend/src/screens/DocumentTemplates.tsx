import { useEffect, useRef, useState } from 'react';
import { canManageTemplates, DOC_TYPES, type DocTemplate, type DocType, docMoment, fileSize, type PlaceholderReference, type ScanResult, templateFileProblem } from '../store/documents';
import { useStore } from '../store/store';
import { mergeFieldReference, opportunityCopy } from '../store/wording';
import { askGlassConfirm, Badge, Card, Modal, Row, RowMenu, Section, Table } from './settings/parts';

const TONE: Record<string, 'violet' | 'blue' | 'green' | undefined> = { Proposal: 'violet', Quote: 'blue', Contract: 'green' };

/**
 * CRM → Document templates (CD-13; the design's table since CD-524): the uploaded .docx templates
 * and the built-in proposal, each with a ⋯ menu; then the merge fields, with the starter template
 * to download and the full list behind "Show merge fields". Owners and admins upload and delete;
 * everyone can download. The design's "Used in" column isn't shown: the app doesn't track it.
 */
export function TemplatesSection() {
  const { s, session, flash, openDoc, loadTemplates, downloadTemplate, deleteTemplate, loadPlaceholders, downloadStarter } = useStore();
  const lead = s.leads[0];
  const canManage = canManageTemplates(session.tenant.role);
  const [ref, setRef] = useState<PlaceholderReference | null>(null);
  const [showFields, setShowFields] = useState(false);
  // The template being uploaded or replaced ('new' for New template), in the glass modal below.
  const [upload, setUpload] = useState<DocTemplate | 'new' | null>(null);
  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);
  useEffect(() => {
    let live = true;
    void loadPlaceholders().then((r) => live && setRef(r));
    return () => {
      live = false;
    };
  }, [loadPlaceholders]);

  const onDelete = async (t: DocTemplate) => {
    if (!(await askGlassConfirm({ title: `Delete the template "${t.name}"?`, text: 'Documents already generated from it are kept.', confirmLabel: 'Delete template' }))) return;
    void deleteTemplate(t);
  };
  const fields = [...(ref?.fields ?? []), ...(ref?.lineFields ?? [])];
  return (
    <Section
      title="Document templates"
      desc="Templates hold the fixed story; merge fields pull the rest from the opportunity when someone generates a document."
      action={
        <button type="button" className="gs-btn primary" data-testid="new-template" onClick={() => (canManage ? setUpload('new') : flash('Only owners and admins can add templates', 4000, true))}>
          New template
        </button>
      }
      testId="templates"
    >
      <Table cols={[{ label: 'Template' }, { label: 'Type' }, { label: '', align: 'end' }]} minWidth={480}>
        {(s.templates || []).map((t) => {
          const unknown = t.placeholders.filter((p) => !p.known);
          return (
            <tr key={t.id} data-template={t.name}>
              <td>
                <span className="gs-cell">
                  <b style={{ overflowWrap: 'anywhere' }}>{t.name}</b>
                  <span className="gs-sub">
                    {[t.uploadedByName, docMoment(t.createdAt, s.workspace.timezone)].filter(Boolean).join(', ')}
                    {unknown.length > 0 && <span style={{ color: 'var(--gs-danger-dark)' }}>. {unknown.length} merge fields not recognised: {unknown.map((p) => `{{${p.tag}}}`).join(', ')}</span>}
                  </span>
                </span>
              </td>
              <td>
                <Badge tone={TONE[t.docType]}>{t.docType}</Badge>
              </td>
              <td className="end">
                <RowMenu
                  label={`Actions for ${t.name}`}
                  testId="template-menu"
                  items={[
                    { label: 'Download', onClick: () => void downloadTemplate(t) },
                    ...(canManage
                      ? [
                          { label: 'Upload new version', onClick: () => setUpload(t), testId: 'edit-template' },
                          { label: 'Delete', onClick: () => void onDelete(t), danger: true },
                        ]
                      : []),
                  ]}
                />
              </td>
            </tr>
          );
        })}
        <tr>
          <td>
            <span className="gs-cell">
              <b>Proposal v4</b>
              <span className="gs-sub">{lead ? 'Built in, a preview in the browser' : 'Built in, add an opportunity to preview it'}</span>
            </span>
          </td>
          <td>
            <Badge tone="violet">Proposal</Badge>
          </td>
          <td className="end">{lead && <RowMenu label="Actions for Proposal v4" items={[{ label: 'Preview with an opportunity', onClick: () => openDoc(lead.id) }]} />}</td>
        </tr>
      </Table>
      <Card>
        <Row
          label="Merge fields"
          desc={
            <>
              {fields.length ? `${fields.length} fields` : 'Fields'} you can type in a Word template, wrapped in double curly braces, like <code className="gs-code">{'{{company.name}}'}</code>
            </>
          }
        >
          <button type="button" className="gs-btn" onClick={() => void downloadStarter()}>
            Download starter template
          </button>
          <button type="button" className="gs-btn" aria-expanded={showFields} onClick={() => setShowFields(!showFields)}>
            {showFields ? 'Hide merge fields' : 'Show merge fields'}
          </button>
        </Row>
      </Card>
      {showFields && (
        <Table cols={[{ label: 'Field' }, { label: 'Example' }]} minWidth={480} testId="merge-fields">
          {fields.map((f) => {
            const shown = mergeFieldReference(f.tag, f.label);
            return (
              <tr key={f.tag}>
                <td>
                  <span className="gs-cell">
                    <code className="gs-code" style={{ alignSelf: 'flex-start' }}>
                      {shown.token}
                    </code>
                    <span className="gs-sub">{shown.description}</span>
                  </span>
                </td>
                <td>{f.example}</td>
              </tr>
            );
          })}
        </Table>
      )}
      {upload && <TemplateModal editing={upload === 'new' ? null : upload} onClose={() => setUpload(null)} />}
    </Section>
  );
}

/**
 * Uploading or replacing a template in the glass style (CD-524 review; the logic of the old
 * NewTemplateModal): the file is checked and its merge fields listed before it is saved, so a typo
 * like {{deal.amoutn}} shows up as "not recognised" right away. Replacing keeps name and type.
 */
function TemplateModal({ editing, onClose }: { editing: DocTemplate | null; onClose: () => void }) {
  const { uploadTemplate, replaceTemplate, scanTemplate } = useStore();
  const [docType, setDocType] = useState<DocType>(editing?.docType ?? 'Proposal');
  const [name, setName] = useState(editing?.name ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState<'' | 'scan' | 'save'>('');
  // Only the last chosen file's check counts: an earlier, slower one is ignored when it comes back.
  const latest = useRef<File | null>(null);

  const pick = async (f: File | undefined) => {
    setScan(null);
    setProblem('');
    setFile(f ?? null);
    latest.current = f ?? null;
    if (!f) return;
    const bad = templateFileProblem(f);
    if (bad) return setProblem(bad);
    if (!name.trim()) setName(f.name.replace(/\.docx$/i, ''));
    setBusy('scan');
    try {
      const result = await scanTemplate(f);
      if (latest.current === f) setScan(result);
    } catch (err) {
      if (latest.current === f) setProblem((err as Error).message);
    } finally {
      if (latest.current === f) setBusy('');
    }
  };
  const save = async () => {
    if (!file || !scan) return;
    setBusy('save');
    try {
      if (editing) await replaceTemplate(editing.id, file, name.trim(), docType);
      else await uploadTemplate(file, name.trim(), docType);
      onClose();
    } catch (err) {
      setProblem((err as Error).message);
      setBusy('');
    }
  };
  const unknown = scan?.placeholders.filter((p) => !p.known) ?? [];
  const known = scan?.placeholders.filter((p) => p.known) ?? [];

  return (
    <Modal
      title={editing ? 'Upload a new version' : 'New template'}
      desc={editing ? 'The new Word document replaces this template. Documents already generated from it are kept.' : 'Upload the Word document you already use. Every {{field}} in it becomes a merge field filled from the opportunity.'}
      onClose={onClose}
      wide
      testId="template-modal"
    >
      <label className="gs-label">
        Template name
        <input className="gs-input" placeholder="e.g. Proposal, brand programme v1" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="gs-label">
        Document type
        <span className="gs-move" role="radiogroup" aria-label="Document type">
          {DOC_TYPES.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={docType === d} className={docType === d ? 'on' : ''} onClick={() => setDocType(d)}>
              {d}
            </button>
          ))}
        </span>
      </div>
      <label className={'gs-drop' + (scan ? ' ok' : '')}>
        <input type="file" aria-label="Template file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => void pick(e.target.files?.[0])} />
        <b>{file ? file.name : editing ? 'Choose the new .docx' : 'Choose a .docx'}</b>
        <span className="gs-sub">
          {busy === 'scan'
            ? 'Checking the document'
            : scan
              ? `${fileSize(scan.sizeBytes)}, ${known.length} merge field${known.length === 1 ? '' : 's'} recognised${unknown.length ? `, ${unknown.length} not` : ''}`
              : editing
                ? `Now: ${editing.fileName}. Word (.docx), up to 5 MB.`
                : 'Word (.docx), up to 5 MB. Write merge fields in double curly braces, like {{company.name}}.'}
        </span>
      </label>
      {problem && (
        <span className="gs-error" role="alert">
          {problem}
        </span>
      )}
      {scan && (
        <div className="gs-label">
          Merge fields found
          {scan.placeholders.length === 0 ? (
            <span className="gs-sub">None. The document is copied as it is.</span>
          ) : (
            <span className="gs-found-list">
              {scan.placeholders.map((p) => (
                <span key={p.tag} className={'gs-found' + (p.known ? '' : ' bad')}>
                  <code>{p.tag === 'lines' ? '{{#lines}}' : `{{${p.tag}}}`}</code> {p.known ? opportunityCopy(p.label ?? '') : 'not recognised'}
                </span>
              ))}
            </span>
          )}
          {unknown.length > 0 && <span className="gs-sub">Fields not recognised stay in the document as written. Fix the spelling in Word and upload again.</span>}
        </div>
      )}
      <div className="gs-sheet-actions">
        <button type="button" className="gs-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="gs-btn primary" data-testid="template-save" disabled={!scan || !name.trim() || !!busy} onClick={() => void save()}>
          {busy === 'save' ? 'Saving' : editing ? 'Save new version' : 'Add template'}
        </button>
      </div>
    </Modal>
  );
}
