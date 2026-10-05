export { CrmModule } from './crm.module';
export { DealsService } from './deals/deals.service';
export { DocumentGenerator } from './documents/document-generator';
export { CrmWorkerModule } from './meetings/meeting-jobs';
export { periodLabel as visitPlanPeriodLabel, periodOf as visitPeriodOf, periodStartOf as visitPeriodStartOf } from './visit-plans/periods';
export { countVisits, type VisitTotals } from './visit-plans/visit-counting';
export { planGroupsOf, progressOfGroups, progressOfPlans } from './visit-plans/visit-progress.service';
