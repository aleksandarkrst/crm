import { useState } from 'react';
import { CustomFieldInputs, customFieldsForCreate } from '../components/CustomFields';
import { Modal, ModalHeader } from '../components/ui';
import { type CustomFieldPatch, type CustomFieldType, LOST_REASONS, type LostReason } from '../lib/api';
import { paths } from '../lib/paths';
import { checkActivityCode, checkMb } from '../lib/serbianIds';
import { checkEmail, checkPhone } from '../lib/validate';
import { BUYER_ROLES, CHANNEL_LABELS, FIELD_TYPES, SALE_TYPES } from '../store/seed';
import { allPeople, COMPANY_STATUS_LABELS, companyContacts, companyLabels, companyReadiness, companyRecords, customFieldsOf, memberLabels, pipelineBlocked, leadById, stageOf, stagesFor, todayIso, valueTotal } from '../store/selectors';
import { useStore } from '../store/store';
import type { ChannelCode, CompanyStatus, Lead, Person, SaleType } from '../store/types';
import { GenerationModal, NewTemplateModal } from './DocumentModals';
import { DealProductsDialog } from './DealProductsDialog';
import { MeetingDialog } from './MeetingDialog';
import { NewCompanyDialog } from './NewCompanyDialog';
import { NewProjectDialog } from './NewProjectDialog';
import { NewTaskDialog } from './NewTaskDialog';
import { NewWorkOrderDialog } from './NewWorkOrderDialog';
import { ProductModal } from './ProductModal';
import { ProposalDoc } from './ProposalDoc';

/** Every overlay in the app; open/closed state lives in the store. */
export function Modals() {
  const { s } = useStore();
  return (
    <>
      {s.genOpen && <GenerationModal />}
      {s.docOpen && <ProposalDoc />}
      {s.newLeadOpen && <NewDealModal />}
      {s.newCompanyOpen && <NewCompanyDialog />}
      {s.taskOpen && <NewTaskModal />}
      {s.contactOpen && <NewContactModal />}
      {s.personaOpen && <NewPersonaModal />}
      {s.templateOpen && <NewTemplateModal />}
      {s.fieldOpen && <NewFieldModal />}
      {s.drill && <DrillModal />}
      {s.productOpen && <ProductModal />}
      {s.dealProductsId && <DealProductsDialog />}
      {s.lostLeadId && <MarkLostModal />}
      {s.meetingDialog && <MeetingDialog />}
      {s.newProject && <NewProjectDialog />}
      {s.newTask && <NewTaskDialog />}
      {s.newWorkOrder && <NewWorkOrderDialog />}
    </>
  );
}

/** Sentinel for "make a new contact" in the New opportunity dialog (never shown). */
const NEW_CT = '\u0000new-contact';

/**
 * New opportunity (CD-360): only for a company that is an opportunity or a client. Leads are
 * listed but can't be picked; one passed in (from its page) shows what it still misses, with a link
 * to complete it. "+ New company" opens the New company dialog (a new company is a lead). The sale
 * type is required; the funnel choice and custom fields are as before.
 */
function NewDealModal() {
  const { s, set, flash, createDeal, openCompany } = useStore();
  const [busy, setBusy] = useState(false);
  const records = companyRecords(s);
  const labels = companyLabels(records);
  // Unknown (not loaded here) shows no status label, as pipelineBlocked leaves it to the API.
  const statusOf = (id: string): CompanyStatus | undefined => s.extraCompanies.find((c) => c.id === id)?.status;
  const companies = records
    .map((c) => ({ value: c.id, label: labels.get(c.id) ?? c.name, status: statusOf(c.id), blocked: pipelineBlocked(s, c.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const eligible = companies.filter((c) => !c.blocked);
  // The company passed in (even a lead: it says what is missing), else the first that can take one.
  const [company, setCompany] = useState(() => (s.newLeadCompanyId && companies.some((c) => c.value === s.newLeadCompanyId) ? s.newLeadCompanyId : (eligible[0]?.value ?? '')));
  const [contactPick, setContactPick] = useState<string | null>(() => allPeople(s).find((p) => p.contactId && p.contactId === s.newLeadContactId)?.name ?? null);
  const [contactName, setContactName] = useState('');
  const [saleType, setSaleType] = useState<SaleType | null>(null);
  const [saleTypeMissing, setSaleTypeMissing] = useState(false);
  const type = s.funnels[s.newLeadType] ? s.newLeadType : Object.keys(s.funnels)[0]!;

  const companyRec = records.find((c) => c.id === company);
  // A lead, or a Not interested company that isn't complete: listed, not eligible.
  const isLead = !!companyRec && pipelineBlocked(s, companyRec.id);
  const missing = isLead ? companyReadiness(s, companyRec.id).blockers : [];
  // The form here has no PIB field (a PIB is checked for duplicates on the company page).
  const fillHere = missing.length > 0 && !missing.includes('Company ID (PIB)');
  const people = companyRec ? allPeople(s).filter((p) => p.contactId && p.companyId === companyRec.id) : [];
  const contactOptions = [...people.map((p) => p.name), NEW_CT];
  const contact = contactPick && contactOptions.includes(contactPick) ? contactPick : contactOptions[0]!;
  const funnel = s.funnels[type];
  const [custom, setCustom] = useState<CustomFieldPatch>({});
  // From the meeting form (CD-213): the meeting's company stays, and the dialog shows above the meeting's.
  const forMeeting = s.newLeadForMeeting && !!s.newLeadCompanyId && company === s.newLeadCompanyId;
  const close = () => set({ newLeadOpen: false, newLeadCompanyId: null, newLeadContactId: null, newLeadForMeeting: false });

  const create = async () => {
    if (!companyRec || isLead) return;
    if (!saleType) return setSaleTypeMissing(true);
    const fields = customFieldsForCreate(customFieldsOf(s, 'deal'), custom);
    if ('missing' in fields) return flash(`Fill in ${fields.missing} first`);
    const ctName = contact === NEW_CT ? contactName.trim() : contact;
    const person = people.find((p) => p.name === ctName);
    setBusy(true);
    await createDeal({
      company: { id: companyRec.id, name: companyRec.name },
      contact: person ? { contactId: person.contactId, name: person.name } : ctName ? { name: ctName } : null,
      segment: type,
      saleType,
      ...(customFieldsOf(s, 'deal').length ? { customFields: fields.values } : {}),
    });
    setBusy(false);
  };

  return (
    <Modal maxWidth={560} gap={18} z={s.newLeadForMeeting ? 50 : undefined}>
      <ModalHeader title="New opportunity" sub="Pick the company and the funnel; activities and documents come with it. Only a company in status Opportunity or Client can enter the Pipeline." />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
        <div className="form-label">
          Company
          <select className="form-input" data-testid="new-deal-company" value={company} disabled={forMeeting} onChange={(e) => { setCompany(e.target.value); setContactPick(null); }}>
            {!companyRec && <option value="">No company can take one yet</option>}
            {companies.map((o) => (
              <option key={o.value} value={o.value} disabled={o.blocked && o.value !== company}>
                {o.label}
                {o.status ? ` · ${COMPANY_STATUS_LABELS[o.status]}` : ''}
                {o.blocked ? ' (not eligible)' : ''}
              </option>
            ))}
          </select>
          {!forMeeting && (
            // A new company is a lead: it is made (and completed) first, then it can take an opportunity.
            <button type="button" className="btn-link" data-testid="new-deal-add-company" onClick={() => set({ newLeadOpen: false, newLeadCompanyId: null, newLeadContactId: null, newCompanyOpen: true })}>
              + New company
            </button>
          )}
        </div>
        <div className="form-label">
          Primary contact
          {contact === NEW_CT ? (
            <div className="subform" data-testid="new-deal-new-contact">
              <div className="subform-head">
                <span>New contact</span>
                {people.length > 0 && (
                  <button type="button" className="btn-link" onClick={() => setContactPick(people[0]!.name)}>
                    Pick an existing one
                  </button>
                )}
              </div>
              <input className="form-input" placeholder="Full name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              <span className="subform-hint">Added to {companyRec?.name ?? 'the company'}.</span>
            </div>
          ) : (
            <>
              <select className="form-input" data-testid="new-deal-contact" value={contact} onChange={(e) => setContactPick(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id}>{p.name}</option>
                ))}
              </select>
              <button type="button" className="btn-link" data-testid="new-deal-add-contact" onClick={() => setContactPick(NEW_CT)}>
                + New contact
              </button>
            </>
          )}
        </div>
      </div>
      {isLead && companyRec && (
        <div className="notice-warn" data-testid="new-deal-lead" role="alert">
          <span style={{ fontWeight: 600 }}>
            {companyRec.name} {statusOf(companyRec.id) === 'lead' ? 'is still a lead' : "is Not interested and isn't complete"}
          </span>
          <span style={{ color: 'var(--text-2)' }}>
            {fillHere ? 'Fill in what is missing here, and it can take the opportunity. ' : missing.length ? 'Complete it on its page, and it can take the opportunity. ' : "Leads are listed but can't be picked. "}
            {missing.length ? `Missing for Opportunity: ${missing.join('; ').replace(/\.$/, '')}.` : 'It was set back to Lead by hand.'}
          </span>
          {fillHere && <CompleteCompany companyId={companyRec.id} />}
          {/* From a meeting form, leaving would drop the meeting. */}
          {!s.newLeadForMeeting && (
            <span>
              <button type="button" className="btn-link" data-testid="new-deal-complete-company" onClick={() => { close(); openCompany(companyRec.id); }}>
                Open the company instead
              </button>
            </span>
          )}
        </div>
      )}
      {!companyRec && <div className="hint-box">No company is an opportunity or a client yet. Complete a company first: its identity, address and a contact with a role, a role in the decision and an owner.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <span className="caps">Sale type</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 9 }} role="radiogroup" aria-label="Sale type">
          {SALE_TYPES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={saleType === t.id} data-testid={'new-deal-sale-' + t.id} className={saleType === t.id ? 'choice on' : 'choice'} onClick={() => { setSaleType(t.id); setSaleTypeMissing(false); }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45 }}>{t.note}</span>
            </button>
          ))}
        </div>
        {saleTypeMissing && (
          <span role="alert" style={{ fontSize: 12.5, color: 'var(--danger)' }}>
            Pick the sale type.
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <span className="caps">Target customer type</span>
        {Object.values(s.funnels).map((f) => (
          <button key={f.id} type="button" className={f.id === type ? 'choice on' : 'choice'} onClick={() => set({ newLeadType: f.id })}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{f.label}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45 }}>{f.note}</span>
          </button>
        ))}
      </div>
      <CustomFieldInputs entity="deal" values={custom} onChange={setCustom} />
      <div className="hint-box">
        Assigns the {funnel.stages.length}-stage funnel. First task: {funnel.stages[0]?.activity}.
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" data-testid="new-deal-create" disabled={busy || !companyRec || isLead} title={isLead ? 'A lead can\'t enter the Pipeline yet' : undefined} onClick={() => void create()}>
          {busy ? 'Creating…' : <>Create &amp; start funnel</>}
        </button>
      </div>
    </Modal>
  );
}

/**
 * What a lead misses, filled in right in the New opportunity dialog (CD-360): only the missing
 * identity fields, and the missing details of the contact closest to qualifying (or a new contact
 * when it has none). Saving makes it an opportunity, so the dialog can go on.
 */
function CompleteCompany({ companyId }: { companyId: string }) {
  const { s, session, completeCompany } = useStore();
  const extra = s.extraCompanies.find((c) => c.id === companyId);
  const blank = (v: string | undefined) => !v || !v.trim();
  const fields = ([['mb', 'Matični broj', '8 digits'], ['address', 'Street', 'Street and number'], ['city', 'City', 'City'], ['postalCode', 'Postal code', '21000'], ['activityCode', 'Šifra delatnosti', '4 digits, e.g. 6201']] as const).filter(([k]) => blank(extra?.[k]));
  const people = companyContacts(s, companyId);
  const gaps = (p: Person) => [blank(p.role) && 'role', blank(p.buyerRole) && 'buyerRole', !p.ownerId && 'ownerId'].filter((g): g is 'role' | 'buyerRole' | 'ownerId' => !!g);
  const ready = people.some((p) => gaps(p).length === 0);
  const person = ready ? undefined : [...people].sort((a, b) => gaps(a).length - gaps(b).length)[0];
  const contactGaps = ready ? [] : person ? gaps(person) : (['role', 'buyerRole', 'ownerId'] as const).slice();
  const [values, setValues] = useState<Record<string, string>>({ ownerId: session.userId });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const members = [...memberLabels(s)].map(([value, label]) => ({ value, label: value === session.userId ? `${label} (me)` : label }));

  const save = async () => {
    const errs: Record<string, string> = {};
    const company: Record<string, string> = {};
    for (const [k, label] of fields) {
      const v = (values[k] ?? '').trim();
      if (!v) errs[k] = `Fill in the ${label.toLowerCase()}`;
      const checked = k === 'mb' ? checkMb(v) : k === 'activityCode' ? checkActivityCode(v) : null;
      if (v && checked && !checked.ok) errs[k] = checked.error;
      company[k] = checked?.ok ? checked.value : v;
    }
    if (!ready && !person && !(values.fullName ?? '').trim()) errs.fullName = 'Name the contact';
    for (const g of contactGaps) if (!(values[g] ?? '').trim()) errs[g] = g === 'role' ? 'Fill in the job title' : g === 'buyerRole' ? 'Pick the role in the decision' : 'Pick the owner';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const details = { ...(contactGaps.includes('role') ? { jobTitle: values.role!.trim() } : {}), ...(contactGaps.includes('buyerRole') ? { buyerRole: values.buyerRole! } : {}), ...(contactGaps.includes('ownerId') ? { ownerUserId: values.ownerId! } : {}) };
    setBusy(true);
    await completeCompany(companyId, company, ready ? null : person?.contactId ? { id: person.contactId, patch: details } : { create: { fullName: values.fullName!.trim(), ...details } });
    setBusy(false);
  };

  const field = (k: string, label: string, input: React.ReactNode) => (
    <label key={k} className="form-label">
      {label}
      {input}
      {errors[k] && (
        <span role="alert" style={{ fontSize: 12, color: 'var(--danger)', textTransform: 'none', letterSpacing: 0 }}>
          {errors[k]}
        </span>
      )}
    </label>
  );
  return (
    <div data-testid="new-deal-complete-form" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
      {fields.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {fields.map(([k, label, ph]) => field(k, label, <input className="form-input" aria-label={label} placeholder={ph} value={values[k] ?? ''} onChange={set(k)} />))}
        </div>
      )}
      {!ready && (
        <>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{person ? person.name : 'A contact'}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {!person && field('fullName', 'Full name', <input className="form-input" aria-label="Contact name" value={values.fullName ?? ''} onChange={set('fullName')} />)}
            {contactGaps.includes('role') && field('role', 'Job title', <input className="form-input" aria-label="Job title" placeholder="e.g. CEO" value={values.role ?? ''} onChange={set('role')} />)}
            {contactGaps.includes('buyerRole') &&
              field(
                'buyerRole',
                'Role in the decision',
                <select className="form-input" aria-label="Role in the decision" value={values.buyerRole ?? ''} onChange={set('buyerRole')}>
                  <option value="">Pick one</option>
                  {BUYER_ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>,
              )}
            {contactGaps.includes('ownerId') &&
              field(
                'ownerId',
                'Owner',
                <select className="form-input" aria-label="Contact owner" value={values.ownerId ?? ''} onChange={set('ownerId')}>
                  {members.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>,
              )}
          </div>
        </>
      )}
      <span>
        <button type="button" className="btn btn-secondary" data-testid="new-deal-complete-save" disabled={busy} onClick={() => void save()} style={{ padding: '8px 12px' }}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
      </span>
    </div>
  );
}

/**
 * "New task", or the same dialog editing a task (CD-27: `taskEditId`). An edited task keeps its deal
 * and stage; its title, owner, due date, channel and note can change.
 */
function NewTaskModal() {
  const { s, set, flash, addLeadTask, updateLeadTask, session } = useStore();
  const editing = s.leadTasks.find((t) => t.id === s.taskEditId);
  const initialLead = leadById(s, editing?.leadId) || s.leads.find((l) => l.id === s.taskLeadId) || s.leads[0];
  const [leadId, setLeadId] = useState(initialLead?.id ?? '');
  const lead = leadById(s, leadId);
  const [stageId, setStageId] = useState(editing?.stageId ?? (initialLead ? stageOf(s, initialLead).id : ''));
  const [title, setTitle] = useState(editing?.title ?? '');
  const [channel, setChannel] = useState<ChannelCode>(editing?.channel ?? (initialLead ? stageOf(s, initialLead).channel : 'RS'));
  const [due, setDue] = useState(editing ? editing.due : todayIso(s.workspace.timezone));
  const members = s.team.filter((m) => m.status === 'Active');
  const [ownerId, setOwnerId] = useState(editing ? editing.ownerId : members.some((m) => m.id === session.userId) ? session.userId : (members[0]?.id ?? ''));
  const [note, setNote] = useState(editing?.note ?? '');
  const close = () => set({ taskOpen: false, taskEditId: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pickLead = (id: string) => {
    setLeadId(id);
    const l = leadById(s, id);
    if (l) {
      setStageId(stageOf(s, l).id);
      setChannel(stageOf(s, l).channel);
    }
  };
  const submit = async () => {
    if (!title.trim()) return setError('Give the task a title.');
    if (!lead) return setError('Pick the company and opportunity this task belongs to.');
    setError('');
    if (editing) {
      updateLeadTask(editing.id, { title, channel, due, ownerId, note });
      close();
      return;
    }
    setBusy(true);
    const ok = await addLeadTask({ leadId: lead.id, stageId, title, channel, due, ownerId, note });
    setBusy(false);
    if (ok) {
      set({ taskOpen: false, taskLeadId: lead.id });
      flash('Task added to ' + lead.company + ' · shows in Today');
    }
  };

  return (
    <Modal maxWidth={580}>
      <ModalHeader title={editing ? 'Edit task' : 'New task'} sub="Tasks outside the playbook still belong to a company and a stage, so the timeline stays complete." />
      <label className="form-label">
        Task title
        <input className="form-input" placeholder="e.g. Send revised scope to procurement" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="form-label">
          Company
          <select className="form-input" value={leadId} disabled={!!editing} onChange={(e) => pickLead(e.target.value)}>
            {!lead && <option value="">No opportunities yet</option>}
            {s.leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.company} · {stageOf(s, l).name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Funnel stage
          <select className="form-input" value={stageId} disabled={!!editing} onChange={(e) => setStageId(e.target.value)}>
            {(lead ? stagesFor(s, lead.segment) : []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Channel
          <select className="form-input" value={channel} onChange={(e) => setChannel(e.target.value as ChannelCode)}>
            {TASK_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Due date
          <input type="date" className="form-input" style={{ padding: '9px 10px' }} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="form-label" style={{ gridColumn: 'span 2' }}>
          Owner
          <select className="form-input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {!members.some((m) => m.id === ownerId) && <option value={ownerId}>{ownerId ? (editing?.ownerName ?? 'Former member') + ' (former member)' : 'No owner'}</option>}
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="form-label">
        Notes
        <textarea className="form-input" rows={3} placeholder="Context the next person needs" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="hint-box">Off-playbook task on {lead ? lead.company : 'an opportunity'}. It appears in Today and on the opportunity timeline, and does not block stage advance.</div>
      {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          {editing ? 'Save task' : busy ? 'Adding…' : 'Add task'}
        </button>
      </div>
    </Modal>
  );
}

/** Every channel a task can have (CD-28), labelled as on the timeline. */
const TASK_CHANNELS = Object.keys(CHANNEL_LABELS) as ChannelCode[];

/**
 * New contact (CD-464): at a company picked from every company (or the one it was opened from), and
 * on a deal only when it was opened from that deal. Name, email and phone are checked in the dialog.
 */
function NewContactModal() {
  const { s, set, session, createContact } = useStore();
  const [busy, setBusy] = useState(false);
  const nc = s.newContact;
  // Owner (CD-361): whoever adds the contact, unless they pick another member.
  const members = s.team.filter((m) => m.status === 'Active');
  const ownerId = nc.ownerId || session.userId;
  const deal = leadById(s, s.contactDealId);
  const fixedCompanyId = s.contactCompanyId ?? deal?.companyId ?? null;
  const companies = companyRecords(s);
  const fixedCompany = fixedCompanyId ? companies.find((c) => c.id === fixedCompanyId) : undefined;
  const [companyId, setCompanyId] = useState('');
  const [custom, setCustom] = useState<CustomFieldPatch>({});
  const [errors, setErrors] = useState<{ name?: string; role?: string; buyerRole?: string; email?: string; phone?: string; form?: string }>({});
  const setNc = (k: keyof typeof nc) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value;
    set((x) => ({ newContact: { ...x.newContact, [k]: v } }));
    if (k === 'name' || k === 'role' || k === 'buyerRole' || k === 'email' || k === 'phone') setErrors((x) => ({ ...x, [k]: undefined, form: undefined }));
  };
  const close = () => set({ contactOpen: false, contactCompanyId: null, contactDealId: '' });
  const create = async () => {
    const email = checkEmail(nc.email);
    const phone = checkPhone(nc.phone);
    const fields = customFieldsForCreate(customFieldsOf(s, 'contact'), custom);
    const next = {
      name: nc.name.trim() ? undefined : "Enter the contact's full name.",
      // A contact added here is complete (CD-361): job title and role in the decision.
      role: nc.role.trim() ? undefined : 'Enter their job title.',
      buyerRole: nc.buyerRole ? undefined : 'Pick their role in the decision.',
      email: email.ok ? undefined : email.error,
      phone: phone.ok ? undefined : phone.error,
      form: 'missing' in fields ? `Fill in ${fields.missing}.` : undefined,
    };
    setErrors(next);
    if (next.name || next.role || next.buyerRole || next.email || next.phone || next.form || !email.ok || !phone.ok || 'missing' in fields) return;
    setBusy(true);
    await createContact(
      { ...nc, name: nc.name.trim(), role: nc.role.trim(), email: email.value, phone: phone.value, ownerId },
      deal?.id,
      customFieldsOf(s, 'contact').length ? fields.values : undefined,
      (fixedCompanyId ?? companyId) || undefined,
    );
    setBusy(false);
  };
  const fieldError = (text: string | undefined) =>
    text ? (
      <span className="subform-hint" role="alert" data-testid="field-error" style={{ color: 'var(--danger)' }}>
        {text}
      </span>
    ) : null;
  return (
    <Modal maxWidth={580}>
      <ModalHeader title="New contact" sub="Pick their company, so they show up on its record and can be added to its opportunities." />
      <div className="contact-form-grid">
        <label className="form-label">
          Full name
          <input className="form-input" placeholder="e.g. Ana Marković" value={nc.name} onChange={setNc('name')} aria-invalid={!!errors.name || undefined} />
          {fieldError(errors.name)}
        </label>
        <label className="form-label">
          Job title
          <input className="form-input" placeholder="e.g. Marketing Director" value={nc.role} onChange={setNc('role')} aria-invalid={!!errors.role || undefined} />
          {fieldError(errors.role)}
        </label>
        <label className="form-label">
          Email
          <input className="form-input" type="email" placeholder="name@company.com" value={nc.email} onChange={setNc('email')} aria-invalid={!!errors.email || undefined} />
          {fieldError(errors.email)}
        </label>
        <label className="form-label">
          Phone
          <input className="form-input" type="tel" placeholder="+381 …" value={nc.phone} onChange={setNc('phone')} aria-invalid={!!errors.phone || undefined} />
          {fieldError(errors.phone)}
        </label>
        <label className="form-label">
          LinkedIn
          <input className="form-input" placeholder="linkedin.com/in/…" value={nc.linkedin} onChange={setNc('linkedin')} />
        </label>
        {fixedCompanyId ? (
          <label className="form-label">
            Company
            <input className="form-input" value={fixedCompany?.name ?? deal?.company ?? ''} readOnly />
          </label>
        ) : (
          <label className="form-label">
            Company
            <select className="form-input" data-testid="new-contact-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">No company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {deal && (
          <label className="form-label" style={{ gridColumn: '1 / -1' }}>
            Opportunity
            <input className="form-input" value={`${deal.company}${deal.title && deal.title !== deal.company ? ' · ' + deal.title : ''} · ${stageOf(s, deal).name}`} readOnly />
          </label>
        )}
      </div>
      <div className="contact-form-grid">
        <label className="form-label">
          Role in the decision
          <select className="form-input" value={nc.buyerRole} onChange={setNc('buyerRole')} aria-invalid={!!errors.buyerRole || undefined}>
            <option value="">Pick a role</option>
            {BUYER_ROLES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          {fieldError(errors.buyerRole)}
        </label>
        <label className="form-label">
          Owner
          <select className="form-input" data-testid="new-contact-owner" value={ownerId} onChange={(e) => set((x) => ({ newContact: { ...x.newContact, ownerId: e.target.value } }))}>
            {!members.some((m) => m.id === ownerId) && <option value={ownerId}>You</option>}
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === session.userId ? `${m.name} (you)` : m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <CustomFieldInputs entity="contact" values={custom} onChange={setCustom} />
      <label className="form-label">
        Notes
        <textarea className="form-input" rows={3} placeholder="Anything worth knowing" value={nc.notes} onChange={(e) => set((x) => ({ newContact: { ...x.newContact, notes: e.target.value } }))} />
      </label>
      {errors.form && (
        <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)' }}>
          {errors.form}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
          {busy ? 'Adding…' : 'Add contact'}
        </button>
      </div>
    </Modal>
  );
}

/** New funnel (CD-10): a target persona's playbook, copied from another funnel or a small default set. */
function NewPersonaModal() {
  const { s, set, createFunnel } = useStore();
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const bases = [
    ...Object.values(s.funnels).map((f) => ({ k: f.id, name: f.label, desc: `Copy its ${f.stages.length} stages, with their activities and to-dos. Opportunities stay where they are.` })),
    { k: 'blank', name: 'Default stages', desc: 'Start from New opportunity, Discovery, Proposal and Won, and build it yourself.' },
  ];
  const create = async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    await createFunnel({ label, note, copyFrom: s.funnels[s.personaBase] || s.personaBase === 'blank' ? s.personaBase : 'blank' });
    setBusy(false);
  };
  return (
    <Modal maxWidth={560}>
      <ModalHeader title="New funnel" sub="A funnel is the playbook for one target persona. Name who buys, then edit the stages, activities and documents." />
      <label className="form-label">
        Funnel name
        <input className="form-input" placeholder="e.g. Mid-market — marketing lead decides" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="form-label">
        How they buy
        <textarea className="form-input" rows={3} placeholder="Who decides, how long it takes, what slows it down" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <span className="caps">Start from</span>
        {bases.map((b) => (
          <button key={b.k} type="button" className={s.personaBase === b.k ? 'choice on' : 'choice'} onClick={() => set({ personaBase: b.k })}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{b.name}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45 }}>{b.desc}</span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={() => set({ personaOpen: false })}>
          Cancel
        </button>
        <button type="button" className={label.trim() && !busy ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!label.trim() || busy} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create funnel'}
        </button>
      </div>
    </Modal>
  );
}

/** New custom field (CD-15) for deals, companies or contacts; owners and admins only. */
function NewFieldModal() {
  const { s, set, flash, createCustomField } = useStore();
  const nf = s.newField;
  const [busy, setBusy] = useState(false);
  const reset = { label: '', type: 'text' as CustomFieldType, entity: nf.entity, required: false, options: '' };
  const patch = (p: Partial<typeof nf>) => set((x) => ({ newField: { ...x.newField, ...p } }));
  const options = nf.options.split('\n').map((o) => o.trim()).filter(Boolean);
  const entityLabel = { deal: 'opportunities', company: 'companies', contact: 'contacts' }[nf.entity];
  const add = async () => {
    if (!nf.label.trim() || busy) return;
    if (nf.type === 'select' && options.length === 0) return flash('Add at least one option, one per line');
    setBusy(true);
    const ok = await createCustomField({ entity: nf.entity, label: nf.label, type: nf.type, required: nf.required, options });
    setBusy(false);
    if (!ok) return;
    flash(nf.label.trim() + ' added to ' + entityLabel);
    set({ fieldOpen: false, newField: reset });
  };
  return (
    <Modal maxWidth={520}>
      <ModalHeader title="New field" sub="Custom fields show on the record and in its create form, and are included in CSV exports." />
      <label className="form-label">
        Field name
        <input className="form-input" placeholder="e.g. Contract end date" value={nf.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <span className="caps">Applies to</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['deal', 'company', 'contact'] as const).map((en) => (
            <button key={en} type="button" className={nf.entity === en ? 'choice-pill on' : 'choice-pill'} onClick={() => patch({ entity: en })}>
              {{ deal: 'Opportunities', company: 'Companies', contact: 'Contacts' }[en]}
            </button>
          ))}
        </div>
      </div>
      <label className="form-label">
        Type
        <select className="form-input" value={nf.type} onChange={(e) => patch({ type: e.target.value as CustomFieldType })}>
          {FIELD_TYPES.map((ft) => (
            <option key={ft.value} value={ft.value}>
              {ft.label}
            </option>
          ))}
        </select>
      </label>
      {nf.type === 'select' && (
        <label className="form-label">
          Options, one per line
          <textarea className="form-input" rows={4} placeholder={'e.g.\nGold\nSilver\nBronze'} value={nf.options} onChange={(e) => patch({ options: e.target.value })} />
        </label>
      )}
      <button type="button" onClick={() => patch({ required: !nf.required })} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left', border: 0, background: 'transparent', padding: 0 }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, border: `1px solid ${nf.required ? '#14503C' : '#CAD3CE'}`, background: nf.required ? '#14503C' : '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 11 }}>{nf.required ? '✓' : ''}</span>
        <span style={{ fontSize: 13, color: 'var(--ink)' }}>Required: must be filled in when the record is created in its form, and can't be cleared</span>
      </button>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={() => set({ fieldOpen: false, newField: reset })}>
          Cancel
        </button>
        <button type="button" className={nf.label.trim() && !busy ? 'btn btn-primary' : 'btn btn-disabled'} style={{ cursor: 'pointer' }} disabled={busy} onClick={() => void add()}>
          {busy ? 'Adding…' : 'Add field'}
        </button>
      </div>
    </Modal>
  );
}

function DrillModal() {
  const { s, set, navigate } = useStore();
  const d = s.drill!;
  const rows = d.leadIds.map((id) => leadById(s, id)).filter((l): l is Lead => !!l);
  const total = valueTotal(s, rows);
  const close = () => set({ drill: null });
  return (
    <Modal maxWidth={560} z={46} onBackdrop={close}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="caps-muted">{d.kicker}</span>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>{d.title}</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
            {rows.length}
            {rows.length === 1 ? ' opportunity · ' : ' opportunities · '}
            {d.summary ?? `${total} open`}
          </span>
        </div>
        <button type="button" onClick={close} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: '2px 4px' }}>
          ×
        </button>
      </div>
      {rows.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>No opportunities here right now.</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((l) => (
          <button
            key={l.id}
            type="button"
            className="drill-row"
            onClick={() => {
              close();
              navigate(paths.lead(l.id));
            }}
          >
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{l.company}</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {l.contact} · {l.role}
              </span>
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--brand)', whiteSpace: 'nowrap' }}>{d.amounts?.[l.id] ?? l.value}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** "Mark as lost": a reason from the pick list and an optional note (CD-60). */
function MarkLostModal() {
  const { s, set, flash, markLost } = useStore();
  const lead = leadById(s, s.lostLeadId);
  const [reason, setReason] = useState<LostReason | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => set({ lostLeadId: null });
  if (!lead) return null;
  const submit = async () => {
    if (!reason) return setError('Pick the reason the opportunity was lost.');
    setError('');
    setBusy(true);
    const ok = await markLost(lead.id, reason, note);
    setBusy(false);
    if (ok) {
      close();
      flash((lead.title || lead.company) + ' marked as lost · hidden from the pipeline board');
    }
  };
  return (
    <Modal maxWidth={500} onBackdrop={close}>
      <ModalHeader title="Mark as lost" sub={`${lead.title || lead.company} leaves the pipeline board and stops counting towards open pipeline. You can reopen it later.`} />
      <label className="form-label">
        Reason
        <select className="form-input" value={reason} autoFocus onChange={(e) => setReason(e.target.value as LostReason)}>
          <option value="" disabled>
            Pick a reason
          </option>
          {LOST_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="form-label">
        Note (optional)
        <textarea className="form-input" rows={3} maxLength={1000} placeholder="e.g. Went with a cheaper studio, revisit in Q3" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Mark as lost'}
        </button>
      </div>
    </Modal>
  );
}
