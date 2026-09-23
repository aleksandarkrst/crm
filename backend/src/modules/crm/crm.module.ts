import { Module } from '@nestjs/common';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { ContactsController } from './contacts/contacts.controller';
import { ContactsService } from './contacts/contacts.service';
import { ActivitiesService } from './deals/activities.service';
import { DealsController } from './deals/deals.controller';
import { DealsService } from './deals/deals.service';
import { FunnelsController } from './funnels/funnels.controller';
import { FunnelsService } from './funnels/funnels.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';

/**
 * CRM domain: companies, contacts, funnels (playbooks), deals and their activity history,
 * and the product catalog. Next in this module per the design: deal lines & payment
 * schedules, stage to-dos, document templates/generation, commissions (sales bonuses).
 */
@Module({
  controllers: [CompaniesController, ContactsController, FunnelsController, DealsController, ProductsController],
  providers: [CompaniesService, ContactsService, FunnelsService, DealsService, ActivitiesService, ProductsService],
  exports: [DealsService],
})
export class CrmModule {}
