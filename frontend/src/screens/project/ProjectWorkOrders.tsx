import { Link } from 'react-router-dom';
import { paths } from '../../lib/paths';
import { durationText, WORK_ORDER_STATUSES, WORK_ORDER_TYPE_LABEL, workOrderId } from '../../lib/workOrdersApi';
import { useStore } from '../../store/store';
import { scheduledText, useWorkOrders } from '../../store/workOrders';
import { AvatarStack } from '../task/parts';

/**
 * The project's work orders under its Plan (CD-263, design v2 §2): ID, Work order, Technician,
 * Scheduled, Type and Status, and "New work order" with the project filled in. The status changes
 * on the work order's page or the Work orders board.
 */
export function ProjectWorkOrders({ projectId, canAdd }: { projectId: string; canAdd: boolean }) {
  const { set } = useStore();
  const { data: orders, error } = useWorkOrders({ projectId });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="project-work-orders">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="caps">Work orders{orders?.length ? ` · ${orders.length}` : ''}</span>
        {canAdd && (
          <button type="button" className="btn btn-outline" data-testid="project-new-work-order" onClick={() => set({ newWorkOrder: { projectId } })} style={{ marginLeft: 'auto', fontSize: 13, padding: '8px 14px' }}>
            New work order
          </button>
        )}
      </div>
      {!orders ? (
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{error ? `Couldn't load work orders: ${error}` : 'Loading work orders'}</span>
      ) : orders.length === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>No work orders on this project yet.</span>
      ) : (
        <div className="pipeline-table">
          <div className="project-work-orders-inner">
            <div className="table-head caps">
              <span>ID</span>
              <span>Work order</span>
              <span>Technician</span>
              <span>Scheduled</span>
              <span>Type</span>
              <span>Status</span>
            </div>
            {orders.map((w) => {
              const status = WORK_ORDER_STATUSES.find((x) => x.id === w.status)!;
              return (
                <div key={w.id} className="table-row" data-testid="project-work-order-row" data-work-order={workOrderId(w)}>
                  <span style={{ color: 'var(--text-2)' }}>{workOrderId(w)}</span>
                  <span className="pt-cell">
                    <Link to={paths.workOrder(w.id)} className="pt-main crumb-link" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                      {w.title}
                    </Link>
                    {w.priority === 'urgent' && <span className="pt-sub" style={{ color: 'var(--danger)' }}>Urgent</span>}
                  </span>
                  <span>{w.technicians.length ? <AvatarStack names={w.technicians.map((t) => t.name)} size={22} /> : <span style={{ color: 'var(--text-2)' }}>Assign later</span>}</span>
                  <span style={{ color: 'var(--text-2)' }}>{scheduledText(w) ? `${scheduledText(w)} · ${durationText(w.durationHours)}` : '—'}</span>
                  <span style={{ color: 'var(--text-2)' }}>{WORK_ORDER_TYPE_LABEL[w.type]}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: status.dot }} />
                    {status.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
