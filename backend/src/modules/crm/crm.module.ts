import { Module } from '@nestjs/common';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { ContactsController } from './contacts/contacts.controller';
import { ContactsService } from './contacts/contacts.service';
import { ActivitiesService } from './deals/activities.service';
import { DealLinesService } from './deals/deal-lines.service';
import { DealTasksService } from './deals/deal-tasks.service';
import { DealWorkController } from './deals/deal-work.controller';
import { DealsController } from './deals/deals.controller';
import { DealsService } from './deals/deals.service';
import { StageHistoryService } from './deals/stage-history.service';
import { FunnelsController } from './funnels/funnels.controller';
import { FunnelsService } from './funnels/funnels.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';

/**
 * CRM domain: companies, contacts, funnels (playbooks), deals with their lines (products and
 * payment schedules), stage to-dos, stage history and activity history, and the product catalog. Next in this
 * module per the design: document templates/generation, commissions (sales bonuses).
 */
@Module({
  controllers: [CompaniesController, ContactsController, FunnelsController, DealsController, DealWorkController, ProductsController],
  providers: [CompaniesService, ContactsService, FunnelsService, DealsService, ActivitiesService, DealLinesService, DealTasksService, StageHistoryService, ProductsService],
  exports: [DealsService],
})
export class CrmModule {}
