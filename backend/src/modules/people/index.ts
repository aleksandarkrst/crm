// The people module's public API (milestone 13). Other modules import only from here.
export { PeopleModule } from './people.module';
export { PeopleWorkerModule } from './people-jobs';
export { PeopleDevModule } from './lifecycle.controller';
export { PeopleAccess } from './people-access';
export { CallerAccess, FUNCTIONAL_ROLES, type FunctionalRole } from './caller-access';
export { ABSENCE_SOURCE, type AbsenceSource, type Approver, type ApproverResult, resolveApprovers, SELF_APPROVED_LABEL } from './approvers';
export { linkNewMember, type NewMember, unlinkMember } from './linking';
export { assertValidManager, lockReportingLines, loopMessage } from './reporting-lines';
export { domesticFromIban, formatIban, maskIban, parseBankAccount, type ParsedAccount, shortMaskIban } from './iban';
export { cleanName, normalizeForSearch } from './search';
export { allows, PERMISSION_MODULES, type PermissionRelation, type PermissionScope, permissionRow, relationsFor } from './permissions';
