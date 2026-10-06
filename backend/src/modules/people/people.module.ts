import { Module } from '@nestjs/common';
import { ABSENCE_SOURCE, nobodyAbsent } from './approvers';
import { DEPARTMENT_USAGE, nothingUsesDepartments } from './department-usage';
import { EmployeesBulkController } from './employees-bulk.controller';
import { EmployeesBulkService } from './employees-bulk.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';
import { LifecycleController } from './lifecycle.controller';
import { EmployeeLifecycleService } from './lifecycle.service';
import { PeopleAccess } from './people-access';
import { PeopleController } from './people.controller';
import { PeopleHistoryService } from './people-history.service';
import { RolesController } from './roles.controller';

/**
 * People (milestone 13): employees, departments, teams, functional roles, access and the approver
 * rule. Other modules use PeopleAccess (exported) for "who is the caller and what may they see".
 * Milestone 16 replaces ABSENCE_SOURCE with the real time-off source; milestones 14 and 21 replace
 * DEPARTMENT_USAGE with what uses a department.
 */
@Module({
  controllers: [LifecycleController, EmployeesController, EmployeesBulkController, PeopleController, RolesController, OrgController],
  providers: [
    PeopleAccess,
    PeopleHistoryService,
    EmployeesService,
    EmployeeLifecycleService,
    EmployeesBulkService,
    OrgService,
    { provide: ABSENCE_SOURCE, useValue: nobodyAbsent },
    { provide: DEPARTMENT_USAGE, useValue: nothingUsesDepartments },
  ],
  exports: [PeopleAccess],
})
export class PeopleModule {}
