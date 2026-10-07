import { BadRequestException, ConflictException } from '@nestjs/common';

interface PgError {
  code?: string;
  constraint?: string;
  message?: string;
}

/**
 * Data rules enforced by triggers (they raise check_violation naming one of these). Their message
 * is written for people, so the API passes it on.
 */
const RULES_WITH_MESSAGES = new Set(['deals_lost_not_won', 'deals_stage_not_deleted']);

/** Unique constraints whose violation the people module explains (milestone 13). */
const UNIQUE_MESSAGES: Record<string, string> = {
  employees_work_email_uq: 'Another employee already has this work email',
  employees_number_uq: 'Another employee already has this employee number',
  employees_user_uq: 'This member is already linked to another employee',
  departments_name_uq: 'A department with this name already exists',
  departments_code_uq: 'A department with this code already exists',
  teams_name_uq: 'This department already has a team with this name',
  org_levels_name_uq: 'A level with this name already exists',
  org_units_name_uq: 'A unit with this name already exists here',
  org_units_code_uq: 'A unit with this code already exists',
  org_units_lead_uq: 'This person already leads another unit',
  project_types_name_uq: 'A project type with this name already exists',
  project_stages_name_uq: 'This project type already has a stage with this name',
  projects_name_uq: 'This company already has an open project with this name',
  projects_code_uq: 'Another open project has this code',
};

/** Rules about employees' org fields that the database enforces as a last line (people). */
const PEOPLE_RULES: Record<string, string> = {
  employees_team_fk: 'The team belongs to another department',
  employees_team_needs_department_ck: 'A team needs its department',
  employees_not_own_manager_ck: "An employee can't report to themselves",
  org_units_parent_level_ck: 'A unit can only be inside a unit of a higher level',
  org_units_parent_fk: 'The parent unit was not found',
  org_units_level_fk: 'The level was not found',
  employees_unit_fk: 'The unit was not found',
};

/** Project field rules the database enforces as a last line (CD-233). */
const PROJECT_RULES: Record<string, string> = {
  projects_dates_ck: "The end date can't be before the start date",
  projects_cancel_reason_ck: 'Only a cancelled project has a cancel reason',
};

function pgError(err: unknown): PgError | undefined {
  // drizzle wraps driver errors; the pg error is on `cause`.
  const e = err as { code?: string; cause?: PgError };
  if (typeof e?.code === 'string') return e;
  if (typeof e?.cause?.code === 'string') return e.cause;
  return undefined;
}

/** Translates common PostgreSQL constraint errors into HTTP errors; rethrows everything else. */
export function mapDbError(err: unknown): never {
  const pg = pgError(err);
  switch (pg?.code) {
    case '23505':
      if (pg.constraint && UNIQUE_MESSAGES[pg.constraint]) throw new ConflictException(UNIQUE_MESSAGES[pg.constraint]);
      throw new ConflictException(`Already exists (${pg.constraint ?? 'unique constraint'})`);
    case '23503':
      if (pg.constraint && PEOPLE_RULES[pg.constraint]) throw new BadRequestException(PEOPLE_RULES[pg.constraint]);
      // A deal with meetings (CD-213): the service says so first; this covers a race with a new meeting.
      if (pg.constraint === 'meetings_deal_fk' && pg.message?.startsWith('update or delete')) {
        throw new ConflictException('This deal has meetings. Delete them or move them to another deal first.');
      }
      // A company with projects (CD-233): kept, like a company with deals.
      if (pg.constraint === 'projects_company_fk' && pg.message?.startsWith('update or delete')) {
        throw new ConflictException('This company has projects. Delete them or move them to another company first.');
      }
      throw new ConflictException(`Referenced record missing or still in use (${pg.constraint ?? 'foreign key'})`);
    case '23514':
      if (pg.constraint && RULES_WITH_MESSAGES.has(pg.constraint)) throw new ConflictException(pg.message);
      if (pg.constraint === 'meetings_deal_required') throw new BadRequestException('Pick a deal');
      if (pg.constraint && PROJECT_RULES[pg.constraint]) throw new BadRequestException(PROJECT_RULES[pg.constraint]);
      if (pg.constraint && PEOPLE_RULES[pg.constraint]) throw new BadRequestException(PEOPLE_RULES[pg.constraint]);
      throw err;
    case '22P02':
      throw new BadRequestException('Invalid identifier');
    default:
      throw err;
  }
}
