import { describe, expect, it } from 'vitest';
import { type MinutesPdfInput, minutesPdfContent, minutesPdfFileName, renderMinutesPdf, summaryRuns } from '../src/modules/crm/meetings/minutes-pdf';
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
