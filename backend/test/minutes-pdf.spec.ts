import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { type MinutesPdfInput, minutesPdfContent, minutesPdfFileName, pieces, renderMinutesPdf, summaryRuns } from '../src/modules/crm/meetings/minutes-pdf';
import { pngPixelDataOk } from '../src/shared/images/png';
import { logoContentType, logoProblem } from '../src/modules/identity/workspace-logo';
import { PULTLY_MARK_PNG } from '../src/modules/crm/meetings/minutes-pdf-mark';

/** The external minutes PDF (CD-378): what goes in, the file name, and that it renders. */

const base: MinutesPdfInput = {
  language: 'en',
  timeZone: 'Europe/Belgrade',
  workspaceName: 'Simplicity Labs',
  logo: null,
  subject: 'Minutes: Kickoff, 6 Oct 2026',
  meeting: {
    title: 'Kickoff',
    type: 'visit',
    startsAt: new Date('2026-10-06T08:00:00Z'),
    endsAt: new Date('2026-10-06T09:30:00Z'),
    location: 'Bulevar Mihajla Pupina 10',
    companyName: 'Acme d.o.o.',
    organizerName: 'Ana Petrović',
    internalNames: ['Ana Petrović', 'Ivan Jovanović'],
    externalNames: ['Đorđe Šćekić'],
  },
  summary: '**Kickoff**\nWe agreed on the scope.',
  nextSteps: [{ text: 'Send the offer', owner: 'Ana Petrović', dueDate: '2026-10-20' }],
};

/** Pages in a PDF pdfkit wrote: its page tree's /Count. */
const pageCount = (pdf: Buffer) => Number(/\/Type \/Pages\s*\/Count (\d+)/.exec(pdf.toString('latin1'))?.[1]);

describe('minutesPdfContent', () => {
  it('has the meeting details in the template order, with the time in the workspace zone', () => {
    const c = minutesPdfContent(base);
    expect(c.details).toEqual([
      { label: 'Date', value: '6 Oct 2026' },
      { label: 'Time', value: '10:00 to 11:30' },
      { label: 'Meeting type', value: 'Customer visit' },
      { label: 'Location', value: 'Bulevar Mihajla Pupina 10' },
      { label: 'Company', value: 'Acme d.o.o.' },
      { label: 'Organizer', value: 'Ana Petrović' },
    ]);
    expect(c.participants).toEqual({ label: 'Participants', lines: ['Simplicity Labs: Ana Petrović, Ivan Jovanović', 'Acme d.o.o.: Đorđe Šćekić'] });
    expect(c.byline).toBe('Kickoff  ·  6 Oct 2026');
    expect(c.summary).toEqual(['**Kickoff**', 'We agreed on the scope.']);
    expect(c.nextSteps).toEqual([{ text: 'Send the offer', owner: 'Ana Petrović', due: '20 Oct 2026' }]);
  });

  it('leaves out empty fields and sections', () => {
    const c = minutesPdfContent({ ...base, summary: '  \n ', nextSteps: [{ text: '  ', owner: null, dueDate: null }], meeting: { ...base.meeting, location: '  ', organizerName: null, internalNames: [], externalNames: [] } });
    expect(c.details.map((d) => d.label)).toEqual(['Date', 'Time', 'Meeting type', 'Company']);
    expect(c.participants).toBeNull();
    expect(c.summary).toBeNull();
    expect(c.nextSteps).toEqual([]);
  });

  it("never shows a member's email address: a name that is one is left out", () => {
    const c = minutesPdfContent({ ...base, meeting: { ...base.meeting, organizerName: 'ana@example.com', internalNames: ['ana@example.com', 'Ivan Jovanović'] }, nextSteps: [{ text: 'Call', owner: 'ivan@example.com', dueDate: null }] });
    expect(JSON.stringify(c)).not.toContain('@');
    expect(c.details.map((d) => d.label)).not.toContain('Organizer');
    expect(c.participants?.lines[0]).toBe('Simplicity Labs: Ivan Jovanović');
    expect(c.nextSteps[0]).toEqual({ text: 'Call', owner: '', due: '' });
  });

  it('has Serbian labels and dates for Serbian minutes', () => {
    const c = minutesPdfContent({ ...base, language: 'sr' });
    expect(c.labels.docTitle).toBe('Zapisnik sa sastanka');
    expect(c.details.map((d) => d.label)).toEqual(['Datum', 'Vreme', 'Vrsta sastanka', 'Mesto', 'Kompanija', 'Organizator']);
    expect(c.details[1]!.value).toBe('10:00 do 11:30');
    expect(c.nextSteps[0]!.due).toBe('20. 10. 2026.');
    expect(c.labels.page(2, 3)).toBe('Strana 2 od 3');
  });

  it('shows the end date of a meeting over midnight', () => {
    const c = minutesPdfContent({ ...base, meeting: { ...base.meeting, endsAt: new Date('2026-10-07T07:00:00Z') } });
    expect(c.details[1]!.value).toBe('10:00 to 7 Oct 2026 09:00');
  });
});

describe('summaryRuns', () => {
  it('reads bold, links and bullets like the email', () => {
    expect(summaryRuns('- See **this** and [the plan](https://x.test/p) or https://x.test/q.')).toEqual({
      bullet: true,
      runs: [{ text: 'See ' }, { text: 'this', bold: true }, { text: ' and ' }, { text: 'the plan', url: 'https://x.test/p' }, { text: ' or ' }, { text: 'https://x.test/q', url: 'https://x.test/q' }, { text: '.' }],
    });
    expect(summaryRuns('plain')).toEqual({ bullet: false, runs: [{ text: 'plain' }] });
  });
});

describe('minutesPdfFileName', () => {
  it('is "Minutes <title> <date>.pdf", the date in the workspace zone', () => {
    expect(minutesPdfFileName('Kickoff with Acme', new Date('2026-10-05T23:30:00Z'), 'Europe/Belgrade')).toBe('Minutes Kickoff with Acme 2026-10-06.pdf');
  });
  it('drops what a file name can not hold', () => {
    expect(minutesPdfFileName('Q3 / Q4: "plan"?\u0007', new Date('2026-10-06T08:00:00Z'), 'UTC')).toBe("Minutes Q3 Q4 plan 2026-10-06.pdf");
  });
});

describe('renderMinutesPdf', () => {
  it('renders one page for short minutes, with or without a logo', async () => {
    const plain = await renderMinutesPdf(base);
    expect(plain.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(plain)).toBe(1);
    const withLogo = await renderMinutesPdf({ ...base, logo: PULTLY_MARK_PNG });
    expect(pageCount(withLogo)).toBe(1);
    expect(withLogo.length).toBeGreaterThan(plain.length);
  });

  it('breaks long minutes and many next steps across pages', async () => {
    const summary = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}. ${'The team reviewed the schedule and the risks in detail. '.repeat(4)}`).join('\n\n');
    const nextSteps = Array.from({ length: 30 }, (_, i) => ({ text: `Step ${i + 1}`, owner: 'Ana Petrović', dueDate: '2026-10-20' }));
    expect(pageCount(await renderMinutesPdf({ ...base, summary, nextSteps }))).toBeGreaterThan(2);
  });
});

describe('workspace logo', () => {
  const file = (buffer: Buffer) => ({ originalname: 'logo', mimetype: 'image/png', size: buffer.length, buffer });
  it('takes a PNG or JPEG by its bytes, not by what it claims', () => {
    expect(logoContentType(PULTLY_MARK_PNG)).toBe('image/png');
    expect(logoContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(logoContentType(Buffer.from('GIF89a'))).toBeNull();
  });
  it('says what is wrong with a file it refuses', () => {
    expect(logoProblem(file(PULTLY_MARK_PNG))).toBeNull();
    expect(logoProblem(undefined)).toBe('Choose a PNG or JPG image');
    expect(logoProblem(file(Buffer.from('GIF89a......')))).toBe('The logo must be a PNG or JPG image.');
    expect(logoProblem({ ...file(PULTLY_MARK_PNG), size: 1024 * 1024 + 1 })).toBe('The logo can be at most 1 MB. Choose a smaller image.');
    expect(logoProblem(file(Buffer.concat([PULTLY_MARK_PNG.subarray(0, 40)])))).toMatch(/can't be read/);
  });
});

/** A PNG built here: `pixels` is the raw scanline data (each row a filter byte, then the pixels). */
function png(width: number, height: number, colourType: number, interlace: number, idat: Buffer, depth = 8, extra: Buffer[] = []): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colourType;
  ihdr[12] = interlace;
  const more = extra.map((c) => chunk(c.toString('latin1', 0, 4), c.subarray(4)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...more, chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
/** An image's Adam7 passes (width, height) by the PNG specification. */
const adam7 = (w: number, h: number): [number, number][] =>
  [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]].map(([xs, ys, dx, dy]) => [Math.ceil(Math.max(0, w - xs!) / dx!), Math.ceil(Math.max(0, h - ys!) / dy!)]);
/** Rows of zero pixels with filter 0, for each pass. */
const rows = (passes: [number, number][], bytesPerPixel: number) => Buffer.concat(passes.filter(([w, h]) => w && h).map(([w, h]) => Buffer.alloc(h * (1 + w * bytesPerPixel))));
// A 4x4 image's Adam7 passes: widths and heights.
const ADAM7_4x4: [number, number][] = [[1, 1], [0, 1], [1, 0], [1, 1], [2, 1], [2, 2], [4, 2]];

describe('PNG pixel data (CD-378 review: a broken PNG must not reach pdfkit)', () => {
  const rgba = png(4, 4, 6, 0, deflateSync(rows([[4, 4]], 4)));
  const interlaced = png(4, 4, 6, 1, deflateSync(rows(ADAM7_4x4, 4)));
  const garbage = png(4, 4, 6, 0, Buffer.from('this is not zlib data at all, just garbage bytes'));
  const short = png(4, 4, 6, 0, deflateSync(rows([[4, 3]], 4)));
  const badFilter = png(4, 4, 2, 0, deflateSync(Buffer.alloc(4 * (1 + 12), 9)));

  it('accepts whole images, interlaced too', () => {
    expect(pngPixelDataOk(rgba)).toBe(true);
    expect(pngPixelDataOk(interlaced)).toBe(true);
    expect(pngPixelDataOk(PULTLY_MARK_PNG)).toBe(true);
  });

  it('refuses corrupt, short or wrongly filtered pixel data, and what is not a PNG', () => {
    expect(pngPixelDataOk(garbage)).toBe(false);
    expect(pngPixelDataOk(short)).toBe(false);
    expect(pngPixelDataOk(badFilter)).toBe(false);
    expect(pngPixelDataOk(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
  });

  it('refuses such a logo on upload, and a PDF with one stored earlier leaves it out; the process lives on', async () => {
    const file = (buffer: Buffer) => ({ originalname: 'logo.png', mimetype: 'image/png', size: buffer.length, buffer });
    expect(logoProblem(file(garbage))).toMatch(/can't be read/);
    expect(logoProblem(file(rgba))).toBeNull();
    const pdf = await renderMinutesPdf({ ...base, logo: garbage });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // pdfkit's asynchronous decode would have thrown by now and ended the run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pageCount(pdf)).toBe(1);
  });
});

describe('PNGs pdfkit decodes its own way (CD-378 review, round 2)', () => {
  // Valid by the specification, but png-js reads a filter byte for each row of the empty passes of a
  // narrow interlaced image and so takes the pixel bytes (202) for filter types.
  const narrow = png(1, 8, 0, 1, deflateSync(Buffer.concat(adam7(1, 8).filter(([w, h]) => w && h).flatMap(([, h]) => Array.from({ length: h }, () => Buffer.from([0, 202]))))));
  // A 3x3 palette image at 1 bit a pixel with transparency: png-js sizes its buffer as 9 x 1/8 bytes and throws.
  const palette = png(3, 3, 3, 0, deflateSync(Buffer.alloc(3 * 2)), 1, [Buffer.concat([Buffer.from('PLTE'), Buffer.alloc(6, 7)]), Buffer.concat([Buffer.from('tRNS'), Buffer.from([0])])]);
  // The same palette image without transparency is embedded as it is, not decoded: fine.
  const opaque = png(3, 3, 3, 0, deflateSync(Buffer.alloc(3 * 2)), 1, [Buffer.concat([Buffer.from('PLTE'), Buffer.alloc(6, 7)])]);

  it('refuses them, and keeps what pdfkit embeds without decoding', () => {
    expect(pngPixelDataOk(narrow)).toBe(false);
    expect(pngPixelDataOk(palette)).toBe(false);
    expect(pngPixelDataOk(opaque)).toBe(true);
  });

  it('renders a PDF with such a logo stored, without it, and the process lives on', async () => {
    for (const logo of [narrow, palette]) {
      const pdf = await renderMinutesPdf({ ...base, logo });
      expect(pageCount(pdf)).toBe(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

describe('long summary paragraphs (CD-378 review)', () => {
  it('cuts a paragraph that does not fit into pieces at spaces, keeping the text and its formatting', () => {
    const runs = [{ text: 'one two three ' }, { text: 'four five', bold: true }, { text: ' six seven eight nine ten' }];
    const parts = pieces(runs, (t) => t.length <= 12);
    const texts = parts.map((p) => p.map((r) => r.text).join(''));
    expect(texts.join('')).toBe('one two three four five six seven eight nine ten');
    expect(parts.length).toBeGreaterThan(1);
    expect(texts.every((t) => t.length <= 12)).toBe(true);
    expect(parts.flat().filter((r) => r.bold).map((r) => r.text).join('')).toBe('four five');
    expect(pieces(runs, () => true)).toEqual([runs]);
  });

  it('puts a paragraph taller than a page on several pages', async () => {
    const pdf = await renderMinutesPdf({ ...base, summary: Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ') });
    expect(pageCount(pdf)).toBeGreaterThan(1);
  });
});
