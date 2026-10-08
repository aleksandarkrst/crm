import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChangeHistory } from '../components/ChangeHistory';
import { askConfirm } from '../components/ConfirmDialog';
import { Screen } from '../components/Layout';
import { Avatar, Modal, ModalHeader } from '../components/ui';
import { paths } from '../lib/paths';
import {
  type ApiWorkOrder,
  durationError,
  durationText,
  WORK_ORDER_PLACE_LABEL,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPE_LABEL,
  type WorkOrderPatch,
  type WorkOrderPlace,
  type WorkOrderStatus,
  type WorkOrderType,
  workOrderId,
  workOrdersApi,
  workOrderStatusLabel,
} from '../lib/workOrdersApi';
import { projectError, useProject, useProjects } from '../store/projects';
import { curOf, initialsOf } from '../store/selectors';
import { useStore } from '../store/store';
import { useWorkOrder, useWorkOrderChecklist } from '../store/workOrders';
import { NumberField, Row, TextField } from './project/fields';
import { PeoplePicker } from './task/parts';
import { ChecklistCard } from './task/TaskNotes';
import { HoldDialog } from './WorkOrders';

/** "Wed 30 Sept, 08:00–16:00", or nothing without a date. */
function whenText(w: Pick<ApiWorkOrder, 'scheduledDate' | 'scheduledStart' | 'durationHours'>): string | null {
  if (!w.scheduledDate) return null;
  const day = new Date(w.scheduledDate + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (!w.scheduledStart) return day;
  const [h, m] = w.scheduledStart.split(':').map(Number) as [number, number];
  const end = h * 60 + m + Math.round(w.durationHours * 60);
  const endText = `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  return `${day}, ${w.scheduledStart}–${endText}`;
}

/**
 * A work order's page (CD-266, design v2 §6):
 * - header: crumb "Work orders → (project) → WO-1044", the title (inline), the meta line, Put on
 *   hold and Mark completed (or Reopen), the status bar, and the On hold reason in a red box;
 * - Details (company, project, where, type, priority, equipment, site);
 * - Job, Schedule (technicians with a lead, date, start, duration), Checklist, Report and sign-off,
 *   History. Track time comes with milestone 15's time entries.
 * Whoever can change the order (owners, admins, the project lead, its technicians, its creator)
 * edits it; everyone else reads it.
 */
export function WorkOrder() {
  const { id = '' } = useParams();
  const { s, flash } = useStore();
  const navigate = useNavigate();
  const { data: order, error, set } = useWorkOrder(id);
  const { data: project } = useProject(order?.projectId ?? undefined);
  const { data: projects } = useProjects();
  const checklist = useWorkOrderChecklist(id);
  const [holding, setHolding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);

  if (!order) {
    return (
      <Screen title="Work order" parent={{ label: 'Work orders', to: paths.workOrders }}>
        <div className="hint-box">{error ? `Couldn't load this work order: ${error}` : 'Loading the work order'}</div>
      </Screen>
    );
  }

  // CD-148: a Completed order is locked until it is reopened; the status has its own rule.
  const canEdit = order.canChange && !order.locked;
  const canSetStatus = order.canSetStatus;
  const ref = workOrderId(order);
  const save = async (patch: WorkOrderPatch, message?: (w: ApiWorkOrder) => string): Promise<boolean> => {
    try {
      const saved = await workOrdersApi.update(order.id, patch);
      set(saved);
      if (message) flash(message(saved));
      return true;
    } catch (err) {
      flash(projectError(err));
      return false;
    }
  };
  const setStatus = (status: WorkOrderStatus) => {
    if (status === order.status) return;
    if (status === 'on_hold') return setHolding(true);
    void save({ status }, (w) => (status === 'completed' ? `${workOrderId(w)} completed` : `${workOrderId(w)} moved to ${workOrderStatusLabel(w.status)}`));
  };
  const technicianIds = order.technicians.map((t) => t.employeeId);
  const remove = async () => {
    setMenu(false);
    const yes = await askConfirm({ title: `Delete ${ref}?`, message: `${order.title}, its checklist and history are deleted.`, confirmLabel: 'Delete work order', danger: true });
    if (!yes) return;
    try {
      await workOrdersApi.remove(order.id);
      flash(`${ref} deleted`);
      navigate(paths.workOrders);
    } catch (err) {
      flash(projectError(err));
    }
  };

  const companyProjects = (projects ?? []).filter((p) => p.companyId === order.companyId && (p.status === 'open' || p.id === order.projectId));
  const meta = [order.companyName, order.projectName, project?.stageName, order.technicians.map((t) => t.name).join(', ') || 'No technician yet', whenText(order) ?? 'Not scheduled'].filter(Boolean).join(' · ');
  const at = WORK_ORDER_STATUSES.findIndex((x) => x.id === order.status);
  return (
    <Screen title="Work order" parent={{ label: 'Work orders', to: paths.workOrders }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-testid="work-order-page">
        <div className="card deal-header" style={{ padding: '16px 20px' }}>
          <div className="deal-crumb">
            <Link to={paths.workOrders} className="crumb-link">
              Work orders
            </Link>
            {order.projectId && (
              <>
                <span aria-hidden>→</span>
                <Link to={paths.project(order.projectId)} className="crumb-link">
                  {order.projectName}
                </Link>
              </>
            )}
            <span aria-hidden>→</span>
            <span style={{ color: 'var(--ink)' }}>{ref}</span>
          </div>
          <div className="deal-header-top">
            <TextField className="ghost deal-title" testId="work-order-title" label="Title" value={order.title} disabled={!canEdit} required maxLength={200} onSave={(title) => save({ title })} />
            <div className="deal-actions">
              {order.priority === 'urgent' && <span className="badge badge-danger">Urgent</span>}
              {order.status === 'completed' && <span className="badge badge-brand">Completed</span>}
              {canSetStatus &&
                (order.status === 'completed' ? (
                  <button type="button" className="btn btn-secondary" data-testid="reopen-work-order" onClick={() => setStatus('in_progress')}>
                    Reopen
                  </button>
                ) : (
                  <>
                    {order.status !== 'on_hold' && (
                      <button type="button" className="btn btn-outline" data-testid="hold-work-order" onClick={() => setStatus('on_hold')} style={{ fontSize: 13, padding: '9px 14px' }}>
                        Put on hold
                      </button>
                    )}
                    <button type="button" className="btn btn-primary" data-testid="complete-work-order" onClick={() => setStatus('completed')}>
                      Mark completed
                    </button>
                  </>
                ))}
              {order.canDelete && (
                <div ref={menuRef} style={{ position: 'relative' }}>
                  <button type="button" className="btn btn-secondary" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)} style={{ padding: '10px 12px' }}>
                    ⋯
                  </button>
                  {menu && (
                    <div className="deal-menu" role="menu">
                      <button type="button" role="menuitem" data-testid="delete-work-order" onClick={() => void remove()}>
                        Delete work order
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }} data-testid="work-order-meta">
            {meta}
          </span>
          <div className="stage-bar" data-testid="work-order-status-bar">
            {WORK_ORDER_STATUSES.map((st, i) => (
              <button
                key={st.id}
                type="button"
                className={'stage-chev' + (i === at ? ' current' : i < at ? ' done' : '')}
                title={i === at ? `${st.label} (current status)` : `Move to ${st.label}`}
                aria-current={i === at ? 'step' : undefined}
                disabled={i === at || !canSetStatus}
                onClick={() => setStatus(st.id)}
              >
                {st.label}
              </button>
            ))}
          </div>
          {order.status === 'on_hold' && (
            <div className="hold-box" data-testid="hold-box">
              <span style={{ fontWeight: 600 }}>On hold</span>
              <TextField className="ghost ghost-sm" label="Why the work is paused" value={order.holdReason ?? ''} disabled={!canSetStatus} required maxLength={200} onSave={(holdReason) => save({ holdReason }, (w) => `${workOrderId(w)} on hold · ${holdReason}`)} />
            </div>
          )}
          {order.locked && (
            <div className="hint-box" data-testid="work-order-locked">
              Completed{order.completedAt ? ` on ${new Date(order.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}. {canSetStatus ? 'Reopen it to change it.' : 'It can no longer be changed.'}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 320px', maxWidth: 540, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card card-pad">
              <span style={{ fontSize: 15, fontWeight: 600 }}>Details</span>
              <div className="project-fields" data-testid="work-order-details">
                <Row label="Company">
                  <Link to={paths.company(order.companyId)} className="crumb-link">
                    {order.companyName}
                  </Link>
                </Row>
                <Row label="Project">
                  <select className="ghost ghost-sm" aria-label="Project" data-testid="work-order-project" value={order.projectId ?? ''} disabled={!canEdit} onChange={(e) => void save({ projectId: e.target.value || null })}>
                    <option value="">None</option>
                    {companyProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    {order.projectId && !companyProjects.some((p) => p.id === order.projectId) && <option value={order.projectId}>{order.projectName}</option>}
                  </select>
                </Row>
                <Row label="Where">
                  <select className="ghost ghost-sm" aria-label="Where" data-testid="work-order-place" value={order.workPlace} disabled={!canEdit} onChange={(e) => void save({ workPlace: e.target.value as WorkOrderPlace })}>
                    {Object.entries(WORK_ORDER_PLACE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Site">
                  <TextField className="ghost ghost-sm" label="Site" value={order.location ?? ''} disabled={!canEdit} placeholder="Address or site" maxLength={300} onSave={(v) => save({ location: v || null })} />
                </Row>
                <Row label="Type">
                  <select className="ghost ghost-sm" aria-label="Type" value={order.type} disabled={!canEdit} onChange={(e) => void save({ type: e.target.value as WorkOrderType })}>
                    {Object.entries(WORK_ORDER_TYPE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Priority">
                  <select className="ghost ghost-sm" aria-label="Priority" data-testid="work-order-priority" value={order.priority} disabled={!canEdit} onChange={(e) => void save({ priority: e.target.value as 'normal' | 'urgent' })}>
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </Row>
                <Row label="Equipment">
                  <TextField className="ghost ghost-sm" label="Equipment" testId="work-order-equipment" value={order.equipment ?? ''} disabled={!canEdit} placeholder="e.g. 3 × split unit 3.5 kW" maxLength={300} onSave={(v) => save({ equipment: v || null })} />
                </Row>
              </div>
            </div>
          </div>

          <div style={{ flex: '999 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Job</span>
              <TextField multiline className="ghost ghost-sm" testId="work-order-job" label="Job" value={order.job ?? ''} disabled={!canEdit} placeholder="What needs doing on site" maxLength={10000} onSave={(v) => save({ job: v || null })} />
            </div>

            <div className="card card-pad" data-testid="work-order-schedule">
              <span style={{ fontSize: 15, fontWeight: 600 }}>Schedule</span>
              <div className="project-fields">
                <Row label="Technicians">
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1, minWidth: 0 }} data-testid="work-order-technicians">
                    {order.technicians.map((t) => (
                      <span key={t.employeeId} className="person-chip" data-employee={t.employeeId}>
                        <Avatar initials={initialsOf(t.name)} size={20} font={8.5} />
                        {t.name}
                        {t.isLead ? (
                          <span className="badge badge-brand" style={{ fontSize: 10.5 }}>
                            Lead
                          </span>
                        ) : (
                          canEdit && (
                            <button type="button" className="chip-action" title={`Make ${t.name} the lead`} onClick={() => void save({ technicianIds: [t.employeeId, ...technicianIds.filter((x) => x !== t.employeeId)] }, () => `${t.name} leads ${ref} now`)}>
                              Make lead
                            </button>
                          )
                        )}
                        {canEdit && (
                          <button type="button" aria-label={`Take ${t.name} off the work order`} onClick={() => void save({ technicianIds: technicianIds.filter((x) => x !== t.employeeId) }, () => `${t.name} is off ${ref}`)}>
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                    {canEdit && (
                      <button type="button" className="btn-outline" data-testid="add-technician" onClick={() => setAdding(true)} style={{ fontSize: 12.5, padding: '3px 10px' }}>
                        Add
                      </button>
                    )}
                    {!order.technicians.length && !canEdit && <span style={{ fontSize: 13, color: 'var(--muted)' }}>No technician yet</span>}
                  </span>
                </Row>
                <Row label="Date">
                  <input className="ghost ghost-sm" type="date" aria-label="Date" data-testid="work-order-date" value={order.scheduledDate ?? ''} disabled={!canEdit} onChange={(e) => void save(e.target.value ? { scheduledDate: e.target.value, scheduledStart: order.scheduledStart ?? '08:00' } : { scheduledDate: null, scheduledStart: null })} />
                </Row>
                <Row label="Start">
                  <input className="ghost ghost-sm" type="time" aria-label="Start" data-testid="work-order-start" value={order.scheduledStart ?? ''} disabled={!canEdit || !order.scheduledDate} onChange={(e) => e.target.value && void save({ scheduledStart: e.target.value })} />
                </Row>
                <Row label="Duration, h">
                  <NumberField
                    label="Duration in hours"
                    testId="work-order-duration"
                    value={String(order.durationHours)}
                    disabled={!canEdit}
                    step={0.25}
                    onSave={async (v) => {
                      const err = v == null ? 'Set a duration' : durationError(v);
                      if (err) {
                        flash(err);
                        return false;
                      }
                      return save({ durationHours: v! }, (w) => `${workOrderId(w)} takes ${durationText(w.durationHours)}`);
                    }}
                  />
                </Row>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>With a technician, a date and a start it is Scheduled.</span>
            </div>

            <ChecklistCard
              items={checklist.data}
              set={checklist.set}
              canEdit={canEdit}
              api={{ add: (text) => workOrdersApi.addItem(order.id, text), update: (itemId, patch) => workOrdersApi.updateItem(order.id, itemId, patch), remove: (itemId) => workOrdersApi.removeItem(order.id, itemId) }}
            />

            <ReportCard order={order} canEdit={canEdit} save={save} />

            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="caps">History</span>
              {/* Technician changes don't touch the order's version: they count as a change too. */}
              <ChangeHistory entity="work_order" id={order.id} cur={curOf(s)} rev={`${order.version}:${order.technicians.map((t) => `${t.employeeId}${t.isLead}`).join()}`} />
            </div>
          </div>
        </div>
      </div>
      {holding && (
        <HoldDialog
          order={order}
          onClose={() => setHolding(false)}
          onHold={async (holdReason) => {
            if (await save({ status: 'on_hold', holdReason }, (w) => `${workOrderId(w)} on hold · ${holdReason}`)) setHolding(false);
          }}
        />
      )}
      {adding && <AddTechniciansDialog order={order} onClose={() => setAdding(false)} onAdd={async (ids) => (await save({ technicianIds: [...technicianIds, ...ids] }, (w) => `${ids.length === 1 ? 'Technician' : `${ids.length} technicians`} added to ${workOrderId(w)}`)) && setAdding(false)} />}
    </Screen>
  );
}

/** Report and sign-off (design v2 §6): what was done, the materials, and the customer's sign-off. */
function ReportCard({ order, canEdit, save }: { order: ApiWorkOrder; canEdit: boolean; save: (patch: WorkOrderPatch, message?: (w: ApiWorkOrder) => string) => Promise<boolean> }) {
  const signed = !!order.signedOffAt;
  const when = order.signedOffAt ? new Date(order.signedOffAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className="card card-pad" data-testid="work-order-report" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>Report and sign-off</span>
      <span className="caps-muted">What was done</span>
      <TextField multiline className="ghost ghost-sm" testId="work-order-report-text" label="What was done" value={order.report ?? ''} disabled={!canEdit} placeholder="The work done, findings, what's left" maxLength={10000} onSave={(v) => save({ report: v || null })} />
      <span className="caps-muted">Materials</span>
      <TextField multiline className="ghost ghost-sm" testId="work-order-materials" label="Materials" value={order.materials ?? ''} disabled={!canEdit} placeholder="Parts and materials used" maxLength={5000} onSave={(v) => save({ materials: v || null })} />
      <div className="project-fields">
        <Row label="Customer">
          <TextField className="ghost ghost-sm" testId="work-order-customer" label="Customer's name" value={order.customerName ?? ''} disabled={!canEdit || signed} placeholder="Who signs for the customer" maxLength={200} onSave={(v) => save({ customerName: v || null })} />
        </Row>
      </div>
      {signed ? (
        <div className="signed-box" data-testid="signed-off">
          <span>
            Signed off by <b>{order.customerName}</b> on {when}
            {order.signedOffByName ? ` · recorded by ${order.signedOffByName}` : ''}
          </span>
          {canEdit && (
            <button type="button" className="crumb-link" style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0 }} onClick={() => void save({ signedOff: false }, (w) => `${workOrderId(w)} sign-off undone`)}>
              Undo
            </button>
          )}
        </div>
      ) : (
        canEdit && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className={order.customerName ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!order.customerName} data-testid="sign-off" onClick={() => void save({ signedOff: true }, (w) => `${workOrderId(w)} signed off by ${w.customerName}`)}>
              Customer signs off
            </button>
            {!order.customerName && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Write the customer&apos;s name first.</span>}
          </span>
        )
      )}
    </div>
  );
}

/** Add technicians: the project team first (when there's a project), then others; Service and Both only (CD-268). */
function AddTechniciansDialog({ order, onClose, onAdd }: { order: ApiWorkOrder; onClose: () => void; onAdd: (ids: string[]) => Promise<unknown> }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  return (
    <Modal maxWidth={520} onBackdrop={onClose}>
      <ModalHeader title={`Add technicians to ${workOrderId(order)}`} sub="Only people with the Service or Both work type are listed. The first technician leads." />
      <PeoplePicker
        kind="work_order"
        projectId={order.projectId}
        taken={new Set(order.technicians.map((t) => t.employeeId))}
        picked={picked}
        onToggle={(id) =>
          setPicked((cur) => {
            const next = new Set(cur);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
      />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={picked.size && !saving ? 'btn btn-primary' : 'btn btn-disabled'}
          disabled={!picked.size || saving}
          data-testid="add-technician-submit"
          onClick={async () => {
            setSaving(true);
            await onAdd([...picked]);
            setSaving(false);
          }}
        >
          {picked.size > 1 ? `Add ${picked.size} technicians` : 'Add technician'}
        </button>
      </div>
    </Modal>
  );
}
