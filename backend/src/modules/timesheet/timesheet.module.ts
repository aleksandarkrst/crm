import { Module } from '@nestjs/common';
import { PeopleModule } from '../people';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { TimesheetDeadlines } from './deadlines';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';
import { TeamStatusController } from './team-status.controller';
import { TeamStatusService } from './team-status.service';
import { TimesheetController } from './timesheet.controller';
import { TimesheetService } from './timesheet.service';

/**
 * Timesheet (milestone 15, Workforce): weekly time entry on tasks and work orders (CD-152, CD-276),
 * public holidays and the submission deadline (CD-153), approvals (CD-157). Who may log on what is
 * the projects module's rule; the lock is the trigger on time_entries.
 */
@Module({
  imports: [PeopleModule],
  controllers: [TimesheetController, HolidaysController, ApprovalsController, TeamStatusController],
  providers: [TimesheetService, HolidaysService, TimesheetDeadlines, ApprovalsService, TeamStatusService],
})
export class TimesheetModule {}
