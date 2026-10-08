import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Screen } from '../components/Layout';
import { FilterBar, Modal, ModalHeader } from '../components/ui';
import { paths } from '../lib/paths';
import {
  type ApiWorkOrder,
  durationText,
  WORK_ORDER_HOLD_REASONS,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPE_LABEL,
  type WorkOrderPatch,
  workOrderId,
  workOrdersApi,
  workOrderStatusLabel,
  type WorkOrderStatus,
  type WorkOrderType,
} from '../lib/workOrdersApi';
import { projectError } from '../store/projects';
import { useStore } from '../store/store';
import { scheduledText, useWorkOrders } from '../store/workOrders';
import { AvatarStack } from './task/parts';

type View = 'kanban' | 'table';
const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'kanban', label: 'Kanban', icon: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v7h-4z' },
  { id: 'table', label: 'Table', icon: 'M4 6h16M4 12h16M4 18h16' },
];
const viewKey = (userId: string, tenantId: string) => `crm.workOrdersView.${userId}.${tenantId}`;
const PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'normal', label: 'Normal' },
];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Work orders (CD-265, design v2 §5): every work order. Kanban (Unscheduled · Scheduled · In
 * progress · On hold · Completed; drag a card to change its status, On hold asks why) or Table
 * (status inline). Filters: technician ("Me" too), type, priority and company. The view is
 * remembered per person and workspace.
 */
export function WorkOrders() {
  const { s, set, session, flash } = useStore();
  const { data: orders, error, set: setOrders } = useWorkOrders();
  const [view, setViewState] = useState<View>(() => {
    try {
      return localStorage.getItem(viewKey(session.userId, session.tenant.id)) === 'table' ? 'table' : 'kanban';
    } catch {
      return 'kanban';
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(viewKey(session.userId, session.tenant.id), v);
    } catch {
      // No storage: the choice lasts until the page is left.
    }
  };
  const [technician, setTechnician] = useState('Technician');
  const [type, setType] = useState('Type');
  const [priority, setPriority] = useState('Priority');
  const [company, setCompany] = useState('Company');
  const [holding, setHolding] = useState<ApiWorkOrder | null>(null);

  const me = s.team.find((m) => m.id === session.userId)?.employeeId ?? null;
  const all = orders ?? [];
  const sortedPairs = (pairs: [string, string][]) => [...new Map(pairs).entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  const people = sortedPairs(all.flatMap((w) => w.technicians.map((t) => [t.employeeId, t.name] as [string, string]))).filter((p) => p.value !== me);
  const companies = sortedPairs(all.map((w) => [w.companyId, w.companyName]));
  const shown = all
    .filter((w) => technician === 'Technician' || w.technicians.some((t) => t.employeeId === (technician === 'me' ? me : technician)))
    .filter((w) => type === 'Type' || w.type === type)
    .filter((w) => priority === 'Priority' || w.priority === priority)
    .filter((w) => company === 'Company' || w.companyId === company);
  const dirty = technician !== 'Technician' || type !== 'Type' || priority !== 'Priority' || company !== 'Company';

  const save = async (order: ApiWorkOrder, patch: WorkOrderPatch, message: (w: ApiWorkOrder) => string): Promise<boolean> => {
    try {
      const saved = await workOrdersApi.update(order.id, patch);
      setOrders((orders ?? []).map((x) => (x.id === saved.id ? saved : x)));
      flash(message(saved));
      return true;
    } catch (err) {
      flash(projectError(err));
      return false;
    }
  };
  const setStatus = (order: ApiWorkOrder, status: WorkOrderStatus) => {
    if (status === order.status) return;
    if (!order.canSetStatus) return flash('Only the technicians, the project lead, owners and admins change the status');
    if (status === 'on_hold') return setHolding(order);
    void save(order, { status }, (w) => `${workOrderId(w)} moved to ${workOrderStatusLabel(status)}`);
  };

  return (
    <Screen title="Work orders">
      <FilterBar
        lead={
          <div className="view-toggle" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" title={v.label} aria-label={v.label} aria-pressed={view === v.id} data-testid={`work-orders-view-${v.id}`} onClick={() => setView(v.id)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={v.icon} />
                </svg>
              </button>
            ))}
          </div>
        }
        chips={[
          { value: technician, options: ['Technician', ...(me ? [{ value: 'me', label: 'Me' }] : []), ...people], onChange: setTechnician },
          { value: type, options: ['Type', ...(Object.keys(WORK_ORDER_TYPE_LABEL) as WorkOrderType[]).map((value) => ({ value, label: WORK_ORDER_TYPE_LABEL[value] }))], onChange: setType },
          { value: priority, options: ['Priority', ...PRIORITIES], onChange: setPriority },
          { value: company, options: ['Company', ...companies], onChange: setCompany },
        ]}
        dirty={dirty}
        onClear={() => {
          setTechnician('Technician');
          setType('Type');
          setPriority('Priority');
          setCompany('Company');
        }}
        meta={orders ? plural(shown.length, 'work order') : undefined}
        action={{ label: 'New work order', onClick: () => set({ newWorkOrder: {} }) }}
      />

      {!orders ? (
        <div className="hint-box">{error ? `Couldn't load work orders: ${error}` : 'Loading work orders'}</div>
      ) : view === 'table' ? (
        <WorkOrdersTable orders={shown} onStatus={setStatus} />
      ) : (
        <>
          <WorkOrderBoard orders={shown} onDrop={setStatus} />
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '10px 0 0' }}>Drag a work order to change its status. Set technicians and a time on the work order to schedule it.</p>
        </>
      )}
      {holding && (
        <HoldDialog
          order={holding}
          onClose={() => setHolding(null)}
          onHold={async (reason) => {
            if (await save(holding, { status: 'on_hold', holdReason: reason }, (w) => `${workOrderId(w)} on hold · ${reason}`)) setHolding(null);
          }}
        />
      )}
    </Screen>
  );
}

/** "Company · site" for a card or row. */
const siteOf = (w: ApiWorkOrder) => [w.companyName, w.location].filter(Boolean).join(' · ');

function WorkOrderBoard({ orders, onDrop }: { orders: ApiWorkOrder[]; onDrop: (w: ApiWorkOrder, status: WorkOrderStatus) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="task-board" data-testid="work-order-board">
      {WORK_ORDER_STATUSES.map((col) => {
        const cards = orders.filter((w) => w.status === col.id);
        return (
          <div
            key={col.id}
            className={'task-column' + (over === col.id ? ' over' : '')}
            data-testid="work-order-column"
            data-column={col.label}
            onDragOver={(e) => {
              e.preventDefault();
              if (over !== col.id) setOver(col.id);
            }}
            onDragLeave={() => over === col.id && setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain') || dragId;
              setDragId(null);
              setOver(null);
              const w = orders.find((x) => x.id === id);
              if (w && w.status !== col.id) onDrop(w, col.id);
            }}
          >
            <div className="task-column-head">
              <span style={{ width: 8, height: 8, borderRadius: 4, background: col.dot, flex: '0 0 8px' }} />
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{col.label}</span>
              <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{cards.length}</span>
            </div>
            <div className="task-column-body">
              {cards.map((w) => (
                <div
                  key={w.id}
                  className="task-card"
                  data-testid="work-order-card"
                  data-work-order={workOrderId(w)}
                  draggable={w.canSetStatus}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', w.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(w.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  style={{ opacity: dragId === w.id ? 0.45 : 1 }}
                >
                  <span className="task-card-project" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {workOrderId(w)}
                    {w.priority === 'urgent' && (
                      <span className="badge badge-danger" data-testid="urgent-badge">
                        Urgent
                      </span>
                    )}
                  </span>
                  <Link to={paths.workOrder(w.id)} className="task-card-name">
                    {w.title}
                  </Link>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{siteOf(w)}</span>
                  {w.status === 'on_hold' && w.holdReason && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{w.holdReason}</span>}
                  <span className="task-card-foot">
                    <AvatarStack names={w.technicians.map((t) => t.name)} size={22} />
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-2)' }}>{scheduledText(w) ?? ''}</span>
                  </span>
                </div>
              ))}
              {cards.length === 0 && <div className="empty-dashed">No work orders</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The table view (design v2 §5): ID, Work order, Site, Project, Technician, Scheduled, Type, Status (inline). */
function WorkOrdersTable({ orders, onStatus }: { orders: ApiWorkOrder[]; onStatus: (w: ApiWorkOrder, s: WorkOrderStatus) => void }) {
  return (
    <div className="pipeline-table" data-testid="work-orders-table">
      <div className="work-orders-table-inner">
        <div className="table-head caps">
          <span>ID</span>
          <span>Work order</span>
          <span>Site</span>
          <span>Project</span>
          <span>Technician</span>
          <span>Scheduled</span>
          <span>Type</span>
          <span>Status</span>
        </div>
        {orders.length === 0 && <div className="pipeline-table-empty">No work orders match these filters.</div>}
        {orders.map((w) => (
          <div key={w.id} className="table-row" data-testid="work-orders-row" data-work-order={workOrderId(w)}>
            <span style={{ color: 'var(--text-2)' }}>{workOrderId(w)}</span>
            <span className="pt-cell">
              <Link to={paths.workOrder(w.id)} className="pt-main crumb-link" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                {w.title}
              </Link>
              {w.priority === 'urgent' && <span className="pt-sub" style={{ color: 'var(--danger)' }}>Urgent</span>}
            </span>
            <span className="pt-main" style={{ color: 'var(--text-2)' }}>
              {siteOf(w)}
            </span>
            <span className="pt-main">
              {w.projectId ? (
                <Link to={paths.project(w.projectId)} className="crumb-link">
                  {w.projectName}
                </Link>
              ) : (
                '—'
              )}
            </span>
            <span>
              <AvatarStack names={w.technicians.map((t) => t.name)} size={22} />
            </span>
            <span style={{ color: 'var(--text-2)' }}>{scheduledText(w) ? `${scheduledText(w)} · ${durationText(w.durationHours)}` : '—'}</span>
            <span style={{ color: 'var(--text-2)' }}>{WORK_ORDER_TYPE_LABEL[w.type]}</span>
            <span>
              <select className="ghost ghost-sm" aria-label={`Status of ${workOrderId(w)}`} data-testid="work-order-status-select" value={w.status} disabled={!w.canSetStatus} onChange={(e) => onStatus(w, e.target.value as WorkOrderStatus)}>
                {WORK_ORDER_STATUSES.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </select>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Design v2 §6: "Put WO-1044 on hold" with the reason presets or the person's own words. */
export function HoldDialog({ order, onClose, onHold }: { order: ApiWorkOrder; onClose: () => void; onHold: (reason: string) => Promise<void> }) {
  const [preset, setPreset] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);
  const reason = preset === 'Other' ? other.trim() : preset;
  return (
    <Modal maxWidth={480} onBackdrop={onClose}>
      <ModalHeader title={`Put ${workOrderId(order)} on hold`} sub="The work order stays with its technician. Tell the team why the work is paused." />
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }} data-testid="hold-reasons">
        {[...WORK_ORDER_HOLD_REASONS, 'Other'].map((r) => (
          <button key={r} type="button" className={'reason-pill' + (preset === r ? ' on' : '')} aria-pressed={preset === r} onClick={() => setPreset(r)}>
            {r}
          </button>
        ))}
      </div>
      {preset === 'Other' && <input className="form-input" autoFocus maxLength={200} placeholder="Why is the work paused?" value={other} onChange={(e) => setOther(e.target.value)} data-testid="hold-other" />}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={reason && !saving ? 'btn btn-primary' : 'btn btn-disabled'}
          disabled={!reason || saving}
          data-testid="confirm-hold"
          onClick={async () => {
            if (!reason) return;
            setSaving(true);
            await onHold(reason);
            setSaving(false);
          }}
        >
          Put on hold
        </button>
      </div>
    </Modal>
  );
}
