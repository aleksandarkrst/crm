import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CompanyContactDialog, type ContactDraft } from '../components/CompanyContactDialog';
import { CustomFieldRows } from '../components/CustomFields';
import { Icon } from '../components/icons';
import { Screen } from '../components/Layout';
import { MeetingsCard } from '../components/MeetingsCard';
import { DealsSection, FocusTasks } from '../components/RecordParts';
import { CheckedInput } from '../components/ui';
import { type ApiHistoryEntry, LOST_REASONS, type LostReason } from '../lib/api';
import { mapsSearchUrl } from '../lib/maps';
import { paths } from '../lib/paths';
import { checkDomain } from '../lib/validate';
import { Confirm, Dropdown, Modal, type Opt, RowMenu } from './settings/parts';
import { CompanyProjects } from './CompanyProjects';
import { useCompanyProjects } from '../store/projects';
import { countsInDecision, READINESS_TAGS } from '../store/companyBoard';
import { historyRows, visibleRows, whenText } from '../store/companyHistory';
import { cleanValue, type CompanyTextField, contactLine, fieldProblem, metaLine, missingToast, NEEDED_FIELDS, opportunitiesLine, readyLine, STATUS_TAG_TONE, statusTagText } from '../store/companyPage';
import { BUYER_ROLES, COMPANY_SOURCES, INDUSTRIES, TEAM_SIZES } from '../store/seed';
import { COMPANY_STATUS_LABELS, COMPANY_STATUS_RANK, companyPeople, companyReadiness, companyRecords, initialsOf, memberLabels, memberName, momentLabel, pipelineBlocked, timelineFor } from '../store/selectors';
import { type CompanyFieldKey, useStore } from '../store/store';
import type { CompanyStatus, LogEntry, Person } from '../store/types';

/** The website of a domain such as "acme.com" (or a full http(s) address); '' when it isn't one. */
function websiteHref(value: string): string {
  const v = value.trim();
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v) ? 'https://' + v : '';
}

/**
 * A company (CD-534, board C-Company): breadcrumb and header with the status tag and "+ Opportunity",
 * the readiness banner of a lead, Company information and Contacts on the left, Metrics, Details and
 * one History list on the right. Fields save as they are typed or picked, with a toast. Its
 * opportunities, projects and meetings stay on the page as before (owner's decision, 26 Nov).
 */
export function Company() {
  const store = useStore();
  const { s, set, flash, session } = store;
  const { id = '' } = useParams();
  const rec = companyRecords(s).find((c) => c.id === id);
  const leadIds = (rec?.leads ?? []).map((l) => l.id).join(',');
  const { ensureLog, companyStatusHistory } = store;
  useEffect(() => {
    if (leadIds) ensureLog(leadIds.split(','));
  }, [leadIds, ensureLog]);
  // Its status changes (CD-358) join the History; read again whenever the status moves.
  const [statusLog, setStatusLog] = useState<LogEntry[]>([]);
  const [dialog, setDialog] = useState<null | { kind: 'status' } | { kind: 'delete' } | { kind: 'contact'; draft?: ContactDraft } | { kind: 'remove'; person: Person }>(null);
  // While the Domain field holds an unsaved, invalid value, Open (to the saved one) is hidden (CD-478).
  const [domainInvalid, setDomainInvalid] = useState(false);
  const current = s.extraCompanies.find((c) => c.id === id);
  const statusKey = `${current?.status}:${current?.statusManual}`;
  // Its projects (the Projects card loads them too): a company with one can't be deleted.
  const { data: projects, error: projectsError } = useCompanyProjects(id);
  useEffect(() => {
    let live = true;
    companyStatusHistory(id).then(
      (rows) => live && setStatusLog(rows),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [id, statusKey, companyStatusHistory]);
  // A lead that becomes an opportunity while this page is open (its seventh check done here, or
  // elsewhere and read back) gets the toast (CD-534), whichever path brought the status in. The
  // status is remembered with its company, so opening another company from here says nothing.
  const liveStatus = current?.status;
  const seenStatus = useRef({ id, status: liveStatus });
  useEffect(() => {
    if (seenStatus.current.id === id && seenStatus.current.status === 'lead' && liveStatus === 'opportunity' && current?.name) flash(`${current.name} is now an opportunity. You can add it to the Pipeline.`, 5000);
    seenStatus.current = { id, status: liveStatus };
  }, [id, liveStatus, current?.name, flash]);
  if (!rec) return <Navigate to={paths.companies} replace />;
  const extra = s.extraCompanies.find((c) => c.id === rec.id);
  const status: CompanyStatus = extra?.status ?? 'lead';
  const manual = !!extra?.statusManual;
  const readiness = companyReadiness(s, rec.id);
  const missingTags = READINESS_TAGS.filter((_, i) => !readiness.done[i]);
  // Owners, admins and the company's owner set it back (the API checks the same).
  const canSetStatus = store.canDelete || extra?.ownerId === session.userId;
  const lower = (Object.keys(COMPANY_STATUS_RANK) as CompanyStatus[]).filter((st) => COMPANY_STATUS_RANK[st] < COMPANY_STATUS_RANK[status]);
  const ownerId = extra ? (extra.ownerId ?? null) : rec.ownerId;
  const ownerName = ownerId ? memberName(s, ownerId, extra?.owner) : null;
  const tz = s.workspace.timezone;

  // Its own contacts and everyone on its opportunities, by name (CD-361).
  const people = companyPeople(s, rec.id, rec.leads).sort((a, b) => a.name.localeCompare(b.name));
  const activities = [...statusLog, ...rec.leads.flatMap((l) => timelineFor(s, l.id))];
  const won = rec.leads.filter((l) => l.outcome === 'won').length;
  const blocked = pipelineBlocked(s, rec.id);
  const newDeal = () => {
    if (blocked) return flash(missingToast(status === 'lead' ? [...missingTags] : readiness.blockers), 7000);
    set({ newLeadOpen: true, newLeadCompanyId: rec.id, newLeadContactId: null });
  };
  const map = mapsSearchUrl(rec.name, extra?.address, extra?.city || rec.hq);
  const domain = extra?.domain ?? '';
  const website = websiteHref(domain);
  const field = (key: CompanyFieldKey) => (v: string) => store.setCompanyField(rec.id, key, v);
  const value = (key: CompanyTextField): string => (key === 'name' ? rec.name : key === 'hq' ? (rec.hq === '—' ? '' : rec.hq) : (extra?.[key] ?? ''));

  // Dropdown options: today's lists, plus a value the company already has (CD-478).
  const withCurrent = (known: readonly string[], cur: string): Opt[] => [...new Set([...known, ...(cur && cur !== '—' ? [cur] : [])])].map((v) => ({ value: v, label: v }));
  const industry = rec.industry === '—' ? '' : rec.industry;
  const source = rec.source === '—' ? '' : extra?.source ?? '';
  const face = (name: string, cls = '') => (
    <span className={'gs-face soft cp-face-sm ' + cls} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
  const ownerOptions: Opt[] = [...memberLabels(s)].map(([v, label]) => ({ value: v, label, icon: face(label) }));
  if (ownerId && !ownerOptions.some((o) => o.value === ownerId)) ownerOptions.push({ value: ownerId, label: ownerName ?? 'Former member', icon: face(ownerName ?? '?') });
  const pickOwner = (v: string) => {
    store.setCompanyOwner(rec.id, v);
    flash(`Company owner changed to ${memberName(s, v)}`);
  };
  const pickSource = (v: string) => {
    store.setCompanyField(rec.id, 'source', v);
    flash(`Source changed to ${v}`);
  };
  // A company with opportunities or projects can't be deleted (the API refuses it too): the item stays, off, with why.
  // While its projects are still loading the item waits too; if they can't be read, the API's own check decides.
  const projectCount = projects?.length ?? 0;
  const has = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
  const deleteBlock =
    rec.leads.length || projectCount
      ? `${rec.name} has ${[rec.leads.length ? has(rec.leads.length, 'an opportunity', 'opportunities') : '', projectCount ? has(projectCount, 'a project', 'projects') : ''].filter(Boolean).join(' and ')}: delete them or move them to another company first`
      : !projects && !projectsError
        ? 'Checking its projects'
        : null;
  const ownContacts = people.filter((p) => p.companyId === rec.id);
  const menu = [
    ...(canSetStatus && lower.length ? [{ label: 'Set status back', onClick: () => setDialog({ kind: 'status' as const }), testId: 'status-set-back' }] : []),
    ...(canSetStatus && manual ? [{ label: 'Back to automatic', onClick: () => void store.setCompanyStatus(rec.id, null), testId: 'status-back-auto' }] : []),
    ...(store.canDelete ? [{ label: 'Delete company', danger: true, disabled: !!deleteBlock, hint: deleteBlock ?? undefined, onClick: () => setDialog({ kind: 'delete' as const }), testId: 'delete-company' }] : []),
  ];
  const rev = JSON.stringify([rec.name, rec.industry, rec.hq, rec.size, extra?.source, ownerId, extra?.domain, extra?.notes, extra?.pib, extra?.mb, extra?.activityCode, extra?.ownershipType, extra?.address, extra?.city, extra?.postalCode, people.map((p) => `${p.contactId ?? p.id}:${p.buyerRole ?? ''}`).join()]);

  return (
    <Screen title="Company" parent={{ label: 'Companies', to: paths.companies }}>
      <div className="cp" data-testid="company-page">
        <nav aria-label="Breadcrumb" className="cp-crumb">
          <Link to={paths.companies}>Companies</Link>
          <span aria-hidden="true">/</span>
          <span className="cp-crumb-here">{rec.name}</span>
        </nav>
        <header className="cp-head">
          <span className="cp-tile" aria-hidden="true">
            {initialsOf(rec.name)}
          </span>
          <div className="cp-title">
            <h1 className="cp-name" data-testid="record-name">
              {rec.name}
            </h1>
            <span className="cp-meta">
              <span className={'gs-badge ' + STATUS_TAG_TONE[status]} data-testid="company-status">
                {statusTagText(status, manual)}
              </span>
              <span className="cp-sub" data-testid="company-meta">
                {metaLine(status, readiness, ownerName)}
              </span>
            </span>
          </div>
          <span className="cp-actions">
            <span className="cp-new-opp">
              <button type="button" className={'gs-btn primary' + (blocked ? ' off' : '')} aria-disabled={blocked} data-testid="record-new-deal" onClick={newDeal}>
                <Icon name="plus" size={13} />
                Opportunity
              </button>
              {blocked && <span className="cp-sub cp-complete-first">Complete the company first</span>}
            </span>
            <RowMenu label="More actions" items={menu} buttonClass="cp-iconb" testId="company-menu" />
          </span>
        </header>

        {status === 'lead' && (
          <div className="cp-banner" role="status" data-testid="company-blockers">
            <Icon name="warn" size={18} />
            <span className="cp-banner-text">
              <b>{readyLine(readiness, [...missingTags])}</b>
              <span className="cp-checks">
                {READINESS_TAGS.map((tag, i) => (
                  <span key={tag} className={'cp-check' + (readiness.done[i] ? ' done' : '')} data-testid="readiness-check" data-done={readiness.done[i]}>
                    {readiness.done[i] && <Icon name="check" size={11} />}
                    {tag}
                  </span>
                ))}
              </span>
            </span>
          </div>
        )}

        <div className="cp-cols">
          <section className="cp-main">
            <div className="gs-glass cp-card" data-testid="company-identity">
              <div className="cp-card-head">
                <h2>Company information</h2>
                <span className="cp-sub">Changes save as you type</span>
              </div>
              <TextRow label="Name" field="name" value={value('name')} placeholder="Company name" onSave={field('name')} />
              <TextRow label="PIB" field="pib" value={value('pib')} placeholder="9 digits" numeric lead={status === 'lead'} onSave={field('pib')} />
              <TextRow label="MB" field="mb" value={value('mb')} placeholder="8 digits" numeric lead={status === 'lead'} onSave={field('mb')} />
              <TextRow label="Street" field="address" value={value('address')} placeholder="Street and number" lead={status === 'lead'} onSave={field('address')} link={map ? { href: map, label: 'Open in Maps' } : undefined} />
              <TextRow label="City" field="city" value={value('city')} placeholder="City" lead={status === 'lead'} onSave={field('city')} />
              <TextRow label="Postal code" field="postalCode" value={value('postalCode')} placeholder="5 digits" numeric lead={status === 'lead'} onSave={field('postalCode')} />
              <TextRow label="Activity code" field="activityCode" value={value('activityCode')} placeholder="4 digits, for example 2223" numeric lead={status === 'lead'} onSave={field('activityCode')} />
              <Row label="Industry">
                <Dropdown label="Industry" value={industry} placeholder="Not set" options={[{ value: '', label: 'Not set' }, ...withCurrent(INDUSTRIES, industry)]} onChange={field('industry')} width="100%" testId="company-industry" />
              </Row>
              <Row label="Ownership">
                <Dropdown
                  label="Ownership"
                  value={extra?.ownershipType ?? ''}
                  placeholder="Not set"
                  options={[
                    { value: '', label: 'Not set' },
                    { value: 'private', label: 'Private' },
                    { value: 'state', label: 'Public' },
                  ]}
                  onChange={field('ownershipType')}
                  width="100%"
                  testId="company-ownership"
                />
              </Row>
              {/* Kept from before (owner's decision, 26 Nov): HQ, team size, domain, notes and the custom fields. */}
              <TextRow label="HQ" field="hq" value={value('hq')} placeholder="City or region" onSave={field('hq')} />
              <Row label="Team size">
                <Dropdown label="Team size" value={rec.size === '—' ? '' : rec.size} placeholder="Not set" options={[{ value: '', label: 'Not set' }, ...withCurrent(TEAM_SIZES, rec.size)]} onChange={field('size')} width="100%" testId="company-team-size" />
              </Row>
              <Row label="Domain" link={!domainInvalid && website ? { href: website, label: `Open ${domain.trim()}`, text: 'Open' } : undefined}>
                <CheckedInput className="gs-input s" aria-label="Domain" placeholder="acme.com" value={domain} check={checkDomain} onSave={(v) => store.setCompanyField(rec.id, 'domain', v)} onUnsaved={setDomainInvalid} />
              </Row>
              <Row label="Notes" top>
                <textarea className="gs-input cp-notes" aria-label="Notes" rows={2} value={extra?.notes ?? ''} onChange={(e) => store.setCompanyField(rec.id, 'notes', e.target.value)} placeholder="What to know about this company" />
              </Row>
              <div className="cp-custom">
                <CustomFieldRows entity="company" recordId={rec.id} />
              </div>
            </div>

            <div className="gs-glass cp-card" data-testid="company-contacts">
              <div className="cp-card-head">
                <h2>Contacts</h2>
                <button type="button" className="gs-btn" data-testid="company-add-contact" onClick={() => setDialog({ kind: 'contact' })}>
                  <Icon name="plus" size={13} />
                  Contact
                </button>
              </div>
              {people.length === 0 && <div className="cp-empty">No contacts yet. Add the first one with + Contact.</div>}
              {people.map((p) => {
                const roles = withCurrent(BUYER_ROLES, p.buyerRole ?? '');
                const hasRole = !!p.buyerRole;
                return (
                  <div key={p.id} className="cp-row cp-contact" data-testid="company-contact">
                    <span className="gs-face soft cp-face-lg" aria-hidden="true">
                      {p.initials || initialsOf(p.name)}
                    </span>
                    <span className="cp-contact-text">
                      <button type="button" className="cp-contact-name" onClick={() => store.openContact(p.contactId || p.id)}>
                        {p.name}
                      </button>
                      <span className="cp-sub">{contactLine(p.role, p.email)}</span>
                    </span>
                    <span className={'cp-role' + (hasRole ? '' : ' missing')}>
                      <Dropdown label="Role in the decision" value={p.buyerRole ?? ''} placeholder="Role in the decision" options={[{ value: '', label: 'No role' }, ...roles]} onChange={(v) => store.patchPerson(p.id, { buyerRole: v })} width={190} testId="contact-role" />
                    </span>
                    {!countsInDecision(p.buyerRole) && !hasRole && (
                      <span className="gs-badge amber" data-testid="no-role-badge">
                        Missing role
                      </span>
                    )}
                    <RowMenu
                      label={`Actions for ${p.name}`}
                      testId="contact-menu"
                      items={[
                        { label: 'Edit contact', onClick: () => setDialog({ kind: 'contact', draft: { id: p.id, name: p.name, role: p.role === '—' ? '' : p.role, email: p.email === '—' ? '' : p.email, phone: p.phone === '—' ? '' : p.phone, buyerRole: p.buyerRole ?? '' } }), testId: 'contact-edit' },
                        { label: `Remove from ${rec.name}`, danger: true, onClick: () => setDialog({ kind: 'remove', person: p }), testId: 'contact-remove' },
                      ]}
                    />
                  </div>
                );
              })}
            </div>

            <DealsSection leads={rec.leads} onAdd={newDeal} />
            <CompanyProjects companyId={rec.id} />
            <MeetingsCard record={{ companyId: rec.id }} seed={{ companyId: rec.id }} />
          </section>

          <aside className="cp-side">
            <div className="gs-glass cp-card cp-metrics" data-testid="company-metrics">
              <Metric label="Open value" value={rec.value ? rec.valueLabel : '—'} testId="company-open-value" />
              <Metric label="Lifetime value" value={rec.lifetimeValue ? rec.lifetimeLabel : '—'} testId="company-lifetime-value" />
              <Metric label="Won opportunities" value={String(won)} />
              <Metric label="Last activity" value={extra?.lastActivity ? momentLabel(extra.lastActivity.at, tz) : 'None yet'} />
            </div>

            <div className="gs-glass cp-card" data-testid="company-details">
              <div className="cp-row cp-kv">
                <span className="cp-sub cp-kv-label">Company owner</span>
                <Dropdown label="Company owner" value={ownerId ?? ''} placeholder="No owner" options={ownerOptions} onChange={pickOwner} width={176} testId="company-owner" />
              </div>
              <div className="cp-row cp-kv">
                <span className="cp-sub cp-kv-label">Source</span>
                <Dropdown label="Source" value={source} placeholder="Not set" options={withCurrent(COMPANY_SOURCES, source)} onChange={pickSource} width={176} testId="company-source" />
              </div>
              <div className="cp-row cp-kv">
                <span className="cp-sub cp-kv-label">Opportunities</span>
                {rec.leads.length > 0 ? (
                  <Link to={paths.pipeline} className="cp-link" data-testid="company-opportunities">
                    {opportunitiesLine(status, rec.leads.length)}
                  </Link>
                ) : (
                  <span className="cp-sub cp-kv-value" data-testid="company-opportunities">
                    {opportunitiesLine(status, rec.leads.length)}
                  </span>
                )}
              </div>
            </div>

            <FocusTasks leadIds={rec.leads.map((l) => l.id)} />

            <div className="gs-glass cp-card" data-testid="company-history">
              <div className="cp-card-head">
                <h2>History</h2>
              </div>
              {/* Keyed by company: opening another company from here starts its history afresh. */}
              <CompanyHistory key={rec.id} id={rec.id} activity={activities} rev={rev} tz={tz} />
            </div>
          </aside>
        </div>
      </div>

      {dialog?.kind === 'contact' && (
        <CompanyContactDialog
          companyName={rec.name}
          initial={dialog.draft}
          onClose={() => setDialog(null)}
          onSave={async (d) => {
            if (d.id) return store.saveContactDetails(d.id, d);
            return !!(await store.createContact({ name: d.name, role: d.role, email: d.email, phone: d.phone, linkedin: '', buyerRole: d.buyerRole, notes: '' }, undefined, undefined, rec.id));
          }}
        />
      )}
      {dialog?.kind === 'remove' && (
        <Confirm
          title={`Remove ${dialog.person.name} from ${rec.name}?`}
          text={`The contact stays in Contacts with their history. They are no longer linked to ${rec.name} or its opportunities.`}
          confirmLabel="Remove contact"
          icon="lock"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const person = dialog.person;
            setDialog(null);
            void store.removeContactFromCompany(person.id, rec.id);
          }}
          testId="remove-contact-confirm"
        />
      )}
      {dialog?.kind === 'delete' && (
        <Confirm
          title={`Delete ${rec.name}?`}
          text={`This also deletes its ${ownContacts.length === 1 ? '1 contact' : ownContacts.length + ' contacts'} and their history. It has no opportunities or projects. This cannot be undone.`}
          confirmLabel="Delete company"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void store.deleteCompany(rec.id);
          }}
          testId="delete-company-confirm"
        />
      )}
      {dialog?.kind === 'status' && (
        <SetStatusDialog
          name={rec.name}
          current={status}
          choices={lower}
          openDeals={rec.leads.filter((l) => l.outcome === 'open').map((l) => l.id)}
          onClose={() => setDialog(null)}
          onPick={(st, close) => void store.setCompanyStatus(rec.id, st, close)}
        />
      )}
    </Screen>
  );
}

/** A row of a glass card: the label on the left (170 px), the control on the right, an optional link after it. */
function Row({ label, hint, link, top, error, children }: { label: string; hint?: string; link?: { href: string; label: string; text?: string }; top?: boolean; error?: string | null; children: React.ReactNode }) {
  return (
    <div className={'cp-row' + (top ? ' top' : '')}>
      {/* The label is a text node of its span: the e2e harness finds a field by the span that reads its label. */}
      <span className="cp-label">
        {label}
        {hint && <span className="cp-hint">{hint}</span>}
      </span>
      <span className="cp-control">
        {children}
        {error && (
          <span className="gs-error" role="alert" data-testid="field-problem">
            {error}
          </span>
        )}
      </span>
      {link && (
        <a className="cp-link" href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label}>
          {link.text ?? link.label}
        </a>
      )}
    </div>
  );
}

/**
 * A text field that saves as it is typed (the store debounces), unless the value is wrong: then the
 * field turns red with the message under it and nothing is sent. On a lead, a field it needs shows
 * "Needed for Opportunity" with an amber outline while it is empty (`lead`).
 */
function TextRow({ label, field, value, placeholder, numeric, lead, link, onSave }: { label: string; field: CompanyTextField; value: string; placeholder?: string; numeric?: boolean; lead?: boolean; link?: { href: string; label: string }; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const problem = fieldProblem(field, draft);
  const needed = !!lead && NEEDED_FIELDS.includes(field) && !draft.trim();
  return (
    <Row label={label} hint={needed ? 'Needed for Opportunity' : undefined} link={link} error={problem}>
      <input
        className={'gs-input s' + (needed ? ' cp-needed' : '')}
        aria-label={label}
        data-testid={`company-field-${field}`}
        inputMode={numeric ? 'numeric' : undefined}
        placeholder={placeholder}
        value={draft}
        aria-invalid={!!problem}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          if (problem) setDraft(value);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!fieldProblem(field, e.target.value)) onSave(cleanValue(field, e.target.value));
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </Row>
  );
}

function Metric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="cp-metric">
      <span className="cp-sub">{label}</span>
      <b data-testid={testId}>{value}</b>
    </div>
  );
}

/**
 * The History card (CD-534): the company's field changes (CD-69), its contacts coming and going,
 * its status changes and the activity on its opportunities, one list newest first; four rows, then
 * "Show N more". It re-reads shortly after this tab's own edits and after a live update.
 */
function CompanyHistory({ id, activity, rev, tz }: { id: string; activity: LogEntry[]; rev: string; tz?: string }) {
  const { s, loadChanges } = useStore();
  const [entries, setEntries] = useState<ApiHistoryEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const shown = useRef(30);
  const touched = s.changedAt[id] ?? 0;
  // A read that is still running when the next starts (or the card goes) is dropped, so an older
  // answer never overwrites a newer one.
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current = -1;
    },
    [],
  );
  const load = useCallback(
    (count: number) => {
      const run = ++latest.current;
      return loadChanges('company', id, 0)
        .then(async (first) => {
          let all = first.entries;
          let hasMore = first.more;
          while (hasMore && all.length < count) {
            const next = await loadChanges('company', id, all.length);
            all = [...all, ...next.entries];
            hasMore = next.more;
          }
          if (latest.current !== run) return;
          setEntries(all);
          setMore(hasMore);
          setFailed(false);
        })
        .catch(() => latest.current === run && setFailed(true));
    },
    [id, loadChanges],
  );
  // On open at once; after an edit or a live update once the store has sent it (typed fields and the
  // source go out after a 600 ms pause; the owner at once).
  useEffect(() => {
    const t = setTimeout(() => void load(shown.current), entries === null ? 0 : 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entries` only picks the delay
  }, [load, touched, rev]);
  const rows = historyRows(entries ?? [], activity);
  const { shown: visible, hidden } = visibleRows(rows, expanded, 4, more ? 30 : 0);
  return (
    <div data-testid="change-history">
      {visible.map((r) => (
        <div key={r.key} className="cp-row cp-hist" data-testid="history-row">
          <span className="gs-face soft cp-face-sm" aria-hidden="true">
            {r.actor ? initialsOf(r.actor) : 'P'}
          </span>
          <span className="cp-hist-text">
            <span>{r.text}</span>
            <span className="cp-sub">{whenText(r.at, tz)}</span>
          </span>
        </div>
      ))}
      {rows.length === 0 && (entries || failed) && <div className="cp-empty">{failed ? "Couldn't load the history. It loads when the connection is back." : 'Nothing here yet.'}</div>}
      {hidden > 0 && (
        <div className="cp-row cp-more">
          <button
            type="button"
            className="cp-link"
            data-testid="history-more"
            onClick={() => {
              setExpanded(true);
              if (more) {
                shown.current = (entries?.length ?? 0) + 30;
                void load(shown.current);
              }
            }}
          >
            Show {hidden} more
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * "Set status back" (CD-358) in the glass sheet: only to a status behind the current one. A lead's
 * only way back is Not interested, asked as the board words it; a further-on status offers the
 * statuses below it. It stays until the company's opportunities, projects or details change (CD-478);
 * Not interested with open opportunities asks whether to close them as lost too.
 */
function SetStatusDialog({ name, current, choices, openDeals, onClose, onPick }: { name: string; current: CompanyStatus; choices: CompanyStatus[]; openDeals: string[]; onClose: () => void; onPick: (status: CompanyStatus, close?: { leadIds: string[]; reason: LostReason }) => void }) {
  const [pick, setPick] = useState<CompanyStatus>(choices[choices.length - 1]!);
  const [closeDeals, setCloseDeals] = useState<boolean | null>(null);
  const [reason, setReason] = useState<LostReason | ''>('');
  const [error, setError] = useState('');
  const onlyNotInterested = choices.length === 1 && choices[0] === 'not_interested';
  const asks = pick === 'not_interested' && openDeals.length > 0;
  const one = openDeals.length === 1;
  const n = one ? '1 open opportunity' : `${openDeals.length} open opportunities`;
  const save = () => {
    if (asks && closeDeals === null) return setError(`Choose what happens to its ${n}.`);
    if (asks && closeDeals && !reason) return setError('Pick the reason they were lost.');
    onPick(pick, asks && closeDeals && reason ? { leadIds: openDeals, reason } : undefined);
    onClose();
  };
  return (
    <Modal
      title={onlyNotInterested ? `Mark ${name} as not interested?` : `Set ${name} back`}
      desc={onlyNotInterested ? 'It leaves the lead list. Pultly will not raise it again by itself until you choose Back to automatic.' : `It is ${COMPANY_STATUS_LABELS[current]} now. The status moves forward by itself; by hand it can only go back. It follows the company again as soon as its opportunities, projects or details change.`}
      onClose={onClose}
      testId="set-status-dialog"
    >
      {!onlyNotInterested && (
        <div className="gs-move" role="radiogroup" aria-label="Status">
          {[...choices].reverse().map((st) => (
            <button key={st} type="button" role="radio" aria-checked={pick === st} className={pick === st ? 'on' : ''} onClick={() => setPick(st)}>
              {COMPANY_STATUS_LABELS[st]}
            </button>
          ))}
        </div>
      )}
      {asks && (
        <div className="cp-ask" data-testid="status-close-deals" role="radiogroup" aria-label="Open opportunities">
          <b>
            It has {n}. Close {one ? 'it' : 'them'} as lost too?
          </b>
          <label className="cp-radio">
            <input type="radio" name="close-deals" checked={closeDeals === true} onChange={() => setCloseDeals(true)} />
            Yes, close {one ? 'it' : 'them'} as lost
          </label>
          {closeDeals && (
            <Dropdown label="Reason" value={reason} placeholder="Pick a reason" options={LOST_REASONS.map((r) => ({ value: r, label: r }))} onChange={(r) => setReason(r as LostReason)} width={240} testId="status-lost-reason" />
          )}
          <label className="cp-radio">
            <input type="radio" name="close-deals" checked={closeDeals === false} onChange={() => setCloseDeals(false)} />
            No, keep {one ? 'it' : 'them'} open
          </label>
          <span className="cp-sub">An open opportunity still counts in the Pipeline.</span>
        </div>
      )}
      {error && (
        <span className="gs-error" role="alert">
          {error}
        </span>
      )}
      <div className="gs-sheet-actions">
        <button type="button" className="gs-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="gs-btn primary" data-testid="status-set-back-save" onClick={save}>
          {onlyNotInterested ? 'Mark not interested' : 'Set back'}
        </button>
      </div>
    </Modal>
  );
}
