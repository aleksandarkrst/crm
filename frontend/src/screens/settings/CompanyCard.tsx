import { useState } from 'react';
import type { ApiCompanyDetails } from '../../lib/api';
import { mbProblem, pibProblem } from '../../lib/serbianIds';
import { useStore } from '../../store/store';
import { Block, Card, Dropdown, Note, Row, RowsModal, SummaryRow, TextField } from './parts';

/** Countries offered in Settings → General (CD-167): Serbia first, it turns vacation decisions on. */
export const COUNTRIES = ['RS', 'BA', 'ME', 'MK', 'HR', 'SI', 'BG', 'RO', 'HU', 'GR', 'AL', 'AT', 'DE', 'CH', 'IT', 'FR', 'ES', 'NL', 'BE', 'PL', 'CZ', 'SK', 'SE', 'DK', 'NO', 'FI', 'IE', 'GB', 'US', 'CA'];
const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    return (code: string) => names.of(code) ?? code;
  } catch {
    return (code: string) => code;
  }
})();
export const COUNTRY_OPTIONS = [{ value: '', label: 'Not set' }, ...COUNTRIES.map((c) => ({ value: c, label: regionName(c) }))];

type Key = keyof ApiCompanyDetails;

/** What is sent for a field: the ids without spaces ("104 052 135"), the rest trimmed. */
const sendable = (key: Key, value: string) => (key === 'pib' || key === 'mb' ? value.replace(/\s/g, '') : value.trim());

/**
 * The tax ID and registration number checks (CD-487, the API's rules), worded as in the CD-524
 * spec: digits only and the exact length first, then the check digit. Empty is allowed here.
 */
function idProblem(kind: 'pib' | 'mb', input: string): string {
  const v = input.replace(/\s/g, '');
  if (!v) return '';
  const [what, n, example] = kind === 'pib' ? ['tax ID', 9, '109876543'] : ['registration number', 8, '21456789'];
  if (!/^\d+$/.test(v)) return `The ${what} has exactly ${n} digits, like ${example}. Use digits only, without a country prefix.`;
  if (v.length !== n) return `The ${what} has exactly ${n} digits, like ${example}. You entered ${v.length}.`;
  return (kind === 'pib' ? pibProblem(v) : mbProblem(v)) ?? '';
}

/**
 * Saving one company detail (CD-167): the value goes to the API on its own; a success says
 * "Changes saved", a refusal says it couldn't save (with the API's reason) and the field goes back
 * to the saved value. Shared by Company details and the legal basis on Time off.
 */
export function useCompanyField() {
  const { s, saveCompany, flash, canEditWorkspace } = useStore();
  const company = s.workspace.company;
  // A refused value is put back: remounting the field shows the saved one again.
  const [round, setRound] = useState(0);
  const value = (key: Key) => (key === 'legalBasis' ? company.legalBasis : (company[key] ?? ''));
  const save = async (key: Key, raw: string) => {
    const next = sendable(key, raw);
    if (next === sendable(key, value(key))) return;
    const refused = await saveCompany({ [key]: next });
    if (refused) {
      flash(refused.fields?.[key] ?? 'Could not save. Try again.', 4000, true);
      setRound((r) => r + 1);
    } else flash('Changes saved');
  };
  return { value, save, round, readOnly: !canEditWorkspace };
}

const FIELD: Partial<Record<Key, { label: string; desc?: string; placeholder?: string }>> = {
  legalName: { label: 'Legal name', desc: 'As registered with the business register', placeholder: 'e.g. Primer d.o.o.' },
  address: { label: 'Address', placeholder: 'e.g. Street 1, 11000 Beograd' },
  place: { label: 'Place of issue', desc: 'Where documents are signed', placeholder: 'e.g. Novi Sad' },
  signatoryName: { label: 'Signatory', placeholder: 'e.g. the director’s full name' },
  signatoryTitle: { label: 'Signatory title', placeholder: 'e.g. Direktor' },
};

/**
 * General → Company details (CD-167; CD-524 spec 2): the country, legal name and address; the tax
 * ID and registration number once a country is picked; and who signs, as a summary row with a
 * modal. Each field saves when it is left. The legal basis for vacation decisions is on Time off.
 */
export function CompanyCard() {
  const { s, setWorkspace } = useStore();
  const f = useCompanyField();
  const [signing, setSigning] = useState(false);
  const country = s.workspace.country ?? '';
  const serbia = country === 'RS';
  const text = (key: Key, width: number | string = 260, validate?: (v: string) => string, inputMode?: 'numeric') => (
    <TextField key={`${key}:${f.round}`} label={FIELD[key]?.label ?? key} testId={`company-${key}`} value={f.value(key)} width={width} placeholder={FIELD[key]?.placeholder} inputMode={inputMode} disabled={f.readOnly} validate={validate} onSave={(v) => void f.save(key, v)} />
  );
  const sig = [f.value('signatoryName'), f.value('signatoryTitle')].filter(Boolean).join(', ') + (f.value('place') ? `, signed in ${f.value('place')}` : '');
  return (
    <>
      <Card testId="company-details">
        <Row label="Country" desc={country ? 'Decides the tax fields and the legal text on documents. Serbia turns on vacation decisions (rešenje).' : 'Pick a country first. The tax fields and the legal text on documents depend on it.'}>
          <Dropdown label="Country" testId="workspace-country" value={country} options={COUNTRY_OPTIONS} disabled={f.readOnly} width={260} onChange={(v) => setWorkspace({ country: v || null })} />
        </Row>
        <Row label="Legal name" desc={FIELD.legalName!.desc}>
          {text('legalName')}
        </Row>
        <Row label="Address">{text('address')}</Row>
      </Card>
      {country ? (
        <Block title="Tax and registration" desc={serbia ? 'As on your APR registration.' : `As registered in ${regionName(country)}.`}>
          <Card>
            <Row label={serbia ? 'Tax ID (PIB)' : 'Tax ID'} desc={serbia ? 'Serbian tax identification number, 9 digits' : 'Tax identification number, 9 digits'}>
              {text('pib', 260, (v) => idProblem('pib', v), 'numeric')}
            </Row>
            <Row label={serbia ? 'Registration number (MB)' : 'Registration number'} desc={serbia ? 'Matični broj, 8 digits' : 'As in the business register, 8 digits'}>
              {text('mb', 260, (v) => idProblem('mb', v), 'numeric')}
            </Row>
          </Card>
        </Block>
      ) : (
        <Note testId="company-no-country">Tax ID, registration number and the legal basis for vacation decisions show here once a country is picked. Nothing is filled in for you before that.</Note>
      )}
      <Card>
        <SummaryRow label="Signing" desc="Used on vacation decisions and travel orders" summary={sig || 'Not set yet'} disabled={f.readOnly} onEdit={() => setSigning(true)} testId="company-signing" />
      </Card>
      {signing && (
        <RowsModal title="Signing" desc="Printed at the bottom of vacation decisions and travel orders." onClose={() => setSigning(false)} testId="signing-modal">
          {(['place', 'signatoryName', 'signatoryTitle'] as const).map((k) => (
            <Row key={k} label={FIELD[k]!.label} desc={FIELD[k]!.desc}>
              {text(k, 240)}
            </Row>
          ))}
        </RowsModal>
      )}
    </>
  );
}
