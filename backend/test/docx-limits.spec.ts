import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { buildDocx, inspectTemplate, renderTemplate, starterTemplate, TemplateFileError } from '../src/modules/crm/documents/docx';
import type { TemplateData } from '../src/modules/crm/documents/placeholders';

/**
 * Zip bombs (CD-104): a .docx is a zip, and the upload limit (5 MB) applies to the compressed
 * file. What it unpacks to is limited too, by what the entries really inflate to, not by the sizes
 * the zip claims (those can be forged).
 */

/** Rewrites the uncompressed size an entry claims, in its local header and the central directory. */
function forgeSize(zip: Buffer, name: string, size: number): Buffer {
  const out = Buffer.from(zip);
  const nameBytes = Buffer.from(name);
  for (let i = 0; i < out.length - 4; i++) {
    const sig = out.readUInt32LE(i);
    if (sig === 0x04034b50 && out.subarray(i + 30, i + 30 + nameBytes.length).equals(nameBytes)) out.writeUInt32LE(size, i + 22);
    if (sig === 0x02014b50 && out.subarray(i + 46, i + 46 + nameBytes.length).equals(nameBytes)) out.writeUInt32LE(size, i + 24);
  }
  return out;
}

/** A .docx whose document.xml inflates to `bytes` (spaces inside the body: still valid XML). */
function bigDocx(bytes: number): Buffer {
  const zip = new PizZip(buildDocx([{ text: 'Hello {{deal.title}}' }]));
  const xml = zip.file('word/document.xml')!.asText();
  zip.file('word/document.xml', xml.replace('<w:body>', `<w:body>${' '.repeat(bytes)}`));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const tooLarge = (file: Buffer) => {
  for (const run of [() => inspectTemplate(file), () => renderTemplate(file, { lines: [] } as unknown as TemplateData)]) {
    expect(run).toThrow(TemplateFileError);
    expect(run).toThrow('This document is too large once unpacked.');
  }
};

describe('template size limits (CD-104)', () => {
  it('accepts the starter template', () => {
    expect(inspectTemplate(starterTemplate())).toContain('deal.headline');
  });

  it('refuses a document that unpacks to more than the limit', () => {
    const file = bigDocx(70 * 1024 * 1024);
    expect(file.length).toBeLessThan(5 * 1024 * 1024); // passes the upload limit
    tooLarge(file);
  });

  it('refuses it when the zip lies about the unpacked size', () => {
    const file = forgeSize(bigDocx(70 * 1024 * 1024), 'word/document.xml', 1000);
    tooLarge(file);
  });

  it('refuses a document with thousands of parts', () => {
    const zip = new PizZip(buildDocx([{ text: 'x' }]));
    for (let i = 0; i < 5000; i++) zip.file(`word/media/${i}.bin`, 'x');
    expect(() => inspectTemplate(zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }))).toThrow('This document has too many parts.');
  });
});
