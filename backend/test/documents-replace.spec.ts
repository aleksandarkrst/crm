/**
 * replaceTemplate restores the previous .docx when the database update fails after putBuffer
 * (CD-487 review): otherwise new bytes sit under stale name/placeholders.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildDocx, starterTemplate } from '../src/modules/crm/documents/docx';
import { DocumentsService, type UploadedDocx } from '../src/modules/crm/documents/documents.service';

const ctx = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' as const };

function uploaded(buffer: Buffer, name = 'next.docx'): UploadedDocx {
  return { buffer, originalname: name, size: buffer.length };
}

describe('replaceTemplate storage rollback', () => {
  it('puts the previous file back when the database update fails', async () => {
    const previous = starterTemplate();
    const next = buildDocx([{ text: 'Replaced body {{company.name}}' }]);
    const puts: Buffer[] = [];
    const storage = {
      getBuffer: vi.fn().mockResolvedValue(previous),
      putBuffer: vi.fn(async (_tenant: string, _key: string, body: Buffer) => {
        puts.push(Buffer.from(body));
      }),
    };
    let withTenant = 0;
    const database = {
      withTenant: vi.fn(async () => {
        withTenant += 1;
        if (withTenant === 1) return { id: 'tpl-1', key: 'templates/tpl-1.docx', name: 'Original' };
        throw new Error('database update failed');
      }),
    };
    const service = new DocumentsService(database as never, storage as never, {} as never, {} as never);

    await expect(service.replaceTemplate(ctx, 'tpl-1', uploaded(next), { name: 'Next', docType: 'Quote' })).rejects.toThrow(/database update failed/);

    expect(storage.getBuffer).toHaveBeenCalledWith('tenant-1', 'templates/tpl-1.docx');
    expect(puts).toHaveLength(2);
    expect(puts[0]!.equals(next)).toBe(true);
    expect(puts[1]!.equals(previous)).toBe(true);
  });

  it('does not restore when the database update succeeds', async () => {
    const previous = starterTemplate();
    const next = buildDocx([{ text: 'Ok {{company.name}}' }]);
    const puts: Buffer[] = [];
    const storage = {
      getBuffer: vi.fn().mockResolvedValue(previous),
      putBuffer: vi.fn(async (_tenant: string, _key: string, body: Buffer) => {
        puts.push(Buffer.from(body));
      }),
    };
    let withTenant = 0;
    const database = {
      withTenant: vi.fn(async () => {
        withTenant += 1;
        if (withTenant === 1) return { id: 'tpl-1', key: 'templates/tpl-1.docx', name: 'Original' };
        return {
          id: 'tpl-1',
          name: 'Next',
          docType: 'Quote',
          fileName: 'next.docx',
          sizeBytes: next.length,
          placeholders: ['company.name'],
          uploadedByUserId: ctx.userId,
          uploadedByName: 'Owner',
          createdAt: new Date(),
        };
      }),
    };
    const service = new DocumentsService(database as never, storage as never, { record: vi.fn() } as never, {} as never);

    await service.replaceTemplate(ctx, 'tpl-1', uploaded(next), { name: 'Next', docType: 'Quote' });
    expect(puts).toHaveLength(1);
    expect(puts[0]!.equals(next)).toBe(true);
    expect(storage.getBuffer).toHaveBeenCalledOnce();
  });
});
