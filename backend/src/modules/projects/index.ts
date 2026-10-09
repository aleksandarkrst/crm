// The projects module's public API (milestone 14). Other modules import only from here.
export { ProjectsModule } from './projects.module';
export { DEFAULT_PROJECT_TYPE } from './project-types.service';
export { ProjectsWorkerModule } from './project-jobs';
export { ProjectsDevModule } from './project-dev';
// Milestone 15's timesheets use these; they don't reimplement who may log time (CD-146).
export { canLogTime, loggableTasks, type LogTimeRefusal, logTimeRefusal, logTimeRefusalFor } from './task-log';
// Hour limits (CD-149): Block mode's refusal for an entry on a task.
export { hourLimitBlock } from './hour-limits';
export { canLogWorkOrderTime, loggableWorkOrders, type WorkOrderLogRefusal, workOrderLogRefusal, workOrderLogRefusalFor } from './work-order-log';
