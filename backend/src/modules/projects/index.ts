// The projects module's public API (milestone 14). Other modules import only from here.
export { ProjectsModule } from './projects.module';
export { DEFAULT_PROJECT_TYPE } from './project-types.service';
export { ProjectsWorkerModule } from './project-jobs';
// Milestone 15's timesheets use these; they don't reimplement who may log time (CD-146).
export { canLogTime, loggableTasks, type LogTimeRefusal, logTimeRefusalFor } from './task-log';
