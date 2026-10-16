// The timeoff module's public API (milestone 16). Other modules import only from here.
export { TimeoffModule } from './timeoff.module';
export { TimeoffDevModule, TimeoffWorkerModule } from './timeoff-jobs';
export { carryOverDays, computeEntitlement, type Entitlement, type EntitlementInput, type ExperienceRule, type PolicyRules } from './entitlement';
export { assignPools, type Balance, computeBalance, type PoolAssignmentResult, type VacationDay } from './balance';
