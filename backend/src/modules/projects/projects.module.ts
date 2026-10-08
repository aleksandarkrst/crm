import { Module } from '@nestjs/common';
import { ProjectFilesController } from './project-files.controller';
import { ProjectFilesService } from './project-files.service';
import { ProjectMembersService } from './project-members.service';
import { ProjectTypesController } from './project-types.controller';
import { ProjectTypesService } from './project-types.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/**
 * Projects (milestone 14): project types with stages (CD-272) and client projects linked to the
 * CRM (CD-233, slimmed for CD-275). Tasks, time and the rest of CD-144 come later.
 */
@Module({
  controllers: [ProjectTypesController, ProjectsController, ProjectFilesController],
  providers: [ProjectTypesService, ProjectsService, ProjectMembersService, ProjectFilesService],
})
export class ProjectsModule {}
