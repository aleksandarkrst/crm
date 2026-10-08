import { Module } from '@nestjs/common';
import { PeopleModule } from '../people';
import { ProjectFilesController } from './project-files.controller';
import { ProjectFilesService } from './project-files.service';
import { ProjectMembersService } from './project-members.service';
import { ProjectTypesController } from './project-types.controller';
import { ProjectTypesService } from './project-types.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TaskNotesService } from './task-notes.service';
import { TasksController } from './tasks.controller';
import { TechniciansController } from './technicians.controller';
import { TasksService } from './tasks.service';

/**
 * Projects (milestone 14): project types with stages (CD-272) and client projects linked to the
 * CRM (CD-233, slimmed for CD-275), their team, files and tasks (CD-271, CD-146). Time comes with
 * milestone 15.
 */
@Module({
  imports: [PeopleModule],
  controllers: [ProjectTypesController, ProjectsController, ProjectFilesController, TasksController, TechniciansController],
  providers: [ProjectTypesService, ProjectsService, ProjectMembersService, ProjectFilesService, TasksService, TaskNotesService],
})
export class ProjectsModule {}
