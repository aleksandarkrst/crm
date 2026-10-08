/**
 * A project's files (CD-271, Documents tab): any member adds and downloads files; the one who added
 * a file, the project lead, owners and admins move or delete it; another workspace sees none;
 * deleting the project removes its files.
 */
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';

let owner: Session;
let member: Session;
let other: Session;
let stranger: Session;
let tenant: string;
let otherTenant: string;
let projectId: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });

/** Multipart or binary calls, which helpers.call (JSON only) doesn't do. */
async function raw(method: string, path: string, opts: { token: string; tenant: string; form?: FormData }) {
  const res = await fetch(`${inject('apiUrl')}/api${path}`, { method, headers: { authorization: `Bearer ${opts.token}`, 'x-tenant-id': opts.tenant }, body: opts.form });
  const bytes = Buffer.from(await res.arrayBuffer());
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    // binary
  }
  return { status: res.status, bytes, json, headers: res.headers };
}

const upload = (s: Session, name: string, text: string, folder?: string) => {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/plain' }), name);
  if (folder) form.append('folder', folder);
  return raw('POST', `/projects/${projectId}/files`, { token: s.token, tenant, form });
};

beforeAll(async () => {
  [owner, member, other, stranger] = await Promise.all([signIn('pfiles-owner'), signIn('pfiles-member'), signIn('pfiles-other'), signIn('pfiles-stranger')]);
  [tenant, otherTenant] = await Promise.all([createTenant(owner, 'Project files'), createTenant(stranger, 'Project files other')]);
  await addMember(owner, tenant, member, 'member');
  await addMember(owner, tenant, other, 'member');
  const company = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Acme' } });
  const [type] = await ok('GET', '/project-types', as());
  projectId = (await ok('POST', '/projects', { ...as(), body: { name: 'Files project', projectTypeId: type.id, companyId: company.id } })).id;
});

describe('project files', () => {
  let fileId: string;

  it('a member adds a file to a folder; everyone lists and downloads it', async () => {
    const res = await upload(member, 'Brief – v1.txt', 'hello project', 'Brief');
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: 'Brief – v1.txt', folder: 'Brief', sizeBytes: 13, addedByUserId: member.userId });
    fileId = res.json!.id as string;
    const list = await ok('GET', `/projects/${projectId}/files`, as(other));
    expect(list.map((f: { id: string }) => f.id)).toEqual([fileId]);
    const file = await raw('GET', `/projects/${projectId}/files/${fileId}/download`, { token: other.token, tenant });
    expect(file.status).toBe(200);
    expect(file.bytes.toString('utf8')).toBe('hello project');
    expect(file.headers.get('content-disposition')).toContain('attachment');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    // Without a folder it lands in "Client material"; an unknown folder is refused.
    expect((await upload(member, 'notes.txt', 'x')).json).toMatchObject({ folder: 'Client material' });
    expect((await upload(member, 'bad.txt', 'x', 'Secrets')).status).toBe(400);
  });

  it('the uploader, the lead and admins move or delete it; another member gets 403', async () => {
    expect((await call('PATCH', `/projects/${projectId}/files/${fileId}`, { ...as(other), body: { folder: 'Design' } })).status).toBe(403);
    expect(await ok('PATCH', `/projects/${projectId}/files/${fileId}`, { ...as(member), body: { folder: 'Design' } }, 200)).toMatchObject({ folder: 'Design' });
    expect((await call('DELETE', `/projects/${projectId}/files/${fileId}`, as(other))).status).toBe(403);
    await ok('DELETE', `/projects/${projectId}/files/${fileId}`, as(owner), 204);
    expect((await raw('GET', `/projects/${projectId}/files/${fileId}/download`, { token: owner.token, tenant })).status).toBe(404);
  });

  it('another workspace sees none of it', async () => {
    expect((await call('GET', `/projects/${projectId}/files`, { token: stranger.token, tenant: otherTenant })).status).toBe(404);
  });

  it('deleting the project removes its files', async () => {
    const res = await upload(owner, 'contract.txt', 'signed', 'Contract');
    await ok('DELETE', `/projects/${projectId}`, as(owner), 204);
    expect((await raw('GET', `/projects/${projectId}/files/${res.json!.id}/download`, { token: owner.token, tenant })).status).toBe(404);
  });
});
