import type { Env } from '../../infrastructure/config/config.module';
import { SecretBox } from '../../infrastructure/crypto/secret-box';
import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';

/**
 * Seals employees' IBANs at rest (employee_personal.iban_sealed, fx_iban_sealed), AES-256-GCM with
 * a key derived from APP_SECRET and the purpose "employee-iban". Null without a secret (only
 * possible outside production): bank accounts can't be stored then. Losing APP_SECRET loses the
 * stored IBANs (spec 9.5).
 */
export function employeeIbanBox(env: Pick<Env, 'APP_SECRET' | 'DEV_JWT_SECRET'>): SecretBox | null {
  const secret = env.APP_SECRET ?? env.DEV_JWT_SECRET;
  return secret ? new SecretBox(secret, 'employee-iban') : null;
}

/** One account's change, as the "Bank account changed" email lists it. Masks only, never a number. */
export interface BankAccountChange {
  account: 'iban' | 'fxIban';
  kind: 'added' | 'changed' | 'removed';
  /** The short mask: the new account's ("RS35 •••• 1379"), or the removed one's. */
  masked: string;
}

export interface BankAccountEmailInput {
  to: string;
  employeeName: string;
  /** Who changed it: a member's name, or null for the system (an import without a user). */
  actorName: string | null;
  /** The employee changed it themselves. */
  self: boolean;
  workspaceName: string;
  appUrl: string;
  employeeId: string;
  changes: BankAccountChange[];
}

const ACCOUNT_NAMES = { iban: 'bank account', fxIban: 'foreign currency account' } as const;

function describe(c: BankAccountChange): string {
  const what = ACCOUNT_NAMES[c.account];
  if (c.kind === 'added') return `Added ${what}: ${c.masked}`;
  if (c.kind === 'removed') return `Removed ${what}: ${c.masked}`;
  return `New ${what}: ${c.masked}`;
}

/**
 * "Bank account changed" (spec 10.2): to the employee whenever their IBAN is added, changed or
 * removed, by anyone. A security notice, so it can't be turned off. Shows only the masked number
 * and who changed it, never the IBAN or other personal details. Pure, so it is unit-tested.
 */
export function bankAccountEmail(input: BankAccountEmailInput): MailMessage {
  const link = `${input.appUrl.replace(/\/+$/, '')}/people/${input.employeeId}`;
  const who = input.self ? 'You' : (input.actorName ?? 'Pultly (an import)');
  const subject = `Your bank account in ${input.workspaceName} was changed`;
  const greeting = `Hi ${input.employeeName.split(' ')[0]},`;
  const intro = `${who} changed the bank account on your employee record in ${input.workspaceName}.`;
  const rows = input.changes.map(describe);
  const warning = input.self ? "If this wasn't you, tell your administrator right away." : "If you didn't expect this change, tell your administrator right away.";
  const footer = 'You get this email whenever the bank account on your employee record changes. It is a security notice and cannot be turned off.';
  const text = [greeting, '', intro, '', ...rows.map((r) => `- ${r}`), '', warning, '', `Open your employee card: ${link}`, '', footer].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`,
      `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`,
      `<ul style="margin:0 0 12px;padding-left:20px">${rows.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`,
      `<p style="margin:0 0 12px"><strong>${escapeHtml(warning)}</strong></p>`,
      buttonHtml('Open your employee card', link),
    ].join('\n'),
    footer,
    input.appUrl,
  );
  return { to: input.to, subject, text, html };
}
