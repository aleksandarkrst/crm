/**
 * Invitation emails (CD-7): creating an invitation queues an email the worker sends (log mail
 * driver), with the workspace, the inviter and the accept link built from APP_URL; the Team list
 * shows the email status; admins can resend and copy the link, members can't; failed sends are
 * retried and then shown as failed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, eventually, mailTo, ok, type Session, signIn, waitForMail } from './helpers';

let owner: Session;
let member: Session;
let tenant: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });

interface Invitation {
  id: string;
  email: string;
  emailStatus: 'queued' | 'sent' | 'failed' | null;
  emailSentAt: string | null;
  emailError: string | null;
  hasLink: boolean;
  expiresAt: string;
}
const pending = async (id: string): Promise<Invitation | undefined> => (await ok('GET', '/team', as())).invitations.find((i: Invitation) => i.id === id);

beforeAll(async () => {
  owner = await signIn('mail-owner');
  member = await signIn('mail-member');
  tenant = await createTenant(owner, 'Mail Studio');
  await addMember(owner, tenant, member, 'member');
});

describe('invitation email', () => {
  it('is queued on create and sent by the worker with the workspace, the inviter and the link', async () => {
    const invitee = await signIn('mail-invitee');
    const { token, invitation } = await ok('POST', '/team/invitations', { ...as(), body: { email: invitee.email, role: 'admin' } });
    expect(invitation).toMatchObject({ emailStatus: 'queued', hasLink: true });

    const mail = await waitForMail(owner, invitee.email);
    expect(mail.subject).toMatch(/^Mail-owner Tester invited you to Mail Studio .+ on Cadence$/);
    expect(mail.text).toContain(`http://app.example.test/invite/${token}`);
    expect(mail.text).toContain('as an admin');
    expect(mail.text).toContain(owner.email);
    expect(mail.html).toContain(`href="http://app.example.test/invite/${token}"`);

    const shown = await eventually(async () => {
      const row = await pending(invitation.id);
      return row?.emailStatus === 'sent' ? row : null;
    }, 'status sent');
    expect(shown.emailSentAt).toBeTruthy();
    expect(shown.emailError).toBeNull();

    // The emailed link works.
    await ok('POST', `/invitations/${token}/accept`, { token: invitee.token }, 200);
  });

  it('resend emails the same link again and extends the expiry; copy link returns it', async () => {
    const email = `mail-resend-${Date.now()}@example.test`;
    const { token, invitation } = await ok('POST', '/team/invitations', { ...as(), body: { email } });
    await waitForMail(owner, email);

    const resent = await ok('POST', `/team/invitations/${invitation.id}/resend`, as(), 200);
    expect(resent).toMatchObject({ id: invitation.id, emailStatus: 'queued' });
    expect(new Date(resent.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(invitation.expiresAt).getTime());
    const again = await waitForMail(owner, email, 2);
    expect(again.text).toContain(`/invite/${token}`);
    expect((await mailTo(owner, email)).length).toBe(2);

    expect(await ok('GET', `/team/invitations/${invitation.id}/link`, as())).toEqual({ token });
  });

  it('members can neither invite, resend nor copy links', async () => {
    const { invitation } = await ok('POST', '/team/invitations', { ...as(), body: { email: `mail-roles-${Date.now()}@example.test` } });
    expect((await call('POST', '/team/invitations', { ...as(member), body: { email: 'x@example.test' } })).status).toBe(403);
    expect((await call('POST', `/team/invitations/${invitation.id}/resend`, as(member))).status).toBe(403);
    expect((await call('GET', `/team/invitations/${invitation.id}/link`, as(member))).status).toBe(403);
  });

  it("can't resend or copy another workspace's, or a withdrawn, invitation", async () => {
    const other = await signIn('mail-other-owner');
    const otherTenant = await createTenant(other, 'Other Mail');
    const { invitation } = await ok('POST', '/team/invitations', { token: other.token, tenant: otherTenant, body: { email: `mail-x-${Date.now()}@example.test` } });
    expect((await call('POST', `/team/invitations/${invitation.id}/resend`, as())).status).toBe(404);
    expect((await call('GET', `/team/invitations/${invitation.id}/link`, as())).status).toBe(404);

    await ok('DELETE', `/team/invitations/${invitation.id}`, { token: other.token, tenant: otherTenant });
    expect((await call('POST', `/team/invitations/${invitation.id}/resend`, { token: other.token, tenant: otherTenant })).status).toBe(404);
  });

  it('a send that keeps failing is retried, then shown as failed with the reason', async () => {
    // The log driver refuses the reserved .invalid domain. The suite runs with MAIL_RETRY_LIMIT=1.
    const { invitation } = await ok('POST', '/team/invitations', { ...as(), body: { email: `bounce-${Date.now()}@nowhere.invalid` } });
    const failed = await eventually(async () => {
      const row = await pending(invitation.id);
      return row?.emailStatus === 'failed' ? row : null;
    }, 'status failed', 30_000);
    expect(failed.emailError).toMatch(/Mailbox unavailable/);
    expect(failed.emailSentAt).toBeNull();
  }, 40_000);
});
