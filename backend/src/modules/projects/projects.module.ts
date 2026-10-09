import { Module } from '@nestjs/common';
import { PeopleModule } from '../people';
import { ProjectFilesController } from './project-files.controller';
import { ProjectFilesService } from './project-files.service';
import { ProjectMembersService } from './project-members.service';
import { ProjectReportsService } from './project-reports.service';
import { ProjectTypesController } from './project-types.controller';
import { ProjectTypesService } from './project-types.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TaskNotesService } from './task-notes.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TechniciansController } from './technicians.controller';
import { TimeReportController } from './time-report.controller';
import { TimeReportService } from './time-report.service';
import { WorkloadController } from './workload.controller';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';

/**
 * Projects (milestone 14): project types with stages (CD-272) and client projects linked to the
 * CRM (CD-233, slimmed for CD-275), their team, files and tasks (CD-271, CD-146), and the time
 * report against hour limits (CD-149).
 */
@Module({
  imports: [PeopleModule],
  controllers: [ProjectTypesController, ProjectsController, ProjectFilesController, TasksController, TechniciansController, TimeReportController, WorkloadController, WorkOrdersController],
  providers: [ProjectTypesService, ProjectsService, ProjectMembersService, ProjectFilesService, TasksService, TaskNotesService, TimeReportService, ProjectReportsService, WorkOrdersService],
})
export class ProjectsModule {}
