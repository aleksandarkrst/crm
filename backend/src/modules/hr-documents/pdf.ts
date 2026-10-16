import PDFDocument from 'pdfkit';

/**
 * What a generated legal document says (spec 10.3): the renderer below lays it out on A4. Each
 * document type builds one of these from its data snapshot (a vacation decision in the timeoff
 * module); the engine knows nothing about the types.
 */
export interface PdfDocumentSpec {
  /** The company header: legal name first (bold), then address, PIB and MB. */
  header: string[];
  /** "Broj: GO-2026-0001", "Beograd, 16.10.2026." */
  meta: string[];
  /** The paragraph before the title ("Na osnovu … donosi"). */
  intro: string;
  title: string;
  subtitle: string;
  /** Numbered items, the explanation, the legal remedy: each with an optional centred heading. */
  sections: { heading?: string; paragraphs: string[] }[];
  /** "Dostaviti: …" lines. */
  closing: string[];
  signature: { title: string; name: string };
  /** The footer line with the page number appended ("Strana 1/1"). */
  footer: string;
}

/** The built-in layout's version, stored with every document (spec 10.2). */
export const TEMPLATE_VERSION = 1;

/** DejaVu Sans covers Serbian Latin (č, ć, đ, š, ž) and Cyrillic; shipped in node_modules, no internet needed. */
const BODY_FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const BOLD_FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
const MARGIN = 56;

/** Renders the document to a PDF (A4, embedded font), as a buffer. Pure apart from the fonts on disk. */
export function renderPdf(spec: PdfDocumentSpec): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, bufferPages: true, info: { Title: `${spec.title} ${spec.subtitle}`.trim(), Producer: 'Pultly', Creator: 'Pultly' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('Body', BODY_FONT);
  doc.registerFont('Bold', BOLD_FONT);
  const width = doc.page.width - 2 * MARGIN;

  const [name, ...rest] = spec.header;
  doc.font('Bold').fontSize(11).text(name ?? '');
  doc.font('Body').fontSize(9.5);
  for (const line of rest) doc.text(line);
  doc.moveDown(1.5);
  doc.fontSize(10);
  for (const line of spec.meta) doc.text(line);
  doc.moveDown(1.5);
  doc.text(spec.intro, { align: 'justify', lineGap: 2 });
  doc.moveDown(1.5);
  doc.font('Bold').fontSize(15).text(spec.title, { align: 'center', characterSpacing: 3 });
  doc.font('Body').fontSize(10).text(spec.subtitle, { align: 'center' });
  doc.moveDown(1.5);
  for (const section of spec.sections) {
    if (section.heading) {
      doc.font('Bold').text(section.heading, { align: 'center' });
      doc.font('Body');
      doc.moveDown(0.5);
    }
    for (const paragraph of section.paragraphs) {
      doc.text(paragraph, { align: 'justify', lineGap: 2 });
      doc.moveDown(0.7);
    }
    doc.moveDown(0.5);
  }
  doc.moveDown(0.5);
  for (const line of spec.closing) doc.text(line);
  doc.moveDown(2);
  // The signature block on the right, kept on one page.
  const blockHeight = doc.currentLineHeight() * 5;
  if (doc.y + blockHeight > doc.page.height - MARGIN) doc.addPage();
  const x = MARGIN + width / 2;
  doc.font('Bold').text(spec.signature.title, x, doc.y, { width: width / 2, align: 'center' });
  doc.font('Body');
  doc.moveDown(2);
  doc.text('______________________________', x, doc.y, { width: width / 2, align: 'center' });
  doc.text(spec.signature.name, x, doc.y, { width: width / 2, align: 'center' });

  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing in the margin must not start a new page
    doc.font('Body').fontSize(8).fillColor('#666666').text(`${spec.footer} · Strana ${i - pages.start + 1}/${pages.count}`, MARGIN, doc.page.height - MARGIN + 16, { width, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
