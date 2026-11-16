import { useEffect, useState } from 'react';
import { askConfirm } from '../components/ConfirmDialog';
import { canManageTemplates, type DocTemplate, docMoment, type PlaceholderReference } from '../store/documents';
import { useStore } from '../store/store';
import { mergeFieldReference } from '../store/wording';
import { Badge, Card, Row, RowMenu, Section, Table } from './settings/parts';

const TONE: Record<string, 'violet' | 'blue' | 'green' | undefined> = { Proposal: 'violet', Quote: 'blue', Contract: 'green' };

/**
 * CRM → Document templates (CD-13; the design's table since CD-524): the uploaded .docx templates
 * and the built-in proposal, each with a ⋯ menu; then the merge fields, with the starter template
 * to download and the full list behind "Show merge fields". Owners and admins upload and delete;
 * everyone can download. The design's "Used in" column isn't shown: the app doesn't track it.
 */
export function TemplatesSection() {
  const { s, session, set, flash, openDoc, loadTemplates, downloadTemplate, deleteTemplate, loadPlaceholders, downloadStarter } = useStore();
  const lead = s.leads[0];
  const canManage = canManageTemplates(session.tenant.role);
  const [ref, setRef] = useState<PlaceholderReference | null>(null);
  const [showFields, setShowFields] = useState(false);
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
    if (!(await askConfirm({ title: `Delete the template "${t.name}"?`, message: 'Documents already generated from it are kept.', confirmLabel: 'Delete', danger: true }))) return;
    void deleteTemplate(t);
  };
  const fields = [...(ref?.fields ?? []), ...(ref?.lineFields ?? [])];
  return (
    <Section
      title="Document templates"
      desc="Templates hold the fixed story; merge fields pull the rest from the opportunity when someone generates a document."
      action={
        <button type="button" className="gs-btn primary" onClick={() => (canManage ? set({ templateOpen: true, templateEditing: null }) : flash('Only owners and admins can add templates', 4000, true))}>
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
                          { label: 'Upload new version', onClick: () => set({ templateOpen: true, templateEditing: t }), testId: 'edit-template' },
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
    </Section>
  );
}
