export { CrmModule } from './crm.module';
export { DealsService } from './deals/deals.service';
export { DocumentGenerator } from './documents/document-generator';
export { CrmWorkerModule } from './meetings/meeting-jobs';
export { periodLabel as visitPlanPeriodLabel, periodOf as visitPeriodOf, periodStartOf as visitPeriodStartOf } from './visit-plans/periods';
export { countVisits, type VisitTotals } from './visit-plans/visit-counting';
export { planGroupsOf, progressOfGroups, progressOfPlans } from './visit-plans/visit-progress.service';
// The staging seed (src/seed-staging.ts, CD-313) builds records through these; the API's controllers stay the only HTTP surface.
export { CompaniesService } from './companies/companies.service';
export { ContactsService } from './contacts/contacts.service';
export { FunnelsService } from './funnels/funnels.service';
export { MeetingsService } from './meetings/meetings.service';
export { ProductsService } from './products/products.service';
