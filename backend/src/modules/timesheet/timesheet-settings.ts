import type { Tx } from '../../shared/database/database.service';
import { DEFAULT_TIMESHEET_SETTINGS, type TimesheetSettings } from './timesheet-rules';

/**
 * The workspace's timesheet settings: the one read every rule uses. Fixed defaults until CD-153
 * stores them (Settings → Workforce): 8 h Monday to Friday, 7.50, 12 h a day, due Friday 17:00.
 */
export function timesheetSettings(_tx: Tx, _tenantId: string): Promise<TimesheetSettings> {
  return Promise.resolve(DEFAULT_TIMESHEET_SETTINGS);
}
