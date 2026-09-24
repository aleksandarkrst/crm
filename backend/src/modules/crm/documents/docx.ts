import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { TemplateData } from './placeholders';

/**
 * .docx handling for document templates (CD-13), on docxtemplater's free core (MIT) and PizZip
 * (MIT). Merge fields use double braces (`{{deal.title}}`), as the template dialog promises.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Largest template accepted (the upload limit). */
export const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;
/** A .docx is a zip: refuse ones that unpack to more than this (zip bombs). */
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;

/** A file that isn't a usable template; the message is shown to the person uploading it. */
export class TemplateFileError extends Error {}

const DELIMITERS = { start: '{{', end: '}}' };

function openZip(file: Buffer): PizZip {
  let zip: PizZip;
  try {
    zip = new PizZip(file);
  } catch {
    throw new TemplateFileError('This file is not a Word document (.docx). Save it as .docx and upload it again.');
  }
  if (!zip.file('word/document.xml')) throw new TemplateFileError('This file is not a Word document (.docx): it has no document body.');
  let unpacked = 0;
  for (const entry of Object.values(zip.files)) {
    unpacked += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  }
  if (unpacked > MAX_UNPACKED_BYTES) throw new TemplateFileError('This document is too large once unpacked.');
  return zip;
}

/** Turns docxtemplater's error (often several) into one readable sentence. */
function templateErrorMessage(err: unknown): string {
  const e = err as { properties?: { errors?: { properties?: { explanation?: string } }[]; explanation?: string } };
  const list = e.properties?.errors?.map((x) => x.properties?.explanation).filter(Boolean) ?? [];
  const first = list[0] ?? e.properties?.explanation;
  if (!first) return 'The template could not be read.';
  return `The template has a merge field error: ${first}${list.length > 1 ? ` (and ${list.length - 1} more)` : ''}. Check the {{…}} fields and loops.`;
}

/**
 * Compiles the template with a parser that records every field. Unknown fields render as their
 * own text ("{{typo}}"), so nothing is silently dropped; known fields with no value render empty.
 */
function compile(file: Buffer): { doc: Docxtemplater; tags: Set<string> } {
  const zip = openZip(file);
  const tags = new Set<string>();
  try {
    const doc = new Docxtemplater(zip, {
      delimiters: DELIMITERS,
      paragraphLoop: true,
      linebreaks: true,
      parser(tag: string) {
        const name = tag.trim();
        if (name && name !== '.') tags.add(name);
        return {
          get(scope: unknown) {
            if (name === '.') return scope;
            return scope && typeof scope === 'object' ? (scope as Record<string, unknown>)[name] : undefined;
          },
        };
      },
      nullGetter(part) {
        // Plain fields nobody fills stay visible as written; empty loops and conditions render nothing.
        return part.module ? '' : `{{${part.value}}}`;
      },
    });
    return { doc, tags };
  } catch (err) {
    if (err instanceof TemplateFileError) throw err;
    throw new TemplateFileError(templateErrorMessage(err));
  }
}

/** The merge fields in a template (throws TemplateFileError when it isn't a usable .docx). */
export function inspectTemplate(file: Buffer): string[] {
  return [...compile(file).tags];
}

/** Fills a template. Returns the new .docx and the fields the template used. */
export function renderTemplate(file: Buffer, data: TemplateData): { file: Buffer; tags: string[] } {
  const { doc, tags } = compile(file);
  try {
    doc.render(data);
  } catch (err) {
    throw new TemplateFileError(templateErrorMessage(err));
  }
  return { file: doc.toBuffer({ compression: 'DEFLATE' }), tags: [...tags] };
}

/** The text of a .docx, paragraphs joined by newlines (tests and debugging). */
export function docxText(file: Buffer): string {
  const xml = new PizZip(file).file('word/document.xml')!.asText();
  return xml
    .split(/<\/w:p>/)
    .map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''))
    .filter((p) => p !== '')
    .map((p) => p.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
    .join('\n');
}

// ---------------------------------------------------------------- building a .docx

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A block of a generated document: a paragraph or a table (the first row is the header). */
export type DocxBlock = { text: string; size?: number; bold?: boolean; color?: string } | { table: string[][] };

function paragraph(text: string, opts: { size?: number; bold?: boolean; color?: string } = {}): string {
  const rpr = [opts.bold ? '<w:b/>' : '', opts.color ? `<w:color w:val="${opts.color}"/>` : '', opts.size ? `<w:sz w:val="${opts.size * 2}"/>` : ''].join('');
  return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function table(rows: string[][]): string {
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="D0D5DD"/>`;
  const borders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`;
  const body = rows
    .map((cells, i) => `<w:tr>${cells.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(c, { bold: i === 0 })}</w:tc>`).join('')}</w:tr>`)
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borders}</w:tblPr>${body}</w:tbl>`;
}

/** A minimal, valid .docx (Word, LibreOffice and Google Docs open it). */
export function buildDocx(blocks: DocxBlock[]): Buffer {
  const body = blocks.map((b) => ('table' in b ? table(b.table) : paragraph(b.text, b))).join('');
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * The downloadable starter template: a short proposal that uses the main fields and the deal
 * lines table. Owners copy it, restyle it in Word and upload it as their own.
 */
export function starterTemplate(): Buffer {
  return buildDocx([
    { text: '{{workspace.name}}', size: 11, bold: true, color: '475467' },
    { text: 'PROPOSAL', size: 9, bold: true, color: 'B4531B' },
    { text: '{{deal.headline}}', size: 24, bold: true },
    { text: 'Prepared for {{contact.name}}, {{contact.job_title}} at {{company.name}} · {{today}}', color: '475467' },
    { text: '01 — What you told us', size: 9, bold: true, color: '475467' },
    { text: 'In our discovery call on {{discovery.date}} you described {{discovery.need}} The constraint is {{discovery.constraint}}, and the decision sits with {{discovery.decision_maker}}.' },
    { text: '02 — Investment', size: 9, bold: true, color: '475467' },
    {
      table: [
        ['Item', 'Quantity', 'Unit price', 'VAT', 'Total'],
        ['{{#lines}}{{line.product}}', '{{line.quantity}} {{line.unit}}', '{{line.unit_price}}', '{{line.vat_rate}}', '{{line.total}}{{/lines}}'],
      ],
    },
    { text: 'Net: {{deal.amount}} · VAT: {{deal.vat}}' },
    { text: 'Total incl. VAT: {{deal.total}}', size: 14, bold: true },
    { text: 'Next step', bold: true },
    { text: 'A 20-minute walkthrough with {{contact.first_name}}. Reply to {{owner.name}} ({{owner.email}}) to book it.' },
  ]);
}
