import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, ModalHeader } from '../components/ui';
import { paths } from '../lib/paths';
import { projectsApi } from '../lib/projectsApi';
import { projectError, useProjectTypes } from '../store/projects';
import { companyLabels, companyRecords, memberLabels } from '../store/selectors';
import { useStore } from '../store/store';
import { useTerms } from '../store/terms';

/**
 * New project (CD-234, CD-275; design v2 §11 and "Dialogs"). Opened with `s.newProject`:
 * - from a won deal ("Create project"): "New project from deal", the deal and its company fixed,
 *   the name starting as the deal's title;
 * - from a company page ("+ Project"): the company fixed;
 * - from the Projects board or the "+" menu: pick the company.
 * The deal picker lists the company's won deals first, then open ones marked "Open"; lost deals
 * aren't offered (spec 3.2). Nothing is created until Create project. "Add starter tasks from the
 * products" comes with project tasks (CD-146).
 */
export function NewProjectDialog() {
  const { s, set, session, flash } = useStore();
  const terms = useTerms();
  const navigate = useNavigate();
  const seed = s.newProject ?? {};
  const fromDeal = seed.dealId ? s.leads.find((l) => l.id === seed.dealId) : undefined;
  const { data: types, error } = useProjectTypes();
  const records = companyRecords(s);
  const labels = companyLabels(records);

  const [companyId, setCompanyId] = useState(fromDeal?.companyId ?? seed.companyId ?? '');
  const [dealId, setDealId] = useState(fromDeal?.id ?? '');
  const [name, setName] = useState(fromDeal ? fromDeal.title || fromDeal.company : '');
  const [typeId, setTypeId] = useState('');
  const [leadUserId, setLeadUserId] = useState(session.userId);
  const [code, setCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const close = () => set({ newProject: null });

  const type = types?.find((t) => t.id === typeId) ?? types?.[0];
  const leads = [...memberLabels(s)].map(([value, label]) => ({ value, label }));
  const companyDeals = s.leads
    .filter((l) => l.companyId === companyId && l.outcome !== 'lost')
    .sort((a, b) => Number(b.outcome === 'won') - Number(a.outcome === 'won') || (a.title || '').localeCompare(b.title || ''));
  const dealName = fromDeal ? fromDeal.title || fromDeal.company : '';
  const blocked = fromDeal && !fromDeal.companyId
    ? `Add a company to the deal first: ${terms.aProject} always belongs to a company.`
    : !companyId
      ? `Pick the company the ${terms.project} is for.`
      : !name.trim()
        ? `Give the ${terms.project} a name.`
        : startDate && endDate && endDate < startDate
          ? "The end date can't be before the start date."
          : null;

  const create = async () => {
    if (blocked || !type || saving) return;
    setSaving(true);
    try {
      const project = await projectsApi.createProject({
        name: name.trim(),
        projectTypeId: type.id,
        companyId,
        dealId: dealId || null,
        leadUserId,
        code: code.trim() || null,
        startDate: startDate || null,
        endDate: endDate || null,
      });
      flash(fromDeal ? `${terms.Project} created from ${dealName}` : `${terms.Project} ${project.name} created`);
      close();
      navigate(paths.project(project.id));
    } catch (err) {
      flash(projectError(err));
      setSaving(false);
    }
  };

  const companyName = records.find((r) => r.id === companyId)?.name;
  return (
    <Modal maxWidth={600} onBackdrop={close}>
      <ModalHeader
        title={fromDeal ? `New ${terms.project} from deal` : `New ${terms.project}`}
        sub={fromDeal ? `The company, contact, emails and files from the deal are linked to the ${terms.project}.` : `${terms.AProject} for one of your companies, optionally linked to the deal it came from. Nothing is created until you save.`}
      />
      {fromDeal ? (
        <div className="hint-box" data-testid="project-deal-summary" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{fromDeal.company}</span>
          <span>·</span>
          <span>{dealName}</span>
          <span>·</span>
          <span style={{ color: 'var(--brand)' }}>{fromDeal.value}</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label className="form-label">
            Company
            {seed.companyId ? (
              <input className="form-input" value={companyName ?? ''} disabled data-testid="project-company-fixed" />
            ) : (
              <select
                className="form-input"
                data-testid="project-company"
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setDealId('');
                }}
              >
                <option value="">Pick a company</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {labels.get(r.id) ?? r.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="form-label">
            Deal
            <select
              className="form-input"
              data-testid="project-deal"
              value={dealId}
              disabled={!companyId}
              onChange={(e) => {
                setDealId(e.target.value);
                const d = s.leads.find((l) => l.id === e.target.value);
                if (d && !name.trim()) setName(d.title || d.company);
              }}
            >
              <option value="">No deal</option>
              {companyDeals.map((l) => (
                <option key={l.id} value={l.id}>
                  {(l.title || l.company) + (l.outcome === 'won' ? '' : ' · Open')}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label className="form-label">
        {terms.Project} name
        <input className="form-input" data-testid="project-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="e.g. Service 2026" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label className="form-label">
          {terms.Project} type
          <select className="form-input" data-testid="project-type" value={type?.id ?? ''} onChange={(e) => setTypeId(e.target.value)} disabled={!types}>
            {(types ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          {terms.Project} lead
          <select className="form-input" data-testid="project-lead" value={leadUserId} onChange={(e) => setLeadUserId(e.target.value)}>
            {leads.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!fromDeal && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <label className="form-label">
            Code
            <input className="form-input" data-testid="project-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} placeholder="Optional" />
          </label>
          <label className="form-label">
            Start
            <input className="form-input" type="date" data-testid="project-start" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="form-label">
            End
            <input className="form-input" type="date" data-testid="project-end" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caps">Stages</span>
        <span data-testid="project-stages" style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {error ? `Couldn't load ${terms.project} types: ${error}` : type ? type.stages.map((st) => st.name).join(' → ') : 'Loading'}
        </span>
      </div>
      {fromDeal && !fromDeal.companyId && <div className="hint-box">{blocked}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className={blocked || !type || saving ? 'btn btn-disabled' : 'btn btn-primary'}
          disabled={!!blocked || !type || saving}
          title={blocked ?? undefined}
          data-testid="create-project-submit"
          onClick={() => void create()}
        >
          {saving ? 'Creating…' : `Create ${terms.project}`}
        </button>
      </div>
    </Modal>
  );
}
