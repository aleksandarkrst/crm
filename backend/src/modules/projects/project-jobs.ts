import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import { Mailer, type MailMessage } from '../../infrastructure/mail/mailer';
import { DatabaseService } from '../../shared/database/database.service';
import { companies, deals, employees, memberships, projects, taskAssignments, tasks, tenants, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { JobsService } from '../../shared/events/jobs.service';
import { autoCreateFromWonDeal } from './projects.service';

export interface ProjectCreatedEmailInput {
  to: string;
  recipientName: string | null;
  workspaceName: string;
  appUrl: string;
  project: { id: string; name: string; company: string; dealTitle: string | null };
}

/** "Project created from a won deal" (CD-233, spec 3.2), to the deal's owner. */
export function projectCreatedEmail({ to, recipientName, workspaceName, appUrl, project }: ProjectCreatedEmailInput): MailMessage {
  const link = `${appUrl.replace(/\/+$/, '')}/projects/${project.id}`;
  const subject = `Project created from a won deal: ${project.name}`;
  const greeting = recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,';
  const intro = `${project.dealTitle ?? 'Your deal'} was won, so ${workspaceName} created the project ${project.name} for ${project.company}. You lead it.`;
  const footer = `You get this email because "Create a project when a deal is won" is on in Settings → Workspace for ${workspaceName}.`;
  const text = [greeting, '', intro, '', `Open the project: ${link}`, '', footer].join('\n');
  const html = layoutHtml(
    [`<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`, `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`, buttonHtml('Open the project', link)].join('\n'),
    footer,
    appUrl,
  );
  return { to, subject, text, html };
}

export interface TaskAssignedEmailInput {
  to: string;
  recipientName: string | null;
  actorName: string;
  workspaceName: string;
  appUrl: string;
  task: { id: string; number: number; name: string; project: string; company: string; dueDate: string | null };
}

const dueLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "Assigned to a task" (CD-146): number, name, project, company, due date and a link. */
export function taskAssignedEmail({ to, recipientName, actorName, workspaceName, appUrl, task }: TaskAssignedEmailInput): MailMessage {
  const link = `${appUrl.replace(/\/+$/, '')}/tasks/${task.id}`;
  const subject = `Assigned to a task: T-${task.number} ${task.name}`;
  const greeting = recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,';
  const intro = `${actorName} assigned you to T-${task.number} ${task.name} on the project ${task.project} for ${task.company}.`;
  const due = task.dueDate ? `Due ${dueLabel(task.dueDate)}.` : 'No due date yet.';
  const footer = `You get this email because "Task assignments" is on in Settings → Notifications for ${workspaceName}.`;
  const text = [greeting, '', intro, due, '', `Open the task: ${link}`, '', footer].join('\n');
  const html = layoutHtml(
    [`<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`, `<p style="margin:0 0 12px">${escapeHtml(intro)} ${escapeHtml(due)}</p>`, buttonHtml('Open the task', link)].join('\n'),
    footer,
    appUrl,
  );
  return { to, subject, text, html };
}

/**
 * Worker side of projects (CD-233):
 * - "crm.deal-won": with "Create a project when a deal is won" on, the deal's project
 *   (`autoCreateFromWonDeal`: once per deal), then the deal timeline entry
 *   ("projects.project-created-from-deal", CRM) and the owner's email ("projects.project-created-email").
 * - "projects.project-created-email": emails the deal owner, if still a member and still the lead.
 * - "projects.task-assigned" (CD-146): emails someone assigned to a task, if they still are and
 *   "Task assignments" is on for them (read when sending, so turning it off stops queued emails).
 */
@Injectable()
export class ProjectJobs implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProjectJobs.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('crm.deal-won', (data) => this.dealWon(data));
    await this.jobs.work('projects.project-created-email', (data) => this.sendCreated(data));
    await this.jobs.work('projects.task-assigned', (data) => this.sendTaskAssigned(data));
  }

  async dealWon({ tenantId, dealId, actorUserId }: JobPayloads['crm.deal-won']): Promise<void> {
    await this.database.withTenant(tenantId, async (tx) => {
      const created = await autoCreateFromWonDeal(tx, tenantId, dealId);
      if (!created) return;
      this.logger.log(`Project ${created.projectName} created from won deal ${dealId} (tenant ${tenantId})`);
      await this.jobs.send('projects.project-created-from-deal', { tenantId, dealId, projectId: created.projectId, projectName: created.projectName, actorUserId }, tx);
      if (created.dealOwnerUserId) await this.jobs.send('projects.project-created-email', { tenantId, projectId: created.projectId, recipientUserId: created.dealOwnerUserId }, tx);
    });
  }

  async sendCreated({ tenantId, projectId, recipientUserId }: JobPayloads['projects.project-created-email']): Promise<void> {
    const [recipient] = await this.database.db
      .select({ email: users.email, name: users.displayName, workspaceName: tenants.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, recipientUserId)));
    if (!recipient?.email) return;
    const [project] = await this.database.withTenant(tenantId, (tx) =>
      tx
        .select({ id: projects.id, name: projects.name, company: companies.name, dealTitle: deals.title, leadUserId: projects.leadUserId })
        .from(projects)
        .innerJoin(companies, eq(companies.id, projects.companyId))
        .leftJoin(deals, eq(deals.id, projects.dealId))
        .where(eq(projects.id, projectId)),
    );
    // Deleted, or given to someone else before this ran: nothing to tell.
    if (!project || project.leadUserId !== recipientUserId) return;
    if (this.mailer.notDelivered) {
      this.logger.warn(`Project-created email for ${projectId} not sent: ${this.mailer.notDelivered}`);
      return;
    }
    await this.mailer.send(projectCreatedEmail({ to: recipient.email, recipientName: recipient.name, workspaceName: recipient.workspaceName, appUrl: this.env.APP_URL, project }));
  }

  async sendTaskAssigned({ tenantId, taskId, recipientUserId, actorUserId }: JobPayloads['projects.task-assigned']): Promise<void> {
    if (recipientUserId === actorUserId) return;
    const [recipient] = await this.database.db
      .select({ email: users.email, name: users.displayName, wants: memberships.notifyTaskAssigned, workspaceName: tenants.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, recipientUserId)));
    if (!recipient?.email || !recipient.wants) return;
    const [task] = await this.database.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: tasks.id,
          number: tasks.number,
          name: tasks.name,
          project: projects.name,
          company: companies.name,
          dueDate: sql<string | null>`${tasks.dueDate}::text`,
          stillAssigned: sql<boolean>`exists (select 1 from ${taskAssignments} a join ${employees} e on e.id = a.employee_id where a.task_id = ${tasks.id} and a.active and e.user_id = ${recipientUserId})`,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .innerJoin(companies, eq(companies.id, projects.companyId))
        .where(eq(tasks.id, taskId)),
    );
    // Deleted, or taken off the task before this ran: nothing to tell.
    if (!task?.stillAssigned) return;
    const [actor] = await this.database.db.select({ name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'A teammate')` }).from(users).where(eq(users.id, actorUserId));
    if (this.mailer.notDelivered) {
      this.logger.warn(`Task-assigned email for ${taskId} not sent: ${this.mailer.notDelivered}`);
      return;
    }
    await this.mailer.send(
      taskAssignedEmail({ to: recipient.email, recipientName: recipient.name, actorName: actor?.name ?? 'A teammate', workspaceName: recipient.workspaceName, appUrl: this.env.APP_URL, task }),
    );
  }
}

/** Registered in the worker (WorkerModule). */
@Module({ providers: [ProjectJobs] })
export class ProjectsWorkerModule {}
