import { Module } from '@nestjs/common';
import { ABSENCE_SOURCE, nobodyAbsent } from './approvers';
import { EmployeeImportController } from './employee-import.controller';
import { EmployeeImportService } from './employee-import.service';
import { EmployeesBulkController } from './employees-bulk.controller';
import { EmployeesBulkService } from './employees-bulk.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { PeopleAccess } from './people-access';
import { PeopleController } from './people.controller';
import { PeopleHistoryService } from './people-history.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * People (milestone 13): employees, departments, teams, functional roles, access and the approver
 * rule. Other modules use PeopleAccess (exported) for "who is the caller and what may they see".
 * Milestone 16 replaces ABSENCE_SOURCE with the real time-off source.
 */
@Module({
  controllers: [EmployeesController, EmployeesBulkController, PeopleController, RolesController, EmployeeImportController],
  providers: [PeopleAccess, PeopleHistoryService, EmployeesService, EmployeesBulkService, RolesService, EmployeeImportService, { provide: ABSENCE_SOURCE, useValue: nobodyAbsent }],
  exports: [PeopleAccess],
})
export class PeopleModule {}
