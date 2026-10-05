import { Module } from '@nestjs/common';
import { BonusRulesController } from './bonuses/bonus-rules.controller';
import { BonusRulesService } from './bonuses/bonus-rules.service';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { ContactsController } from './contacts/contacts.controller';
import { ContactsService } from './contacts/contacts.service';
import { CustomFieldsController } from './custom-fields/custom-fields.controller';
import { CustomFieldsService } from './custom-fields/custom-fields.service';
import { ActivitiesService } from './deals/activities.service';
import { DealLinesService } from './deals/deal-lines.service';
import { DealTasksService } from './deals/deal-tasks.service';
import { DealWorkController } from './deals/deal-work.controller';
import { DealsController } from './deals/deals.controller';
import { DealsService } from './deals/deals.service';
import { DocumentGenerator } from './documents/document-generator';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { StageHistoryService } from './deals/stage-history.service';
import { FunnelsController } from './funnels/funnels.controller';
import { ExternalMinutesController } from './meetings/external-minutes.controller';
import { ExternalMinutesService } from './meetings/external-minutes.service';
import { MeetingMinutesController } from './meetings/meeting-minutes.controller';
import { MeetingMinutesService } from './meetings/meeting-minutes.service';
import { MeetingsController } from './meetings/meetings.controller';
import { MeetingsService } from './meetings/meetings.service';
import { HistoryController } from './history/history.controller';
import { RecordHistoryService } from './history/record-history.service';
import { FunnelsService } from './funnels/funnels.service';
import { ImportController } from './import/import.controller';
import { ImportService } from './import/import.service';
import { OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { VisitPlansController } from './visit-plans/visit-plans.controller';
import { VisitPlansService } from './visit-plans/visit-plans.service';
import { VisitProgressService } from './visit-plans/visit-progress.service';

/**
 * CRM domain: companies, contacts, funnels (playbooks), deals with their lines (products and
 * payment schedules), stage to-dos, stage history and activity history, and the product catalog. Next in this
 * module per the design: commissions (sales bonuses).
 * CSV import of companies, contacts and deals lives in import/ (CD-64); document templates and
 * generated documents in documents/ (CD-13). Custom fields (CD-15) are in custom-fields/, sales
 * bonus rules (CD-17) in bonuses/, and the getting-started checklist and sample data in
 * onboarding/ (CD-68). Meetings with customers (CD-130) and their minutes (CD-132, CD-133) are in meetings/, customer visit plans (CD-134) in visit-plans/.
 */
@Module({
  controllers: [CompaniesController, ContactsController, FunnelsController, DealsController, DealWorkController, ProductsController, ImportController, CustomFieldsController, BonusRulesController, DocumentsController, HistoryController, OnboardingController, MeetingsController, MeetingMinutesController, ExternalMinutesController, VisitPlansController],
  providers: [CompaniesService, ContactsService, FunnelsService, DealsService, ActivitiesService, DealLinesService, DealTasksService, StageHistoryService, ProductsService, ImportService, CustomFieldsService, BonusRulesService, DocumentsService, DocumentGenerator, RecordHistoryService, OnboardingService, MeetingsService, MeetingMinutesService, ExternalMinutesService, VisitPlansService, VisitProgressService],
  exports: [DealsService],
})
export class CrmModule {}
