import { Module } from '@nestjs/common';
import { HrDocumentsModule } from '../hr-documents';
import { PeopleModule } from '../people';
import { AbsenceService } from './absence.service';
import { ApprovalsService } from './approvals.service';
import { BalancesService } from './balances.service';
import { DecisionsService } from './decisions.service';
import { EntitlementsService } from './entitlements.service';
import { TimeoffPoliciesService } from './policies.service';
import { ReasonsService } from './reasons.service';
import { RequestsService } from './requests.service';
import { TimeoffController } from './timeoff.controller';

/**
 * Time off (milestone 16, Workforce): vacation policies, the employee's time off profile and the
 * yearly entitlement (CD-163). Balances, requests, approvals, the decision document, sick leave
 * and the timesheet lines follow (CD-164 to CD-170). Who may see whom is the people module's rule
 * (PeopleAccess).
 */
@Module({
  imports: [PeopleModule, HrDocumentsModule],
  controllers: [TimeoffController],
  providers: [TimeoffPoliciesService, EntitlementsService, BalancesService, ReasonsService, RequestsService, ApprovalsService, AbsenceService, DecisionsService],
  exports: [EntitlementsService, BalancesService, RequestsService, ApprovalsService],
})
export class TimeoffModule {}
