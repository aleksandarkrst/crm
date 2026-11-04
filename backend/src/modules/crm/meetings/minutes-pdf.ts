import PDFDocument from 'pdfkit';
import type { CustomerEmailLanguage, MeetingType } from '../../../shared/database/schema';
import { pngPixelDataOk } from '../../../shared/images/png';
import { zonedParts } from '../../../shared/time/zoned-time';
import { BULLET, dayLabel, type ExternalNextStep, type InlineRun, inlineRuns } from './minutes-email';
import { PULTLY_MARK_PNG } from './minutes-pdf-mark';

/**
 * The external minutes as a PDF (CD-378), in the layout of the agreed template
 * (Pultly_Meeting_Minutes_Template.docx): a header with the workspace logo and name on every page,
 * the title block, 01 Meeting details, 02 Summary (the external text as the email has it), 03 Next
 * steps (the same steps as the email), the closing line and a footer with "Page X of Y".
 *
 * `minutesPdfContent` decides what goes in (pure, unit-tested): an empty field or section is left
 * out with its label or heading, and no member's email address gets in (a name that is one is
 * dropped, as `externalNextSteps` does for owners). `renderMinutesPdf` lays it out with pdfkit and
 * the DejaVu fonts (č, ć, đ, š, ž), like the hr-documents engine, but with its own layout.
 */

export interface MinutesPdfInput {
  language: CustomerEmailLanguage;
  timeZone: string;
  workspaceName: string;
  /** The workspace logo (PNG or JPEG), or null for the name only. */
  logo: Buffer | null;
  /** The email's subject. */
  subject: string;
  meeting: {
    title: string;
    type: MeetingType;
    startsAt: Date;
    endsAt: Date;
    location: string | null;
    companyName: string;
    organizerName: string | null;
    internalNames: string[];
    externalNames: string[];
  };
  /** The external minutes text, as the email has it before the next steps. */
  summary: string;
  nextSteps: readonly ExternalNextStep[];
}

interface Labels {
  /** The PDF's title in its properties when the subject is empty. */
  docTitle: string;
  details: string;
  summary: string;
  nextSteps: string;
  date: string;
  time: string;
  type: string;
  location: string;
  company: string;
  organizer: string;
  participants: string;
  step: string;
  owner: string;
  due: string;
  to: string;
  closing: string;
  generatedWith: string;
  page: (n: number, of: number) => string;
  types: Record<MeetingType, string>;
}

const LABELS: Record<CustomerEmailLanguage, Labels> = {
  en: {
    docTitle: 'Meeting minutes',
    details: 'Meeting details',
    summary: 'Summary',
    nextSteps: 'Next steps',
    date: 'Date',
    time: 'Time',
    type: 'Meeting type',
    location: 'Location',
    company: 'Company',
    organizer: 'Organizer',
    participants: 'Participants',
    step: 'Next step',
    owner: 'Owner',
    due: 'Due date',
    to: 'to',
    closing: 'If anything in these minutes does not match your notes, simply reply to this email and we will update them.',
    generatedWith: 'Generated with',
    page: (n, of) => `Page ${n} of ${of}`,
    types: { visit: 'Customer visit', online: 'Online meeting', office: 'Meeting at our office', phone: 'Phone call' },
  },
  sr: {
    docTitle: 'Zapisnik sa sastanka',
    details: 'Detalji sastanka',
    summary: 'Rezime',
    nextSteps: 'Sledeći koraci',
    date: 'Datum',
    time: 'Vreme',
    type: 'Vrsta sastanka',
    location: 'Mesto',
    company: 'Kompanija',
    organizer: 'Organizator',
    participants: 'Učesnici',
    step: 'Sledeći korak',
    owner: 'Nosilac',
    due: 'Rok',
    to: 'do',
    closing: 'Ako se nešto u ovom zapisniku ne slaže sa vašim beleškama, samo odgovorite na ovaj email i ispravićemo ga.',
    generatedWith: 'Napravljeno pomoću',
    page: (n, of) => `Strana ${n} od ${of}`,
    types: { visit: 'Poseta kupcu', online: 'Online sastanak', office: 'Sastanak u našoj kancelariji', phone: 'Telefonski poziv' },
  },
};

/** What the PDF shows, after leaving out what is empty. */
export interface MinutesPdfContent {
  labels: Labels;
  workspaceName: string;
  subject: string;
  /** "Kickoff · 6 Oct 2026" */
  byline: string;
  /** Label and value pairs in the template's order; participants on their own row. */
  details: { label: string; value: string }[];
  participants: { label: string; lines: string[] } | null;
  /** The summary's lines; null when there is no text. */
  summary: string[] | null;
  nextSteps: { text: string; owner: string; due: string }[];
}

/** A name fit for the customer: none when blank or an email address (sign-ups are named by their email until they set a name). */
const customerName = (name: string | null | undefined): string | null => {
  const v = name?.trim();
  return v && !v.includes('@') ? v : null;
};

export function minutesPdfContent(input: MinutesPdfInput): MinutesPdfContent {
  const labels = LABELS[input.language] ?? LABELS.en;
  const m = input.meeting;
  const start = zonedParts(m.startsAt, input.timeZone);
  const end = zonedParts(m.endsAt, input.timeZone);
  const date = dayLabel(start.date, input.language);
  const time = start.date === end.date ? `${start.time} ${labels.to} ${end.time}` : `${start.time} ${labels.to} ${dayLabel(end.date, input.language)} ${end.time}`;
  const details = [
    { label: labels.date, value: date },
    { label: labels.time, value: time },
    { label: labels.type, value: labels.types[m.type] ?? '' },
    { label: labels.location, value: m.location?.trim() ?? '' },
    { label: labels.company, value: m.companyName.trim() },
    { label: labels.organizer, value: customerName(m.organizerName) ?? '' },
  ].filter((d) => d.value);
  const names = (list: string[]) => list.flatMap((n) => customerName(n) ?? []).join(', ');
  const ours = names(m.internalNames);
  const theirs = names(m.externalNames);
  const lines = [ours ? `${input.workspaceName.trim() || '—'}: ${ours}` : null, theirs ? `${m.companyName.trim() || '—'}: ${theirs}` : null].filter((l): l is string => !!l);
  const summary = input.summary.replace(/\r\n?/g, '\n').trim();
  return {
    labels,
    workspaceName: input.workspaceName.trim(),
    subject: input.subject.replace(/[\r\n]+/g, ' ').trim(),
    byline: [m.title.trim(), date].filter(Boolean).join('  ·  '),
    details,
    participants: lines.length ? { label: labels.participants, lines } : null,
    summary: summary ? summary.split('\n') : null,
    nextSteps: input.nextSteps
      .filter((s) => s.text.trim())
      .map((s) => ({ text: s.text.trim(), owner: customerName(s.owner) ?? '', due: s.dueDate ? dayLabel(s.dueDate, input.language) : '' })),
  };
}

/** The attachment's name: "Minutes <meeting title> <yyyy-mm-dd>.pdf", without characters a file name can't hold. */
export function minutesPdfFileName(title: string, startsAt: Date, timeZone: string): string {
  const safe = title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    // Control characters too (a title is one line, but never trust it in a file name).
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}+/gu, '')
    .trim()
    .slice(0, 120);
  return `${['Minutes', safe, zonedParts(startsAt, timeZone).date].filter(Boolean).join(' ')}.pdf`;
}

/**
 * Runs cut at spaces into consecutive pieces, each as long as `fits` allows (a single word that
 * doesn't fit still makes a piece of its own). One piece when the whole line fits.
 */
export function pieces(runs: InlineRun[], fits: (text: string) => boolean): InlineRun[][] {
  if (fits(runs.map((r) => r.text).join(''))) return [runs];
  const words = runs.flatMap((r) => r.text.split(/(?<=\s)/).map((text) => ({ ...r, text })));
  const textOf = (from: number, to: number) => words.slice(from, to).map((w) => w.text).join('');
  const out: InlineRun[][] = [];
  for (let start = 0; start < words.length; ) {
    // The most words from `start` that fit (fitting only gets harder with more words): a binary search.
    let lo = start + 1;
    let hi = words.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(textOf(start, mid))) lo = mid;
      else hi = mid - 1;
    }
    out.push(merged(words.slice(start, lo)));
    start = lo;
  }
  return out;
}

/** Neighbouring runs with the same formatting as one. */
function merged(runs: InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.bold === r.bold && last.italic === r.italic && last.underline === r.underline && last.url === r.url) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/** A line of the summary as runs, with the email's formatting (`inlineRuns`). */
export function summaryRuns(line: string): { bullet: boolean; runs: InlineRun[] } {
  const bullet = BULLET.exec(line);
  return { bullet: !!bullet, runs: inlineRuns(bullet ? bullet[1]! : line) };
}

// ---------------------------------------------------------------- layout

/** The template's colours. */
const C = {
  brand: '#14503C',
  title: '#0D241C',
  text: '#0F1B16',
  label: '#475750',
  muted: '#6B7B73',
  faint: '#93A39B',
  lime: '#C6F16A',
  rule: '#E2E8E4',
  labelFill: '#F3F8F6',
  headFill: '#D7E9E1',
  headText: '#0C3226',
};

const BODY_FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const BOLD_FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
const ITALIC_FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf');
const BOLD_ITALIC_FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf');
const PAGE = { left: 45, right: 45, top: 84, bottom: 62 };
const PAD = 7;

/** An image opened once and placed on every page: pdfkit has `openImage` and takes its result in `image`, its types don't. */
interface PdfImage {
  width: number;
  height: number;
}
const openImage = (doc: PDFKit.PDFDocument, src: Buffer): PdfImage => (doc as unknown as { openImage(src: Buffer): PdfImage }).openImage(src);
const asSrc = (image: PdfImage) => image as unknown as Buffer;
/**
 * The logo opened, or null when it can't be printed: then the header has the name only. A PNG whose
 * pixel data doesn't decode never reaches pdfkit, which would decode it later where the error can't
 * be caught and ends the process (logos stored before the upload checked this too).
 */
function usableLogo(doc: PDFKit.PDFDocument, logo: Buffer): PdfImage | null {
  const png = logo.length >= 8 && logo.readUInt32BE(0) === 0x89504e47;
  if (png && !pngPixelDataOk(logo)) return null;
  try {
    return openImage(doc, logo);
  } catch {
    return null;
  }
}
/** No ligatures: DejaVu's ff and fi would copy and search as "ofer" (fontkit takes a feature object; pdfkit's types say a list). */
const PLAIN = { features: { liga: false, clig: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[] };

/** Renders the minutes to a PDF (A4, embedded fonts), as a buffer. */
export function renderMinutesPdf(input: MinutesPdfInput): Promise<Buffer> {
  const content = minutesPdfContent(input);
  const L = content.labels;
  const doc = new PDFDocument({
    size: 'A4',
    margins: PAGE,
    bufferPages: true,
    info: { Title: content.subject || L.docTitle, Author: content.workspaceName, Producer: 'Pultly', Creator: 'Pultly' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('Body', BODY_FONT);
  doc.registerFont('Bold', BOLD_FONT);
  doc.registerFont('Italic', ITALIC_FONT);
  doc.registerFont('BoldItalic', BOLD_ITALIC_FONT);
  const x0 = PAGE.left;
  const width = doc.page.width - PAGE.left - PAGE.right;
  const limit = () => doc.page.height - PAGE.bottom;
  /** Starts a new page unless `height` still fits on this one. */
  const room = (height: number) => {
    if (doc.y + height > limit()) doc.addPage();
  };

  // Title block (first page): the subject, then the meeting and its date in regular weight.
  doc.y = PAGE.top;
  if (content.subject) {
    doc.font('Bold').fontSize(16).fillColor(C.title).text(content.subject, x0, doc.y, { ...PLAIN, width });
    doc.moveDown(0.35);
  }
  doc.font('Body').fontSize(8.5).fillColor(C.muted).text(content.byline, x0, doc.y, { ...PLAIN, width });
  doc.rect(x0, doc.y + 6, 38, 3).fill(C.lime);
  doc.y += 30;

  let number = 0;
  /** A section heading, kept with `next` points of what follows it. */
  const heading = (title: string, next: number) => {
    room(28 + next);
    const y = doc.y;
    number += 1;
    doc.rect(x0 - 6, y - 2, 3, 17).fill(C.lime);
    doc.font('Bold').fontSize(7.5).fillColor(C.faint).text(String(number).padStart(2, '0'), x0 + 4, y + 3, { ...PLAIN, lineBreak: false });
    doc.font('Bold').fontSize(10).fillColor(C.title).text(title, x0 + 22, y, { ...PLAIN, width: width - 22 });
    doc.y = y + 22;
  };

  /** One table cell's text; returns its height. */
  const cellHeight = (text: string, w: number, font = 'Body', size = 9) => doc.font(font).fontSize(size).heightOfString(text || ' ', { ...PLAIN, width: w - 2 * PAD, lineGap: 1.5 }) + 2 * PAD;
  const cell = (text: string, x: number, y: number, w: number, h: number, opts: { fill?: string; color?: string; font?: string; size?: number; align?: 'left' | 'center' } = {}) => {
    if (opts.fill) doc.rect(x, y, w, h).fill(opts.fill);
    doc.lineWidth(0.6).rect(x, y, w, h).stroke(C.rule);
    doc
      .font(opts.font ?? 'Body')
      .fontSize(opts.size ?? 9)
      .fillColor(opts.color ?? C.text)
      .text(text, x + PAD, y + PAD, { ...PLAIN, width: w - 2 * PAD, lineGap: 1.5, align: opts.align ?? 'left' });
  };

  // 01 Meeting details: label and value, two pairs a row; the organizer and the participants on a row of their own.
  if (content.details.length || content.participants) {
    heading(L.details, 30);
    const lw = 95;
    const vw = width / 2 - lw;
    const paired = content.details.filter((d) => d.label !== L.organizer);
    const wide = content.details.filter((d) => d.label === L.organizer).map((d) => ({ label: d.label, value: d.value }));
    if (content.participants) wide.push({ label: content.participants.label, value: content.participants.lines.join('\n') });
    for (let i = 0; i < paired.length; i += 2) {
      const pair = paired.slice(i, i + 2);
      // A detail without a partner takes the whole row.
      const valueWidth = pair.length === 1 ? width - lw : vw;
      const h = Math.max(26, ...pair.map((d) => cellHeight(d.value, valueWidth)));
      room(h);
      const y = doc.y;
      pair.forEach((d, k) => {
        const x = x0 + k * (lw + vw);
        cell(d.label, x, y, lw, h, { fill: C.labelFill, color: C.label, font: 'Body', size: 8 });
        cell(d.value, x + lw, y, valueWidth, h);
      });
      doc.y = y + h;
    }
    for (const row of wide) {
      const h = Math.max(26, cellHeight(row.value, width - lw));
      room(h);
      const y = doc.y;
      cell(row.label, x0, y, lw, h, { fill: C.labelFill, color: C.label, font: 'Body', size: 8 });
      cell(row.value, x0 + lw, y, width - lw, h);
      doc.y = y + h;
    }
    doc.y += 22;
  }

  // 02 Summary: the text on a tinted panel with a dark green edge, line by line so it breaks across pages.
  if (content.summary) {
    heading(L.summary, 40);
    const inner = width - 2 * PAD - 8;
    // Bold is wider: measure with it so the panel is never shorter than its text.
    const measure = (text: string, w: number) => doc.font('Bold').fontSize(9).heightOfString(text, { ...PLAIN, width: w, lineGap: 2 });
    // A paragraph taller than a page is cut into pieces that each fit one, so no panel runs over the footer.
    const pageText = limit() - PAGE.top - 2 * (PAD + 2) - 2;
    const lines = content.summary.flatMap((line) => {
      const { bullet, runs } = summaryRuns(line);
      const w = inner - (bullet ? 12 : 0);
      return pieces(runs, (text) => measure(text, w) <= pageText).map((part, k) => ({ bullet: bullet && k === 0, indent: bullet ? 12 : 0, runs: part }));
    });
    lines.forEach(({ bullet, indent, runs }, i) => {
      const plain = runs.map((r) => r.text).join('');
      const top = i === 0 ? PAD + 2 : 0;
      const bottom = i === lines.length - 1 ? PAD + 2 : 0;
      const textHeight = plain.trim() ? measure(plain, inner - indent) : 7;
      const h = top + textHeight + bottom + 1;
      room(Math.min(h, limit() - PAGE.top));
      const y = doc.y;
      doc.rect(x0, y, width, h).fill(C.labelFill);
      doc.rect(x0, y, 2.5, h).fill(C.brand);
      if (plain.trim()) {
        const tx = x0 + PAD + 8 + indent;
        if (bullet) doc.font('Bold').fontSize(9).fillColor(C.text).text('•', tx - 10, y + top, { ...PLAIN, lineBreak: false });
        doc.x = tx;
        doc.y = y + top;
        runs.forEach((r, k) => {
          doc
            .font(r.bold ? (r.italic ? 'BoldItalic' : 'Bold') : r.italic ? 'Italic' : 'Body')
            .fontSize(9)
            .fillColor(r.url ? C.brand : C.text);
          const opts = { ...PLAIN, width: inner - indent, lineGap: 2, continued: k < runs.length - 1, link: r.url ?? null, underline: !!(r.url || r.underline) };
          if (k === 0) doc.text(r.text, tx, y + top, opts);
          else doc.text(r.text, opts);
        });
      }
      doc.x = x0;
      doc.y = y + h;
    });
    doc.y += 22;
  }

  // 03 Next steps: a numbered table, its header repeated on a new page.
  if (content.nextSteps.length) {
    const cols = [31, 254, 130, width - 31 - 254 - 130];
    const xs = cols.map((_, i) => x0 + cols.slice(0, i).reduce((a, b) => a + b, 0));
    const head = () => {
      const y = doc.y;
      const titles = ['#', L.step, L.owner, L.due];
      titles.forEach((t, i) => cell(t, xs[i]!, y, cols[i]!, 26, { fill: C.headFill, color: C.headText, font: 'Bold', size: 8, align: i === 0 || i === 3 ? 'center' : 'left' }));
      doc.y = y + 26;
    };
    const rowHeight = (s: (typeof content.nextSteps)[number]) => Math.max(26, cellHeight(s.text, cols[1]!), cellHeight(s.owner, cols[2]!), cellHeight(s.due, cols[3]!));
    heading(L.nextSteps, 26 + rowHeight(content.nextSteps[0]!));
    head();
    content.nextSteps.forEach((s, i) => {
      const h = rowHeight(s);
      if (doc.y + h > limit()) {
        doc.addPage();
        head();
      }
      const y = doc.y;
      cell(String(i + 1), xs[0]!, y, cols[0]!, h, { color: C.faint, size: 8, align: 'center' });
      cell(s.text, xs[1]!, y, cols[1]!, h);
      cell(s.owner, xs[2]!, y, cols[2]!, h);
      cell(s.due, xs[3]!, y, cols[3]!, h, { align: 'center' });
      doc.y = y + h;
    });
    doc.y += 22;
  }

  // The closing line.
  room(40);
  doc.lineWidth(0.6).moveTo(x0, doc.y).lineTo(x0 + width, doc.y).stroke(C.rule);
  doc.font('Body').fontSize(7.5).fillColor(C.muted).text(L.closing, x0, doc.y + 12, { ...PLAIN, width });

  // Header and footer on every page, once the page count is known.
  const logo = input.logo ? usableLogo(doc, input.logo) : null;
  const mark = openImage(doc, PULTLY_MARK_PNG);
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing in the margin must not start a new page
    let nameX = x0;
    if (logo) {
      const scale = Math.min(110 / logo.width, 38 / logo.height);
      doc.image(asSrc(logo), x0, 22 + (38 - logo.height * scale) / 2, { width: logo.width * scale, height: logo.height * scale });
      nameX = x0 + logo.width * scale + 12;
    }
    doc
      .font('Bold')
      .fontSize(9.5)
      .fillColor(C.text)
      .text(content.workspaceName, nameX, 36, { ...PLAIN, width: x0 + width - nameX, align: logo ? 'right' : 'left', lineBreak: false, ellipsis: true });
    doc.lineWidth(0.8).moveTo(x0, 68).lineTo(x0 + width, 68).stroke(C.rule);

    const fy = doc.page.height - 38;
    doc.lineWidth(0.6).moveTo(x0, fy - 10).lineTo(x0 + width, fy - 10).stroke(C.rule);
    doc.image(asSrc(mark), x0, fy - 1.5, { width: 9, height: 9 });
    // Regular text; the "pultly" wordmark stays bold, as in the template.
    doc.font('Body').fontSize(7.5).fillColor(C.faint).text(`${L.generatedWith} `, x0 + 13, fy, { ...PLAIN, continued: true, lineBreak: false });
    doc.font('Bold').fillColor(C.title).text('pultly', { ...PLAIN, lineBreak: false });
    doc
      .font('Body')
      .fillColor(C.faint)
      .text(L.page(i - pages.start + 1, pages.count), x0, fy, { ...PLAIN, width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
