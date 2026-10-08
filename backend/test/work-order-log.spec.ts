import { describe, expect, it } from 'vitest';
import { workOrderLogRefusal } from '../src/modules/projects/work-order-log';

describe('canLogWorkOrderTime (CD-148)', () => {
  it('a technician may log time until the order is Completed', () => {
    for (const status of ['unscheduled', 'scheduled', 'in_progress', 'on_hold']) expect(workOrderLogRefusal({ status, isTechnician: true })).toBeNull();
    expect(workOrderLogRefusal({ status: 'completed', isTechnician: true })).toBe('completed');
  });

  it('refuses someone who is not on the order, and a missing order', () => {
    expect(workOrderLogRefusal({ status: 'in_progress', isTechnician: false })).toBe('not_technician');
    expect(workOrderLogRefusal(null)).toBe('not_found');
  });
});
