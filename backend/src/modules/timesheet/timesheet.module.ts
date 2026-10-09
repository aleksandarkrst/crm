import { Module } from '@nestjs/common';
import { PeopleModule } from '../people';
import { TimesheetController } from './timesheet.controller';
import { TimesheetService } from './timesheet.service';

/**
 * Timesheet (milestone 15, Workforce): weekly time entry on tasks and work orders (CD-152). Who may
 * log on what is the projects module's rule; the lock is the trigger on time_entries.
 */
@Module({
  imports: [PeopleModule],
  controllers: [TimesheetController],
  providers: [TimesheetService],
})
export class TimesheetModule {}
