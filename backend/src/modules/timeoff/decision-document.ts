import { DocumentDataError, type DocumentRenderer, type PdfDocumentSpec } from '../hr-documents';
import { periodLabel } from './request-emails';

/**
 * The vacation decision (rešenje o korišćenju godišnjeg odmora, CD-167, spec 11.2): pure text
 * building from the data snapshot stored with the document. The renderer registered with the
 * hr-documents engine is at the bottom.
 */

/** Settings → Workspace → Company (spec 10.1), as stored: anything may still be empty. */
export interface CompanyDetails {
  legalName: string | null;
  address: string | null;
  pib: string | null;
  mb: string | null;
  place: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
  legalBasis: string;
}

export interface VacationDecisionData {
  company: CompanyDetails;
  /** The approval date (workspace time) and the submission date. */
  issuedOn: string;
  requestedOn: string;
  employee: { fullName: string; jobTitle: string | null };
  /** The year the decision is for: the pool year of the first day. */
  year: number;
  /** That year's entitlement as computed (spec 5.4), or null when the employee has none. */
  entitlement: { totalDays: number; baseDays: number; experienceDays: number; experienceYears: number; individualDays: number; individualReason: string | null; monthsWorked: number | null } | null;
  /** The request takes the whole remaining entitlement of the year ("ceo godišnji odmor"). */
  whole: boolean;
  startDate: string;
  endDate: string;
  workingDays: number;
  /** The first working day after the end (weekends and holidays skipped). */
  returnDate: string;
  /** Days per pool year; two entries when the request spans two pools. */
  pools: { year: number; days: number }[];
  /** Holidays on working weekdays inside the period. */
  holidays: { date: string; name: string }[];
}

/** "12.10.2026." (Serbian). */
export const srDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}.`;

const COMPANY_LABELS: [keyof Omit<CompanyDetails, 'legalBasis'>, string][] = [
  ['legalName', 'legal name'],
  ['address', 'address'],
  ['pib', 'PIB'],
  ['mb', 'MB'],
  ['place', 'place of issue'],
  ['signatoryName', 'signatory name'],
  ['signatoryTitle', 'signatory title'],
];

/** What Settings → Company still lacks for a decision (spec 10.1), as labels for the error. */
export const missingCompanyDetails = (c: CompanyDetails): string[] => COMPANY_LABELS.filter(([key]) => !c[key]?.trim()).map(([, label]) => label);

const plural = (n: number, one: string, few: string, many: string) => {
  const last = n % 10;
  const tens = n % 100;
  if (last === 1 && tens !== 11) return `${n} ${one}`;
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
};
/** "1 radni dan", "3 radna dana", "20 radnih dana". */
const workingDays = (n: number) => plural(n, 'radni dan', 'radna dana', 'radnih dana');
const years = (n: number) => plural(n, 'godine', 'godine', 'godina');
const months = (n: number) => plural(n, 'mesec', 'meseca', 'meseci');

/** The decision's text (spec 11.2). Throws DocumentDataError when the company details are missing. */
export function buildVacationDecision(d: VacationDecisionData, number: string): PdfDocumentSpec {
  const missing = missingCompanyDetails(d.company);
  if (missing.length) throw new DocumentDataError(`Company details are missing: ${missing.join(', ')}`);
  // Checked just above: every field is filled.
  const c = d.company as { [K in keyof CompanyDetails]: string };
  const e = d.entitlement;
  const total = e ? workingDays(e.totalDays) : workingDays(d.workingDays);
  const part = d.whole ? 'ceo godišnji odmor' : 'deo godišnjeg odmora';
  const split = d.pools.length > 1 ? ` Od toga se ${workingDays(d.pools[0]!.days)} koristi na ime godišnjeg odmora za ${d.pools[0]!.year}. godinu, a ${workingDays(d.pools[1]!.days)} na ime godišnjeg odmora za ${d.pools[1]!.year}. godinu.` : '';
  const basis = e
    ? [
        `${workingDays(e.baseDays)} po osnovu zakona, opšteg akta i ugovora o radu`,
        e.experienceDays ? `uvećano za ${workingDays(e.experienceDays)} po osnovu ${years(e.experienceYears)} radnog iskustva` : '',
        e.individualDays ? `uvećano za ${workingDays(e.individualDays)} po osnovu: ${e.individualReason ?? 'odluke poslodavca'}` : '',
      ]
        .filter(Boolean)
        .join(', ')
    : 'u skladu sa opštim aktom i ugovorom o radu';
  const proportional = e?.monthsWorked !== null && e?.monthsWorked !== undefined ? ` Zaposleni ima pravo na srazmerni deo godišnjeg odmora za ${months(e.monthsWorked)} rada u ${d.year}. godini.` : '';
  const holidays = d.holidays.length ? `: ${d.holidays.map((h) => `${h.name} (${srDate(h.date)})`).join(', ')}` : '';
  return {
    header: [c.legalName, c.address, `PIB: ${c.pib}   MB: ${c.mb}`],
    meta: [`Broj: ${number}`, `${c.place}, ${srDate(d.issuedOn)}`],
    intro: `Na osnovu ${c.legalBasis} i zahteva zaposlenog od ${srDate(d.requestedOn)}, ${c.signatoryTitle.toLowerCase()}, u ime poslodavca ${c.legalName}, donosi`,
    title: 'REŠENJE',
    subtitle: `o korišćenju godišnjeg odmora za ${d.year}. godinu`,
    sections: [
      {
        paragraphs: [
          `1. Zaposlenom ${d.employee.fullName}${d.employee.jobTitle ? `, raspoređenom na poslove ${d.employee.jobTitle}` : ''}, utvrđuje se pravo na godišnji odmor za ${d.year}. godinu u trajanju od ${total}.`,
          `2. Zaposleni će koristiti ${part} u trajanju od ${workingDays(d.workingDays)}, u periodu od ${srDate(d.startDate)} do ${srDate(d.endDate)} godine.${split}`,
          `3. Zaposleni je dužan da se vrati na rad dana ${srDate(d.returnDate)} godine.`,
          '4. Za vreme korišćenja godišnjeg odmora zaposleni ima pravo na naknadu zarade u skladu sa zakonom, opštim aktom i ugovorom o radu.',
        ],
      },
      {
        heading: 'Obrazloženje',
        paragraphs: [
          `Zaposleni je dana ${srDate(d.requestedOn)} podneo/la zahtev za korišćenje godišnjeg odmora. Pravo na godišnji odmor za ${d.year}. godinu utvrđeno je u skladu sa čl. 68. i 69. Zakona o radu u trajanju od ${total}, i to: ${basis}.${proportional}`,
          `U dane godišnjeg odmora ne uračunavaju se dani nedeljnog odmora i praznici koji su neradni dani${holidays}, kao ni odsustva sa rada uz naknadu zarade i privremena sprečenost za rad (član 73. Zakona o radu).${d.whole ? '' : ' Zaposleni koristi godišnji odmor u delovima, u skladu sa članom 73. Zakona o radu.'}`,
          'Na osnovu iznetog, odlučeno je kao u dispozitivu rešenja.',
        ],
      },
      {
        heading: 'Pouka o pravnom leku',
        paragraphs: ['Protiv ovog rešenja zaposleni može pokrenuti spor pred nadležnim sudom u roku od 60 dana od dana dostavljanja rešenja.'],
      },
    ],
    closing: ['Dostaviti:', '– zaposlenom', '– arhivi (personalni dosije)'],
    signature: { title: 'ZA POSLODAVCA', name: `${c.signatoryName}, ${c.signatoryTitle}` },
    footer: `Rešenje o korišćenju godišnjeg odmora ${number} · Generated with Pultly`,
  };
}

/** The registration with the hr-documents engine (spec 10.3). */
export const vacationDecisionRenderer: DocumentRenderer<VacationDecisionData> = {
  label: 'vacation decision',
  render: (snapshot, doc) => buildVacationDecision(snapshot, doc.number),
  fileName: (doc) => `Resenje-${doc.number}${doc.version > 1 ? `-v${doc.version}` : ''}.pdf`,
  email: (doc, d) => ({
    subject: `Vacation decision (Rešenje o korišćenju godišnjeg odmora) ${doc.number}, ${periodLabel(d.startDate, d.endDate)}`,
    intro: `${doc.number}${doc.version > 1 ? ` (version ${doc.version})` : ''}: ${d.employee.fullName}'s vacation ${periodLabel(d.startDate, d.endDate)}, ${d.workingDays} working ${d.workingDays === 1 ? 'day' : 'days'}, decided on ${periodLabel(d.issuedOn, d.issuedOn)}.`,
  }),
};

