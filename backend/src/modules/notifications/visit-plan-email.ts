import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';

/** The plan as the email shows it (CD-134). */
export interface VisitPlanEmailPlan {
  id: string;
  periodLabel: string;
  note: string | null;
  lines: { companyName: string; plannedVisits: number }[];
}

export interface VisitPlanEmailInput {
  to: string;
  salespersonName: string | null;
  actorName: string;
  workspaceName: string;
  appUrl: string;
  kind: 'created' | 'changed';
  plan: VisitPlanEmailPlan;
}

const visits = (n: number) => (n === 1 ? '1 visit' : `${n} visits`);

/**
 * "Your visit plan for October 2026" (or "… was changed"): the customers and planned visits of a
 * plan someone else made or changed for the salesperson, and a link to it. A pure function, so it
 * can be unit-tested; the worker loads the plan and sends it (notification-jobs.ts).
 */
export function visitPlanEmail({ to, salespersonName, actorName, workspaceName, appUrl, kind, plan }: VisitPlanEmailInput): MailMessage {
  const link = `${appUrl.replace(/\/+$/, '')}/visit-plans/${plan.id}`;
  const subject = kind === 'created' ? `Your visit plan for ${plan.periodLabel}` : `Your visit plan for ${plan.periodLabel} was changed`;
  const total = plan.lines.reduce((sum, l) => sum + l.plannedVisits, 0);
  const greeting = salespersonName ? `Hi ${salespersonName.split(' ')[0]},` : 'Hi,';
  const intro =
    kind === 'created'
      ? `${actorName} made a visit plan for you for ${plan.periodLabel} in ${workspaceName}: ${visits(total)} at ${plan.lines.length === 1 ? '1 customer' : `${plan.lines.length} customers`}.`
      : `${actorName} changed your visit plan for ${plan.periodLabel} in ${workspaceName}. It now has ${visits(total)} at ${plan.lines.length === 1 ? '1 customer' : `${plan.lines.length} customers`}.`;
  const rows = plan.lines.map((l) => `- ${l.companyName}: ${visits(l.plannedVisits)}`);
  const footer = `You get this email because "Visit plans" is on in Settings → Notifications for ${workspaceName}.`;
  const text = [greeting, '', intro, '', ...rows, ...(plan.note ? ['', `Note: ${plan.note}`] : []), '', `Open the plan: ${link}`, '', footer].join('\n');
  const table = [
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 12px">',
    '<tr><th align="left" style="padding:6px 0;border-bottom:1px solid #E2E8E4;color:#6B7B73;font-size:12px;font-weight:600">Customer</th><th align="right" style="padding:6px 0;border-bottom:1px solid #E2E8E4;color:#6B7B73;font-size:12px;font-weight:600">Planned visits</th></tr>',
    ...plan.lines.map(
      (l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #EEF2EF">${escapeHtml(l.companyName)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #EEF2EF">${l.plannedVisits}</td></tr>`,
    ),
    `<tr><td style="padding:6px 0;font-weight:600">Total</td><td align="right" style="padding:6px 0;font-weight:600">${total}</td></tr>`,
    '</table>',
  ].join('');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`,
      `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`,
      table,
      plan.note ? `<p style="margin:0 0 12px;color:#475750;white-space:pre-line">${escapeHtml(plan.note)}</p>` : '',
      buttonHtml('Open the plan', link),
    ]
      .filter(Boolean)
      .join('\n'),
    footer,
    appUrl,
  );
  return { to, subject, text, html };
}
