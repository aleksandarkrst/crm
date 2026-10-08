import { useEffect, useState } from 'react';
import { Avatar, Modal, ModalHeader } from '../components/ui';
import { orgApi, type ApiDirectoryRow } from '../lib/orgApi';
import { durationError, WORK_ORDER_TYPE_LABEL, type WorkOrderPriority, type WorkOrderType, workOrderId, workOrdersApi } from '../lib/workOrdersApi';
import { projectError, useProjects } from '../store/projects';
import { companyLabels, companyRecords, initialsOf } from '../store/selectors';
import { useStore } from '../store/store';
import { useTerms } from '../store/terms';

/**
 * New work order (CD-265, design v2 §6). Opened with `s.newWorkOrder`: from a project the project
 * (and its company) is fixed, from a company page the company. Technicians: only people with the
 * Service or Both work type (CD-268); leave them empty to schedule later. With technicians, a date
 * and a start time it is Scheduled. The first technician picked is the lead.
 */
export function NewWorkOrderDialog() {
  const { s, set, flash } = useStore();
  const terms = useTerms();
  const seed = s.newWorkOrder ?? {};
  const { data: projects } = useProjects();
  const records = companyRecords(s);
  const labels = companyLabels(records);
  const seedProject = seed.projectId ? projects?.find((p) => p.id === seed.projectId) : undefined;

  const [title, setTitle] = useState('');
  const [companyId, setCompanyId] = useState(seed.companyId ?? '');
  const [projectId, setProjectId] = useState(seed.projectId ?? '');
  const [type, setType] = useState<WorkOrderType>('repair');
  const [priority, setPriority] = useState<WorkOrderPriority>('normal');
  const [duration, setDuration] = useState('2');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [people, setPeople] = useState<ApiDirectoryRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const close = () => set({ newWorkOrder: null });

  useEffect(() => {
    orgApi
      .directory()
      // Work orders go to service staff (CD-268): Service and Both.
      .then((rows) => setPeople(rows.filter((r) => r.status !== 'inactive' && r.workType !== 'office')))
      .catch(() => setPeople([]));
  }, []);
  // A project fixes the company.
  const company = seedProject?.companyId ?? companyId;
  const projectsOfCompany = (projects ?? []).filter((p) => p.companyId === company && p.status === 'open');

  const durationNumber = Number(duration);
  const timeError = !!date !== !!start ? 'Set both the date and the start, or neither.' : null;
  const blocked = !title.trim() ? 'Give the work order a title.' : !company ? 'Pick the company.' : durationError(durationNumber) ?? timeError;

  const create = async () => {
    if (blocked || saving) return;
    setSaving(true);
    try {
      const order = await workOrdersApi.create({
        title: title.trim(),
        companyId: company,
        projectId: projectId || null,
        type,
        priority,
        technicianIds: picked,
        scheduledDate: date || null,
        scheduledStart: start || null,
        durationHours: durationNumber,
      });
      flash(`${workOrderId(order)} ${order.title} added`);
      close();
    } catch (err) {
      flash(projectError(err));
      setSaving(false);
    }
  };

  return (
    <Modal maxWidth={600} onBackdrop={close}>
      <ModalHeader title="New work order" sub="Service work for a company: installation, repair, maintenance or an inspection." />
      <label className="form-label">
        Title
        <input className="form-input" autoFocus data-testid="work-order-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Replace the compressor" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label className="form-label">
          Company
          {seedProject ? (
            <input className="form-input" value={seedProject.companyName} disabled />
          ) : (
            <select
              className="form-input"
              data-testid="work-order-company"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setProjectId('');
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
          {terms.Project}
          <select className="form-input" data-testid="work-order-project" value={projectId} disabled={!!seed.projectId || !company} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No {terms.project}</option>
            {(seedProject ? [seedProject] : projectsOfCompany).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Type
          <select className="form-input" data-testid="work-order-type" value={type} onChange={(e) => setType(e.target.value as WorkOrderType)}>
            {(Object.keys(WORK_ORDER_TYPE_LABEL) as WorkOrderType[]).map((t) => (
              <option key={t} value={t}>
                {WORK_ORDER_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Priority
          <select className="form-input" data-testid="work-order-priority" value={priority} onChange={(e) => setPriority(e.target.value as WorkOrderPriority)}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label className="form-label">
          Duration (h)
          <input className="form-input" type="number" min={0.25} step={0.25} data-testid="work-order-duration" value={duration} onChange={(e) => setDuration(e.target.value)} />
          {durationError(durationNumber) && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{durationError(durationNumber)}</span>}
        </label>
        <label className="form-label">
          Date
          <input className="form-input" type="date" data-testid="work-order-date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="form-label">
          Start
          <input className="form-input" type="time" data-testid="work-order-start" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
      </div>
      {timeError && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{timeError}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caps">Technicians{picked.length ? ` · ${picked.length}` : ' · assign later'}</span>
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }} data-testid="technician-list">
          {!people ? (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--text-2)' }}>Loading people</div>
          ) : people.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--text-2)' }}>No one has the Service work type yet. Set it in Settings → Technicians.</div>
          ) : (
            people.map((p) => (
              <label key={p.id} data-employee={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: '1px solid var(--divider)', cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => setPicked((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))} />
                <Avatar initials={initialsOf(p.fullName)} size={24} font={9.5} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{p.fullName}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{[p.jobTitle, p.unitName].filter(Boolean).join(' · ')}</span>
                </span>
                {picked[0] === p.id && picked.length > 1 && <span className="badge">Lead</span>}
              </label>
            ))
          )}
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Only people with the Service work type are listed. Leave the technicians empty to schedule it later. The first one picked leads.</span>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Cancel
        </button>
        <button type="button" className={blocked || saving ? 'btn btn-disabled' : 'btn btn-primary'} disabled={!!blocked || saving} title={blocked ?? undefined} data-testid="create-work-order-submit" onClick={() => void create()}>
          {saving ? 'Adding…' : 'Add work order'}
        </button>
      </div>
    </Modal>
  );
}
