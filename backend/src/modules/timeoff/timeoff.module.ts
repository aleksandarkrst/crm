import { Module } from '@nestjs/common';
import { PeopleModule } from '../people';
import { BalancesService } from './balances.service';
import { EntitlementsService } from './entitlements.service';
import { TimeoffPoliciesService } from './policies.service';
import { TimeoffController } from './timeoff.controller';

/**
 * Time off (milestone 16, Workforce): vacation policies, the employee's time off profile and the
 * yearly entitlement (CD-163). Balances, requests, approvals, the decision document, sick leave
 * and the timesheet lines follow (CD-164 to CD-170). Who may see whom is the people module's rule
 * (PeopleAccess).
 */
@Module({
  imports: [PeopleModule],
  controllers: [TimeoffController],
  providers: [TimeoffPoliciesService, EntitlementsService, BalancesService],
  exports: [EntitlementsService, BalancesService],
})
export class TimeoffModule {}
