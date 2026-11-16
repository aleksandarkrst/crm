import { Icon } from '../../components/icons';
import { MODULES, type WorkspaceModule } from '../../components/modules';
import { CURRENCIES } from '../../store/seed';
import { useStore } from '../../store/store';
import type { Workspace } from '../../store/types';
import { MODULE_TILE, moduleName, useModuleSwitch } from '../Settings';
import { CompanyCard } from './CompanyCard';
import { Card, Dropdown, Row, Section, Segmented, Switch } from './parts';
import { TimeZonePicker } from './TimeZonePicker';
import { LogoRow, NameRow } from './WorkspaceInfo';
// import { RolesTab } from './RolesTab';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((label, i) => ({ value: String(i + 1), label }));
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'sr', label: 'Srpski' },
] as const;
/**
 * The modules listed, in the sidebar's order. Planning, Finance and Reporting aren't built yet, so
 * they aren't offered here (their switches come back with them): 'planning', 'finance', 'reporting'.
 */
const LISTED: readonly WorkspaceModule[] = ['crm', 'projects', 'employees', 'timesheet', 'timeoff'];

/**
 * Workspace settings → General (CD-524 spec 2, design G-Settings): Workspace, Company details and
 * Modules. Not built because the app doesn't have it: Danger zone (deleting the workspace).
 * Commented out with the spec: Getting started (sample data) and Roles & permissions.
 */
export function GeneralPage() {
  const { s, setWorkspace } = useStore();
  const w = s.workspace;
  return (
    <>
      <Section title="Workspace" desc="Name, logo, currency, time zone and fiscal year of the workspace.">
        <Card testId="workspace-fields">
          <LogoRow />
          <NameRow />
          <Row label="Currency" desc="Used for opportunity values, budgets and bonuses">
            <Dropdown label="Currency" value={w.currency} options={CURRENCIES} onChange={(v) => setWorkspace({ currency: v })} width={200} testId="workspace-currency" />
          </Row>
          <Row label="Time zone" desc="Deadlines, reminders and the daily digest follow this">
            <TimeZonePicker value={w.timezone} onChange={(timezone) => setWorkspace({ timezone })} />
          </Row>
          <Row label="Fiscal year starts" desc="Budgets and targets follow your fiscal year">
            <Dropdown label="Fiscal year starts" value={String(w.fiscalMonth)} options={MONTHS} onChange={(v) => setWorkspace({ fiscalMonth: Number(v) })} width={200} testId="workspace-fiscal-month" />
          </Row>
          <Row label="Customer emails" desc="Default language of the fixed text, such as meeting minutes">
            <Segmented label="Customer email language" value={w.customerEmailLanguage} options={LANGUAGES} onChange={(v) => setWorkspace({ customerEmailLanguage: v as Workspace['customerEmailLanguage'] })} testId="customer-email-language" />
          </Row>
        </Card>
      </Section>
      <Section title="Company details" desc="Printed on proposals, travel orders and vacation decisions. Empty fields print as blanks.">
        <CompanyCard />
      </Section>
      <ModulesSection />
      {/* Not in the CD-524 spec's General page; kept for when they come back:
      <Section title="Getting started" desc="Sample data and the getting-started checklist."><GettingStartedBlock /></Section>
      <Section title="Roles & permissions" desc="What owners, admins and members can do."><RolesTab /></Section> */}
    </>
  );
}

/**
 * General → Modules (CD-318): one row per module with its tile, description, state and switch.
 * The same setting as the switch on top of each module page (CD-524 spec 1): off asks first.
 */
function ModulesSection() {
  const sw = useModuleSwitch();
  const row = (id: WorkspaceModule) => {
    const def = MODULES.find((m) => m.id === id);
    const on = sw.on(id);
    const built = !!def && def.screens.length > 0;
    return (
      <Row
        key={id}
        data={{ 'data-module': id }}
        switchRow
        icon={
          <span className="gs-tile" aria-hidden="true" style={MODULE_TILE[id] ? { background: MODULE_TILE[id] } : undefined}>
            {def && <Icon name={def.icon} size={17} />}
          </span>
        }
        label={moduleName(id)}
        desc={`${def?.description ?? ''}. ${on ? (built ? 'On.' : 'On, not set up yet.') : 'Off. Its data is kept.'}`}
      >
        <Switch on={on} label={`${moduleName(id)} in this workspace`} onChange={() => sw.flip(id)} />
      </Row>
    );
  };
  return (
    <Section title="Modules" desc="The modules this workspace uses. A module that is off is hidden from everyone; its data is kept." testId="workspace-modules">
      <Card>{LISTED.map(row)}</Card>
      {/* Not built yet, so not listed (CD-524 review):
      <Card>{(['planning', 'finance', 'reporting'] as const).map(row)}</Card> */}
      {/* The spec's note says module access is set per person in HRM; the app has no per-person
          module access (only roles), so the note isn't shown. */}
      {sw.dialog}
    </Section>
  );
}
