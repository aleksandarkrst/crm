import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CompanyContactDialog, type ContactDraft } from '../components/CompanyContactDialog';
import { CustomFieldRows } from '../components/CustomFields';
import { Icon } from '../components/icons';
import { Screen } from '../components/Layout';
import { CheckedInput } from '../components/ui';
import { type ApiHistoryEntry, LOST_REASONS, type LostReason, type MeetingQuery } from '../lib/api';
import { mapsSearchUrl } from '../lib/maps';
import { paths } from '../lib/paths';
import type { ApiProject } from '../lib/projectsApi';
import { checkDomain } from '../lib/validate';
import { Confirm, Dropdown, Modal, type Opt, RowMenu } from './settings/parts';
import { countsInDecision, READINESS_TAGS } from '../store/companyBoard';
import { historyRows, whenText } from '../store/companyHistory';
import { cleanValue, type CompanyTextField, contactLine, fieldProblem, metaLine, missingToast, NEEDED_FIELDS, readyLine, STATUS_TAG_TONE, statusTagText } from '../store/companyPage';
import { COMPANY_TABS, type CompanyTab, companyTasks, lastActivityKpi, lifetimeLine, longDate, nextMeetingKpi, openValueLine, opportunitiesEmpty, opportunityGroups, taskSummary, winRateLine } from '../store/companyTabs';
import { MEETING_TYPES } from '../store/meetings';
import { useCompanyProjects } from '../store/projects';
import { BUYER_ROLES, COMPANY_SOURCES, INDUSTRIES, TEAM_SIZES } from '../store/seed';
import { COMPANY_STATUS_LABELS, COMPANY_STATUS_RANK, companyPeople, companyReadiness, companyRecords, initialsOf, isoInZone, isoLabel, memberLabels, memberName, moneyTotal, pipelineBlocked, stageOf, timelineFor, todayIso, valueNum } from '../store/selectors';
import { type CompanyFieldKey, useStore } from '../store/store';
import { instantToZoned } from '../store/time';
import { dueTag } from '../store/today';
import type { CompanyStatus, LogEntry, Person } from '../store/types';
import { useMeetingList } from '../store/useMeetings';

/** The website of a domain such as "acme.com" (or a full http(s) address); '' when it isn't one. */
function websiteHref(value: string): string {
  const v = value.trim();
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v) ? 'https://' + v : '';
}

/** Every meeting with the company: a range before and after any a workspace can have (a fixed key, so the list isn't re-read on every render). */
const MEETINGS_FROM = '2000-01-01T00:00:00.000Z';
const MEETINGS_TO = '2100-01-01T00:00:00.000Z';
const MEETINGS_LIMIT = 50;
const PROJECT_TAG: Record<ApiProject['status'], { label: string; tone: string }> = { open: { label: 'In progress', tone: 'blue' }, completed: { label: 'Complete', tone: '' }, cancelled: { label: 'Cancelled', tone: 'red' } };

/**
 * A company (CD-534, boards C-Company and C-Company-Client, 28 Nov): breadcrumb and header with the
 * status tag and "New opportunity", the readiness banner of a lead, five KPIs, then tabs: Details
 * (Company information, Sales, Address), Contacts, Opportunities (open, won and lost), Meetings,
 * Tasks, Projects and History. Fields save as they are typed or picked, with a toast.
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
  const [tab, setTab] = useState<CompanyTab>('details');
  useEffect(() => setTab('details'), [id]);
  // While the Domain field holds an unsaved, invalid value, Open (to the saved one) is hidden (CD-478).
  const [domainInvalid, setDomainInvalid] = useState(false);
  const current = s.extraCompanies.find((c) => c.id === id);
  const statusKey = `${current?.status}:${current?.statusManual}`;
  // Its projects: the Projects tab, its count, and a company with one can't be deleted.
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
  // Every meeting with the company, newest first (planned and held), for the Meetings tab and the Next meeting KPI.
  // Keyed by the query's values (useMeetingList), so it follows the company id when the route moves to another company.
  const meetingsQuery: MeetingQuery = { companyId: id, from: MEETINGS_FROM, to: MEETINGS_TO, status: ['planned', 'held'], sort: 'desc', limit: MEETINGS_LIMIT };
  const { meetings, more: moreMeetings, loadMore: loadMoreMeetings } = useMeetingList(meetingsQuery);
  const tz = s.workspace.timezone;
  const today = todayIso(tz);
  // The history is read again after the page's own edits: a field, the owner or the source, or a contact's role in the decision.
  const roleRev = companyPeople(s, id, rec?.leads ?? [])
    .map((p) => `${p.contactId ?? p.id}:${p.buyerRole ?? ''}`)
    .join();
  const rev = JSON.stringify([rec?.name, rec?.industry, rec?.hq, rec?.size, current?.source, current?.ownerId, current?.domain, current?.notes, current?.pib, current?.mb, current?.activityCode, current?.ownershipType, current?.address, current?.city, current?.postalCode, roleRev]);
  const changes = useCompanyChanges(id, rev);
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

  // Its own contacts and everyone on its opportunities, by name (CD-361).
  const people = companyPeople(s, rec.id, rec.leads).sort((a, b) => a.name.localeCompare(b.name));
  const activities = [...statusLog, ...rec.leads.flatMap((l) => timelineFor(s, l.id))];
  const historyList = historyRows(changes.entries ?? [], activities);
  const won = rec.leads.filter((l) => l.outcome === 'won').length;
  const lost = rec.leads.filter((l) => l.outcome === 'lost').length;
  const open = rec.leads.filter((l) => l.outcome === 'open').length;
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
  const lead = status === 'lead';

  // Dropdown options: today's lists, plus a value the company already has (CD-478).
  const withCurrent = (known: readonly string[], cur: string): Opt[] => [...new Set([...known, ...(cur && cur !== '—' ? [cur] : [])])].map((v) => ({ value: v, label: v }));
  const industry = rec.industry === '—' ? '' : rec.industry;
  const source = rec.source === '—' ? '' : (extra?.source ?? '');
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

  // The KPI row.
  const tasks = companyTasks(s.leadTasks, rec.leads.map((l) => l.id));
  const taskStats = taskSummary(tasks, today);
  const dayOf = (at: string) => isoInZone(new Date(at), tz);
  const nextMeeting = nextMeetingKpi(meetings.filter((m) => m.status === 'planned'), Date.now(), dayOf, today);
  const lastActivity = lastActivityKpi(extra?.lastActivity, activities, dayOf, today);
  const kpis: { label: string; value: string; sub: string; red?: boolean; testId: string }[] = [
    { label: 'Open value', value: rec.value ? rec.valueLabel : '—', sub: openValueLine(open), testId: 'kpi-open-value' },
    { label: 'Lifetime value', value: rec.lifetimeValue ? rec.lifetimeLabel : '—', sub: lifetimeLine(won, lost), testId: 'kpi-lifetime-value' },
    { label: 'Open tasks', value: String(taskStats.open), sub: taskStats.kpiSub, red: taskStats.late > 0, testId: 'kpi-open-tasks' },
    { label: 'Next meeting', value: nextMeeting.value, sub: nextMeeting.sub, testId: 'kpi-next-meeting' },
    { label: 'Last activity', value: lastActivity.value, sub: lastActivity.sub, testId: 'kpi-last-activity' },
  ];
  // Meetings and History are read a page at a time: their counts say "50+" until the rest is loaded.
  const counts: Partial<Record<CompanyTab, string>> = { contacts: String(people.length), opportunities: String(rec.leads.length), meetings: meetings.length + (moreMeetings ? '+' : ''), tasks: String(taskStats.open), projects: String(projectCount), history: historyList.length + (changes.more ? '+' : '') };

  // The Opportunities tab.
  const groups = opportunityGroups(rec.leads, { stageName: (l) => stageOf(s, l).name, ownerName: (l) => memberName(s, l.ownerId, l.owner), valueNum: (l) => valueNum(l.value), tz, dayLabel: (iso) => isoLabel(iso).replace(/^0/, '') });
  const groupTotal = (g: { rows: { valueNum: number }[]; key: string }) => moneyTotal(s, rec.leads.filter((l) => l.outcome === g.key).map((l) => ({ currency: l.currency, amount: valueNum(l.value) })));
  const oppEmpty = opportunitiesEmpty(status, rec.name, missingTags.length);

  // The Tasks tab: a to-do goes on the company's open opportunity (its current stage), as Focus did.
  const taskLead = rec.leads.find((l) => l.outcome === 'open') ?? rec.leads.find((l) => l.outcome !== 'lost');
  const created = extra?.createdAt ? longDate(extra.createdAt, tz) : '';
  const creator = changes.entries?.find((e) => e.action === 'created')?.actor?.name;

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
                {metaLine(status, readiness, ownerName, extra?.statusChangedAt ? longDate(extra.statusChangedAt, tz) : undefined)}
              </span>
            </span>
          </div>
          <span className="cp-actions">
            <span className="cp-new-opp">
              <button type="button" className={'gs-btn primary' + (blocked ? ' off' : '')} aria-disabled={blocked} data-testid="record-new-deal" onClick={newDeal}>
                New opportunity
              </button>
              {blocked && <span className="cp-sub cp-complete-first">Complete the company first</span>}
            </span>
            <RowMenu label="More actions" items={menu} buttonClass="cp-iconb" testId="company-menu" />
          </span>
        </header>

        {lead && (
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

        <div className="cp-kpis" data-testid="company-kpis">
          {kpis.map((k) => (
            <div key={k.label} className="gs-glass cp-kpi" data-testid={k.testId}>
              <span className="cp-kpi-label">{k.label}</span>
              <b className="cp-kpi-value">{k.value}</b>
              <span className={'cp-sub cp-kpi-sub' + (k.red ? ' red' : '')}>{k.sub}</span>
            </div>
          ))}
        </div>

        <div className="gs-seg cp-tabs" role="tablist" aria-label="Company">
          {COMPANY_TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} data-testid={`tab-${t.key}`} onClick={() => setTab(t.key)}>
              {t.label}
              {counts[t.key] !== undefined && <span className="cp-tab-n">{counts[t.key]}</span>}
            </button>
          ))}
        </div>

        {tab === 'details' && (
          <div className="cp-dgrid" role="tabpanel" data-testid="panel-details">
            <div className="gs-glass cp-card" data-testid="company-identity">
              <div className="cp-card-head">
                <h2>Company information</h2>
                <span className="cp-sub">Changes save as you type</span>
              </div>
              <TextRow label="Name" field="name" value={value('name')} placeholder="Company name" onSave={field('name')} />
              <TextRow label="PIB" field="pib" value={value('pib')} placeholder="9 digits" numeric lead={lead} onSave={field('pib')} />
              <TextRow label="MB" field="mb" value={value('mb')} placeholder="8 digits" numeric lead={lead} onSave={field('mb')} />
              <TextRow label="Activity code" field="activityCode" value={value('activityCode')} placeholder="4 digits, for example 2223" numeric lead={lead} onSave={field('activityCode')} />
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
            <div className="cp-dcol">
              <div className="gs-glass cp-card" data-testid="company-sales">
                <div className="cp-card-head">
                  <h2>Sales</h2>
                </div>
                <Row label="Owner" narrow>
                  <Dropdown label="Company owner" value={ownerId ?? ''} placeholder="No owner" options={ownerOptions} onChange={pickOwner} width="100%" testId="company-owner" />
                </Row>
                <Row label="Source" narrow>
                  <Dropdown label="Source" value={source} placeholder="Not set" options={withCurrent(COMPANY_SOURCES, source)} onChange={pickSource} width="100%" testId="company-source" />
                </Row>
                <Row label="Status" narrow>
                  <span className={'gs-badge ' + STATUS_TAG_TONE[status]}>{statusTagText(status, manual)}</span>
                </Row>
                <Row label="Created" narrow>
                  <span className="cp-text" data-testid="company-created">{created ? `${created}${creator ? `, by ${creator}` : ''}` : '—'}</span>
                </Row>
              </div>
              <div className="gs-glass cp-card" data-testid="company-address">
                <div className="cp-card-head">
                  <h2>Address</h2>
                  {map && (
                    <a className="cp-link" href={map} target="_blank" rel="noopener noreferrer" aria-label="Open in Maps">
                      Open in Maps
                    </a>
                  )}
                </div>
                <TextRow label="Street" field="address" value={value('address')} placeholder="Street and number" lead={lead} narrow onSave={field('address')} />
                <TextRow label="City" field="city" value={value('city')} placeholder="City" lead={lead} narrow onSave={field('city')} />
                <TextRow label="Postal code" field="postalCode" value={value('postalCode')} placeholder="5 digits" numeric lead={lead} narrow onSave={field('postalCode')} />
              </div>
            </div>
          </div>
        )}

        {tab === 'contacts' && (
          <div className="gs-glass cp-card" role="tabpanel" data-testid="company-contacts">
            <div className="cp-card-head">
              <h2>Contacts</h2>
              <button type="button" className="cp-iconb" aria-label="New contact" title="New contact" data-testid="company-add-contact" onClick={() => setDialog({ kind: 'contact' })}>
                <Icon name="plus" size={15} />
              </button>
            </div>
            {people.length === 0 && <div className="cp-empty">No contacts yet. Add the first one with the plus button.</div>}
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
        )}

        {tab === 'opportunities' && (
          <div className="gs-glass cp-card" role="tabpanel" data-testid="company-opportunities">
            <div className="cp-card-head">
              <h2>Opportunities</h2>
              {winRateLine(won, lost) && <span className="cp-sub">{winRateLine(won, lost)}</span>}
              <button type="button" className={'cp-iconb' + (blocked ? ' off' : '')} aria-disabled={blocked} aria-label="New opportunity" title="New opportunity" data-testid="company-add-opportunity" onClick={newDeal}>
                <Icon name="plus" size={15} />
              </button>
            </div>
            {rec.leads.length === 0 && (
              <div className="cp-empty-big" data-testid="opportunities-empty">
                <b>{oppEmpty.title}</b>
                <span className="cp-sub">{oppEmpty.text}</span>
              </div>
            )}
            {groups.map((g) => (
              <div key={g.key} data-testid={`opportunities-${g.key}`}>
                <div className={'cp-ogh ' + g.key}>
                  <span className="cp-ogd" aria-hidden="true" />
                  <b>{g.title}</b>
                  <span className="cp-sub">{g.rows.length}</span>
                  <span className="cp-grow" />
                  <b className="cp-ogh-sum">{groupTotal(g)}</b>
                </div>
                {g.rows.map((r) => (
                  <Link key={r.id} to={paths.lead(r.id)} className="cp-row cp-mrow" data-testid="company-opportunity">
                    <span className="cp-contact-text">
                      <b>{r.name}</b>
                      <span className="cp-sub">{r.line}</span>
                    </span>
                    {g.key === 'open' && r.extra && <span className="cp-sub cp-nw">{r.extra}</span>}
                    {g.key === 'lost' && r.extra && <span className="gs-badge red">Reason: {r.extra}</span>}
                    <span className="cp-who cp-nw">
                      {face(r.ownerName)}
                      {r.ownerName}
                    </span>
                    <b className={'cp-val' + (g.key === 'lost' ? ' muted' : '')}>{moneyTotal(s, [{ currency: rec.leads.find((l) => l.id === r.id)?.currency, amount: r.valueNum }])}</b>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}

        {tab === 'meetings' && (
          <div className="gs-glass cp-card" role="tabpanel" data-testid="company-meetings">
            <div className="cp-card-head">
              <h2>Meetings</h2>
              <button type="button" className="cp-iconb" aria-label="Schedule a meeting" title="Schedule a meeting" data-testid="company-add-meeting" onClick={() => store.meetings.openDialog({ companyId: rec.id })}>
                <Icon name="plus" size={15} />
              </button>
            </div>
            {meetings.length === 0 && <div className="cp-empty">No meetings with {rec.name} yet. Schedule the first one with the plus button.</div>}
            {meetings.map((m) => {
              const a = instantToZoned(m.startsAt, tz);
              const type = MEETING_TYPES.find((t) => t.value === m.type);
              const sub = [type?.value === 'visit' ? 'On site' : type?.short, m.location || a.time, m.organizerName ?? undefined, m.internalMinutes === 'recorded' ? 'minutes written' : undefined].filter(Boolean).join(', ');
              const tag = m.status === 'held' ? { label: 'Held', tone: 'green' } : m.status === 'planned' ? { label: 'Planned', tone: 'blue' } : { label: 'Cancelled', tone: '' };
              return (
                <Link key={m.id} to={paths.meeting(m.id)} className="cp-row cp-mrow" data-testid="company-meeting">
                  <span className="cp-dblk" aria-hidden="true">
                    <b>{Number(a.date.slice(8, 10))}</b>
                    <span>{isoLabel(a.date).split(' ')[1]}</span>
                  </span>
                  <span className="cp-contact-text">
                    <b>{m.title}</b>
                    <span className="cp-sub">{sub}</span>
                  </span>
                  <span className={'gs-badge ' + tag.tone}>{tag.label}</span>
                </Link>
              );
            })}
            {moreMeetings && (
              <div className="cp-row cp-more">
                <button type="button" className="cp-link" data-testid="meetings-more" onClick={() => void loadMoreMeetings()}>
                  Show more
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'tasks' && <TasksPanel companyName={rec.name} tasks={tasks} line={taskStats.line} today={today} leadId={taskLead?.id ?? null} />}

        {tab === 'projects' && (
          <div className="gs-glass cp-card" role="tabpanel" data-testid="company-projects">
            <div className="cp-card-head">
              <h2>Projects</h2>
            </div>
            {!projects && !projectsError && <div className="cp-empty">Loading projects</div>}
            {projectsError && <div className="cp-empty">Couldn't load the projects: {projectsError}</div>}
            {projects?.length === 0 && (
              <div className="cp-empty-big" data-testid="projects-empty">
                <b>No projects yet</b>
                <span className="cp-sub">A project starts here when an opportunity with {rec.name} is won.</span>
              </div>
            )}
            {projects?.map((p) => (
              <Link key={p.id} to={paths.project(p.id)} className="cp-row cp-mrow" data-testid="company-project">
                <span className="cp-contact-text">
                  <b>{p.code ? `${p.code}, ${p.name}` : p.name}</b>
                  <span className="cp-sub">{[p.stageName, p.leadName ?? 'No lead', p.dealTitle ? `from ${p.dealTitle}` : ''].filter(Boolean).join(', ')}</span>
                </span>
                <span className={'gs-badge ' + PROJECT_TAG[p.status].tone}>{PROJECT_TAG[p.status].label}</span>
              </Link>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <div className="gs-glass cp-card" role="tabpanel" data-testid="company-history">
            <div className="cp-card-head">
              <h2>History</h2>
            </div>
            <HistoryList rows={historyList} more={changes.more} failed={changes.failed} loaded={changes.entries !== null} tz={tz} onMore={changes.loadMore} />
          </div>
        )}
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

/** A row of a glass card: the label on the left (150 px, `narrow` 96 px), the control on the right, an optional link after it. */
function Row({ label, hint, link, top, narrow, error, children }: { label: string; hint?: string; link?: { href: string; label: string; text?: string }; top?: boolean; narrow?: boolean; error?: string | null; children: React.ReactNode }) {
  return (
    <div className={'cp-row' + (top ? ' top' : '')}>
      {/* The label is a text node of its span: the e2e harness finds a field by the span that reads its label. */}
      <span className={'cp-label' + (narrow ? ' narrow' : '')}>
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
function TextRow({ label, field, value, placeholder, numeric, lead, narrow, onSave }: { label: string; field: CompanyTextField; value: string; placeholder?: string; numeric?: boolean; lead?: boolean; narrow?: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const problem = fieldProblem(field, draft);
  const needed = !!lead && NEEDED_FIELDS.includes(field) && !draft.trim();
  return (
    <Row label={label} hint={needed ? 'Needed for Opportunity' : undefined} narrow={narrow} error={problem}>
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

/**
 * The company's field changes (CD-69), read a page at a time, again shortly after this tab's own
 * edits and after a live update. A read that a newer one overtook, or that finishes after the page
 * moved on, is dropped.
 */
function useCompanyChanges(id: string, rev: string): { entries: ApiHistoryEntry[] | null; more: boolean; failed: boolean; loadMore: () => void } {
  const { s, loadChanges } = useStore();
  const [entries, setEntries] = useState<ApiHistoryEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const shown = useRef(30);
  const touched = s.changedAt[id] ?? 0;
  const latest = useRef(0);
  useEffect(() => {
    setEntries(null);
    shown.current = 30;
    return () => {
      latest.current = -1;
    };
  }, [id]);
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
  const loadMore = useCallback(() => {
    shown.current += 30;
    void load(shown.current);
  }, [load]);
  return { entries, more, failed, loadMore };
}

/** The History tab (CD-534): one list as sentences, four rows, then "Show more" and "Show less". */
function HistoryList({ rows, more, failed, loaded, tz, onMore }: { rows: ReturnType<typeof historyRows>; more: boolean; failed: boolean; loaded: boolean; tz?: string; onMore: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 4);
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
      {rows.length === 0 && (loaded || failed) && <div className="cp-empty">{failed ? "Couldn't load the history. It loads when the connection is back." : 'Nothing here yet.'}</div>}
      {(!expanded && rows.length > 4) || (expanded && more) ? (
        <div className="cp-row cp-more">
          <button
            type="button"
            className="cp-link"
            data-testid="history-more"
            onClick={() => {
              setExpanded(true);
              if (expanded && more) onMore();
            }}
          >
            Show more
          </button>
        </div>
      ) : null}
      {expanded && rows.length > 4 && (
        <div className="cp-row cp-more">
          <button type="button" className="cp-link" data-testid="history-less" onClick={() => setExpanded(false)}>
            Show less
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The Tasks tab (CD-534): the to-dos on the company's opportunities, open ones first, each ticked
 * here; a new to-do goes on its open opportunity's current stage. Without an opportunity the add is
 * off: to-dos belong to opportunities (company-level to-dos are a follow-up).
 */
function TasksPanel({ companyName, tasks, line, today, leadId }: { companyName: string; tasks: ReturnType<typeof companyTasks>; line: string; today: string; leadId: string | null }) {
  const { s, flash, session, addLeadTask, toggleLeadTask, openLead } = useStore();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const noLead = 'To-dos belong to opportunities: add one first';
  const add = async () => {
    const lead = s.leads.find((l) => l.id === leadId);
    if (!lead || !title.trim() || busy) return;
    setBusy(true);
    const stage = stageOf(s, lead);
    const ok = await addLeadTask({ leadId: lead.id, stageId: stage.id, title: title.trim(), channel: stage.channel, due: today, ownerId: session.userId, note: '' });
    setBusy(false);
    if (ok) {
      setTitle('');
      setAdding(false);
      flash('To-do added');
    }
  };
  return (
    <div className="gs-glass cp-card" role="tabpanel" data-testid="company-tasks">
      <div className="cp-card-head">
        <h2>Tasks</h2>
        <span className="cp-sub">{line}</span>
        <button type="button" className={'cp-iconb' + (leadId ? '' : ' off')} aria-label="New to-do" title={leadId ? 'New to-do' : noLead} aria-expanded={adding} data-testid="company-add-task" onClick={() => (leadId ? setAdding((a) => !a) : flash(noLead, 5000))}>
          <Icon name="plus" size={15} />
        </button>
      </div>
      {adding && (
        <div className="cp-row cp-task-add">
          <input className="gs-input s" aria-label="New to-do" placeholder={`What needs to be done for ${companyName}?`} value={title} autoFocus data-testid="company-task-title" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
          <button type="button" className="gs-btn" onClick={() => setAdding(false)}>
            Cancel
          </button>
          <button type="button" className="gs-btn primary" data-testid="company-task-save" disabled={busy || !title.trim()} onClick={() => void add()}>
            Add
          </button>
        </div>
      )}
      {tasks.length === 0 && <div className="cp-empty">No to-dos for {companyName} yet.</div>}
      {tasks.map((t) => {
        const tag = t.due ? dueTag(t.due, today, t.done) : t.done ? { text: 'Done', tone: 'done' as const } : { text: 'No date', tone: 'later' as const };
        const tone = tag.tone === 'late' ? 'red' : tag.tone === 'today' ? 'green' : '';
        return (
          <div key={t.id} className="cp-row cp-task" data-testid="company-task">
            <button type="button" role="checkbox" aria-checked={t.done} aria-label={t.title} className={'cp-chk' + (t.done ? ' on' : '')} onClick={() => toggleLeadTask(t.id)}>
              <Icon name="check" size={12} />
            </button>
            <span className="cp-contact-text">
              <button type="button" className={'cp-task-title' + (t.done ? ' done' : '')} onClick={() => openLead(t.leadId)}>
                {t.title}
              </button>
              <span className="cp-sub">{memberName(s, t.ownerId || null, t.ownerName)}</span>
            </span>
            <span className={'gs-badge ' + tone}>{tag.text}</span>
          </div>
        );
      })}
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
