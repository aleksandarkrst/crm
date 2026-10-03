import type { Lang } from './copy';

// Sample articles from the design handoff. Replace them with real ones before launch.
// A body paragraph that starts with "## " is a section heading.

export type Category = 'guides' | 'sales' | 'product';
export type Tone = 'forest' | 'green' | 'soft' | 'lime';
export interface PostText { title: string; excerpt: string; body: string[] }
export interface Post {
  id: string;
  cat: Category;
  tone: Tone;
  /** Publication day and month (0 = January); all posts are from 2026. */
  d: number;
  m: number;
  /** Reading time in minutes. */
  min: number;
  en: PostText;
  sr: PostText;
}

export const MONTHS: Record<Lang, string[]> = { en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], sr: ['jan','feb','mar','apr','maj','jun','jul','avg','sep','okt','nov','dec'] };
export const TONES: Record<Tone, { coverBg: string; coverFg: string; bar: string; barAccent: string }> = {
  forest: { coverBg: '#0D241C', coverFg: '#F5F7F6', bar: '#FFFFFF', barAccent: '#C6F16A' },
  green: { coverBg: '#2F7A5E', coverFg: '#FFFFFF', bar: '#CBE3DA', barAccent: '#C6F16A' },
  soft: { coverBg: '#E7F2EE', coverFg: '#14503C', bar: '#5FA587', barAccent: '#0D241C' },
  lime: { coverBg: '#C6F16A', coverFg: '#0D241C', bar: '#2F7A5E', barAccent: '#0D241C' }
};
export const POSTS: Post[] = [
  { id: 'overview-release', cat: 'product', tone: 'lime', d: 30, m: 8, min: 2,
    en: { title: 'New in Pultly: the Overview', excerpt: 'The first screen you see now shows open pipeline, two funnels and the deals that have gone quiet.', body: ['The Overview is the first screen you see when you open Pultly. It shows your open pipeline, two funnels and a list of stalled deals.', '## Two funnels', 'The first funnel shows deals and value by stage. The second shows product and service payments falling due in the next 30, 60 and 90 days, including VAT.', '## Stalled deals', 'Any open deal with no activity for seven days appears in the list, with its stage and owner. Open it and add a next step.', 'The Overview fills itself from the deals you already track. There is nothing to set up.'] },
    sr: { title: 'Novo u Pultlyju: Pregled', excerpt: 'Prvi ekran sada prikazuje otvoreni levak, dva levka i poslove koji su utihnuli.', body: ['Pregled je prvi ekran koji vidite kada otvorite Pultly. Na njemu su otvoreni levak, dva levka i lista zastalih poslova.', '## Dva levka', 'Prvi levak pokazuje poslove i vrednost po fazi. Drugi pokazuje plaćanja za proizvode i usluge koja dospevaju u narednih 30, 60 i 90 dana, sa PDV-om.', '## Zastali poslovi', 'Svaki otvoren posao bez aktivnosti sedam dana pojavljuje se na listi, sa fazom i vlasnikom. Otvorite ga i dodajte sledeći korak.', 'Pregled se puni sam iz poslova koje već vodite. Nema podešavanja.'] } },
  { id: 'agency-funnel', cat: 'guides', tone: 'forest', d: 24, m: 8, min: 5,
    en: { title: 'How to set up a sales funnel for an agency', excerpt: 'Five stages are enough for most agencies. How to name them, and when a deal moves to the next one.', body: ['A funnel is the list of stages every deal goes through, from first contact to signed contract. Agencies often create too many stages, and deals end up sitting in columns nobody looks at.', '## Start with five stages', 'Lead, Discovery, Proposal, Negotiation and Won cover most agency sales. Each stage needs a clear exit condition: a deal moves on only when that condition is met.', '## Exit conditions, not feelings', 'Discovery is done when you know the budget, the deadline and who decides. Proposal is done when the client confirms they have read it. That way the funnel shows what is true, not what you hope.', '## Every deal has a next step', 'In Pultly every deal carries a next step with a date. It appears in Today on the day it is due, so no deal is left without an owner.'] },
    sr: { title: 'Kako da postavite prodajni levak za agenciju', excerpt: 'Pet faza je dovoljno za većinu agencija. Kako da ih imenujete i kada posao prelazi u sledeću.', body: ['Levak je spisak faza kroz koje prolazi svaki posao, od prvog kontakta do potpisanog ugovora. Agencije često naprave previše faza, pa poslovi stoje u kolonama koje niko ne gleda.', '## Počnite sa pet faza', 'Lead, Discovery, Ponuda, Pregovori i Dobijeno pokrivaju većinu agencijskih prodaja. Svaka faza treba da ima jasan uslov izlaska: posao ide dalje tek kada je taj uslov ispunjen.', '## Uslov izlaska, ne osećaj', 'Discovery je završen kada znate budžet, rok i ko odlučuje. Ponuda je završena kada klijent potvrdi da ju je pročitao. Tako levak pokazuje stvarno stanje, a ne nadu.', '## Svaki posao ima sledeći korak', 'U Pultlyju svaki posao nosi sledeći korak sa datumom. Taj korak se pojavljuje u Danas na dan kada dospeva, pa nijedan posao ne ostaje bez vlasnika.'] } },
  { id: 'next-step', cat: 'sales', tone: 'green', d: 17, m: 8, min: 3,
    en: { title: 'Why every deal needs a next step', excerpt: 'A deal without a next step is waiting to be forgotten. What a good next step looks like.', body: ['A deal without a next step is a deal waiting to be forgotten. Deals are lost to silence more often than to price.', '## Specific, with a date', '"Follow up" is not a next step. "Send the proposal on Thursday" is. A next step needs an action, a date and the person who does it.', '## A list for Monday morning', 'The Overview in Pultly lists stalled deals: open deals with no activity for more than a week. Go through it once a week and give each deal its next step.'] },
    sr: { title: 'Zašto svaki posao treba da ima sledeći korak', excerpt: 'Posao bez sledećeg koraka čeka da ga neko zaboravi. Kako izgleda dobar sledeći korak.', body: ['Posao bez sledećeg koraka je posao koji čeka da ga neko zaboravi. Poslovi se češće gube zbog tišine nego zbog cene.', '## Konkretno i sa datumom', '„Javiti se“ nije sledeći korak. „Poslati ponudu u četvrtak“ jeste. Sledeći korak ima radnju, datum i osobu koja ga radi.', '## Lista za ponedeljak ujutru', 'Pregled u Pultlyju izdvaja zastale poslove: otvorene poslove bez aktivnosti duže od nedelju dana. Prođite kroz listu jednom nedeljno i svakom poslu dajte sledeći korak.'] } },
  { id: 'champ-fit-score', cat: 'product', tone: 'soft', d: 10, m: 8, min: 4,
    en: { title: 'What CHAMP is and how Pultly calculates fit score', excerpt: 'Four questions that tell you which deals deserve your time first.', body: ['CHAMP is a qualification method: Challenges, Authority, Money, Prioritisation. Instead of asking whether the client has a budget, you first ask which problem they are solving.', '## Four questions', 'Challenges: what is the problem costing the client now? Authority: who makes the decision? Money: is there a budget, or a way to find one? Prioritisation: how important is this compared to everything else?', '## The fit score', 'Pultly rates each answer and adds them up into the fit score on the deal card. A low score does not mean a bad deal. It means you need more answers before you send a proposal.'] },
    sr: { title: 'Šta je CHAMP i kako Pultly računa fit skor', excerpt: 'Četiri pitanja koja pokazuju kojim poslovima prvo treba posvetiti vreme.', body: ['CHAMP je metoda kvalifikacije: Challenges, Authority, Money, Prioritisation. Umesto da pitate da li klijent ima budžet, prvo pitate koji problem rešava.', '## Četiri pitanja', 'Izazovi: koliko klijenta problem košta sada? Autoritet: ko donosi odluku? Novac: da li postoji budžet ili način da se nađe? Prioritet: koliko je ovo važno u odnosu na sve ostalo?', '## Fit skor', 'Pultly ocenjuje svaki odgovor i sabira ih u fit skor na kartici posla. Nizak skor ne znači loš posao. Znači da vam treba više odgovora pre nego što pošaljete ponudu.'] } },
  { id: 'spreadsheet-to-pult', cat: 'guides', tone: 'forest', d: 2, m: 8, min: 4,
    en: { title: 'From spreadsheet to pult in one afternoon', excerpt: 'Moving your sales from a shared spreadsheet into Pultly, step by step.', body: ['Most businesses start selling from a spreadsheet. It works until three people are editing the same file.', '## Import from CSV', 'Save the spreadsheet as a CSV file and import it into Pultly. Map the columns to deal fields: name, company, value, stage and owner.', '## After the import', 'Go through the funnel once and give every deal a next step. From tomorrow, Today tells you what is due.'] },
    sr: { title: 'Od tabele do pulta za jedno popodne', excerpt: 'Kako da prodaju iz zajedničke tabele prebacite u Pultly, korak po korak.', body: ['Većina firmi počinje prodaju u tabeli. To radi dok tri osobe ne počnu da menjaju isti fajl.', '## Uvoz iz CSV-a', 'Sačuvajte tabelu kao CSV fajl i uvezite je u Pultly. Kolone povežite sa poljima posla: naziv, firma, vrednost, faza i vlasnik.', '## Posle uvoza', 'Prođite jednom kroz levak i svakom poslu dodajte sledeći korak. Od sutra, Danas vam govori šta je na redu.'] } }
];

