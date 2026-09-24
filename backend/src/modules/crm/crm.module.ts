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
import { FunnelsService } from './funnels/funnels.service';
import { ImportController } from './import/import.controller';
import { ImportService } from './import/import.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';

/**
 * CRM domain: companies, contacts, funnels (playbooks), deals with their lines (products and
 * payment schedules), stage to-dos, stage history and activity history, and the product catalog. Next in this
 * module per the design: commissions (sales bonuses).
 * CSV import of companies, contacts and deals lives in import/ (CD-64); document templates and
 * generated documents in documents/ (CD-13). Custom fields (CD-15) are in custom-fields/, sales
 * bonus rules (CD-17) in bonuses/.
 */
@Module({
  controllers: [CompaniesController, ContactsController, FunnelsController, DealsController, DealWorkController, ProductsController, ImportController, CustomFieldsController, BonusRulesController, DocumentsController],
  providers: [CompaniesService, ContactsService, FunnelsService, DealsService, ActivitiesService, DealLinesService, DealTasksService, StageHistoryService, ProductsService, ImportService, CustomFieldsService, BonusRulesService, DocumentsService, DocumentGenerator],
  exports: [DealsService],
})
export class CrmModule {}
