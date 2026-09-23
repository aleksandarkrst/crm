import { useState } from 'react';
import { Modal, ModalHeader } from '../components/ui';
import { paths } from '../lib/paths';
import { BILLING_KINDS, BUYER_ROLES, CHANNEL_LABELS, CHANNELS, DOC_TYPES, FIELD_TYPES, PARAM_SOURCES, PRODUCT_TYPES } from '../store/seed';
import { allPeople, companyRecords, leadById, salesPeople, stageOf, stagesFor, valueNum } from '../store/selectors';
import { useStore } from '../store/store';
import type { Lead, SegKey } from '../store/types';
import { ProposalDoc } from './ProposalDoc';

/** Every overlay in the app; open/closed state lives in the store. */
export function Modals() {
  const { s } = useStore();
  return (
    <>
      {s.genOpen && <GenerationModal />}
      {s.docOpen && <ProposalDoc />}
      {s.newLeadOpen && <NewDealModal />}
      {s.taskOpen && <NewTaskModal />}
      {s.contactOpen && <NewContactModal />}
      {s.personaOpen && <NewPersonaModal />}
      {s.templateOpen && <NewTemplateModal />}
      {s.fieldOpen && <NewFieldModal />}
      {s.drill && <DrillModal />}
      {s.productOpen && <NewProductModal />}
    </>
  );
}

const GEN_STEPS = ['Reading the company record', 'Merging 14 fields from this lead', 'Applying Proposal template v4', 'Pricing from the service rate card', 'Ready for review'];

function GenerationModal() {
  const { s, openGenerated } = useStore();
  const lead = leadById(s, s.genLead) || s.leads[0]!;
  const ready = s.genStep >= 4;
  return (
    <div className="overlay" style={{ zIndex: 40 }}>
      <div style={{ background: 'var(--white)', borderRadius: 14, width: '100%', maxWidth: 520, padding: 28, animation: 'dcFade .25s ease-out both' }}>
        <div className="caps">Stage rule fired</div>
        <div style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 24, lineHeight: 1.15, margin: '7px 0 6px' }}>Building the proposal for {lead.company}</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>Template: Proposal v4 · 8 sections · 14 merge fields</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 20 }}>
          {GEN_STEPS.map((label, i) => {
            const done = i < s.genStep;
            const current = i === s.genStep;
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <span style={{ flex: '0 0 18px', width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${done ? '#14503C' : current ? '#B4531B' : '#D0D5DD'}`, background: done ? '#14503C' : 'transparent', color: '#FFFFFF', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{done ? '✓' : ''}</span>
                <span style={{ fontSize: 13.5, color: done || current ? '#101828' : '#98A2B3' }}>{label}</span>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={openGenerated} style={{ width: '100%', marginTop: 22, border: 0, cursor: ready ? 'pointer' : 'wait', background: ready ? '#14503C' : '#F1F3F6', color: ready ? '#F5F6F8' : '#98A2B3', fontSize: 13.5, fontWeight: 500, padding: 12, borderRadius: 8 }}>
          {ready ? 'Review proposal' : 'Generating…'}
        </button>
      </div>
    </div>
  );
}

const NEW_CO = '+ New company…';
const NEW_CT = '+ New contact…';

function NewDealModal() {
  const { s, set, createDeal } = useStore();
  const [busy, setBusy] = useState(false);
  const records = companyRecords(s);
  const companies = records.map((c) => c.name);
  const [company, setCompany] = useState(companies[0] || NEW_CO);
  const [companyName, setCompanyName] = useState('');
  const [contactPick, setContactPick] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const type = s.newLeadType;

  const companyIsNew = company === NEW_CO;
  const companyId = records.find((c) => c.name === company)?.id;
  const people = companyIsNew ? [] : allPeople(s).filter((p) => p.contactId && p.companyId === companyId);
  const contactOptions = [...people.map((p) => p.name), NEW_CT];
  const contact = contactPick && contactOptions.includes(contactPick) ? contactPick : contactOptions[0]!;
  const funnel = s.funnels[type];

  const create = async () => {
    const coName = companyIsNew ? companyName.trim() || 'New company' : company;
    const ctName = contact === NEW_CT ? contactName.trim() : contact;
    const person = people.find((p) => p.name === ctName);
    setBusy(true);
    await createDeal({
      company: { id: companyIsNew ? undefined : companyId, name: coName },
      contact: person ? { contactId: person.contactId, name: person.name } : ctName ? { name: ctName } : null,
      segment: type,
    });
    setBusy(false);
  };

  return (
    <Modal maxWidth={560} gap={18}>
      <ModalHeader title="New deal" sub="Pick the customer type and the funnel, activities and documents come with it." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="form-label">
          Company
          <select className="form-input" value={company} onChange={(e) => { setCompany(e.target.value); setContactPick(null); }}>
            {[...companies, NEW_CO].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          {companyIsNew && <input className="form-input" placeholder="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />}
        </label>
        <label className="form-label">
          Primary contact
          <select className="form-input" value={contact} onChange={(e) => setContactPick(e.target.value)}>
            {contactOptions.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          {contact === NEW_CT && <input className="form-input" placeholder="Full name" value={contactName} onChange={(e) => setContactName(e.target.value)} />}
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <span className="caps">Target customer type</span>
        {(['smb', 'ent'] as SegKey[]).map((k) => (
          <button key={k} type="button" className={k === type ? 'choice on' : 'choice'} onClick={() => set({ newLeadType: k })}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.funnels[k].label}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45 }}>{s.funnels[k].note}</span>
          </button>
        ))}
      </div>
      <div className="hint-box">
        Assigns the {funnel.stages.length}-stage funnel. First task: {funnel.stages[0]?.activity}.
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={() => set({ newLeadOpen: false })}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
          {busy ? 'Creating…' : <>Create &amp; start funnel</>}
        </button>
      </div>
    </Modal>
  );
}

function NewTaskModal() {
  const { s, set, flash } = useStore();
  const taskLead = s.leads.find((l) => l.company === s.taskCompany) || s.leads[0];
  return (
    <Modal maxWidth={580}>
      <ModalHeader title="New task" sub="Tasks outside the playbook still belong to a company and a stage, so the timeline stays complete." />
      <label className="form-label">
        Task title
        <input className="form-input" placeholder="e.g. Send revised scope to procurement" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="form-label">
          Company
          <select className="form-input" value={s.taskCompany} onChange={(e) => set({ taskCompany: e.target.value })}>
            {s.leads.map((l) => (
              <option key={l.id} value={l.company}>
                {l.company} · {stageOf(s, l).name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Funnel stage
          <select className="form-input">
            {(taskLead ? stagesFor(s, taskLead.segment) : []).map((x) => (
              <option key={x.id}>{x.name}</option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Channel
          <select className="form-input">
            {CHANNELS.map((c) => (
              <option key={c}>{CHANNEL_LABELS[c]}</option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Due date
          <input type="date" className="form-input" style={{ padding: '9px 10px' }} />
        </label>
        <label className="form-label" style={{ gridColumn: 'span 2' }}>
          Owner
          <select className="form-input">
            {salesPeople(s).map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="form-label">
        Notes
        <textarea className="form-input" rows={3} placeholder="Context the next person needs" />
      </label>
      <div className="hint-box">Off-playbook task on {s.taskCompany}. It appears in Today and on the lead timeline, and does not block stage advance.</div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={() => set({ taskOpen: false })}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            set({ taskOpen: false });
            flash('Task added to ' + s.taskCompany + ' · shows in Today');
          }}
        >
          Add task
        </button>
      </div>
    </Modal>
  );
}

function NewContactModal() {
  const { s, set, flash, createContact } = useStore();
  const [busy, setBusy] = useState(false);
  const nc = s.newContact;
  const setNc = (k: keyof typeof nc) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value;
    set((x) => ({ newContact: { ...x.newContact, [k]: v } }));
  };
  const create = async () => {
    if (!nc.name.trim()) return flash('Give the contact a name first');
    setBusy(true);
    const lead = s.leads.find((x) => x.company === s.contactCompany) || s.leads[0];
    await createContact({ ...nc, name: nc.name.trim() }, lead?.id);
    setBusy(false);
  };
  return (
    <Modal maxWidth={580}>
      <ModalHeader title="New contact" sub="Every contact belongs to a company, so multi-threading shows up on the lead record." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="form-label">
          Full name
          <input className="form-input" placeholder="e.g. Ana Marković" value={nc.name} onChange={setNc('name')} />
        </label>
        <label className="form-label">
          Role
          <input className="form-input" placeholder="e.g. Marketing Director" value={nc.role} onChange={setNc('role')} />
        </label>
        <label className="form-label">
          Email
          <input className="form-input" placeholder="name@company.com" value={nc.email} onChange={setNc('email')} />
        </label>
        <label className="form-label">
          Phone
          <input className="form-input" placeholder="+381 …" value={nc.phone} onChange={setNc('phone')} />
        </label>
        <label className="form-label">
          LinkedIn
          <input className="form-input" placeholder="linkedin.com/in/…" value={nc.linkedin} onChange={setNc('linkedin')} />
        </label>
        <label className="form-label">
          Linked lead
          <select className="form-input" value={s.contactCompany} onChange={(e) => set({ contactCompany: e.target.value })}>
            {s.leads.map((l) => (
              <option key={l.id} value={l.company}>
                {l.company} · {stageOf(s, l).name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="form-label" style={{ maxWidth: 280 }}>
        Role in the decision
        <select className="form-input" value={nc.buyerRole} onChange={setNc('buyerRole')}>
          {BUYER_ROLES.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </label>
      <label className="form-label">
        Notes
        <textarea className="form-input" rows={3} placeholder="How they influence the deal" />
      </label>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={() => set({ contactOpen: false })}>
          Cancel
        </button>
        <button type="button" className={nc.name && !busy ? 'btn btn-primary' : 'btn btn-disabled'} style={{ cursor: 'pointer' }} disabled={busy} onClick={() => void create()}>
          {busy ? 'Adding…' : 'Add contact'}
        </button>
      </div>
    </Modal>
  );
}

function NewPersonaModal() {
  const { s, set, flash, navigate } = useStore();
  const bases = [
    { k: 'smb', name: s.funnels.smb.label, desc: `Copy the ${s.funnels.smb.stages.length}-stage short funnel.` },
    { k: 'ent', name: s.funnels.ent.label, desc: `Copy the ${s.funnels.ent.stages.length}-stage committee funnel.` },
    { k: 'blank', name: 'Blank funnel', desc: 'Start with one stage and build it yourself.' },
  ];
  return (
    <Modal maxWidth={560}>
      <ModalHeader title="New target persona" sub="A persona is a funnel. Name who buys, then edit the stages, activities and documents." />
      <label className="form-label">
        Persona name
        <input className="form-input" placeholder="e.g. Mid-market — marketing lead decides" />
      </label>
      <label className="form-label">
        How they buy
        <textarea className="form-input" rows={3} placeholder="Who decides, how long it takes, what slows it down" />
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            set({ personaOpen: false });
            navigate(paths.settings('funnel'));
            flash('Persona created · funnel copied, ready to edit');
          }}
        >
          Create persona
        </button>
      </div>
    </Modal>
  );
}

function NewTemplateModal() {
  const { s, set, flash } = useStore();
  const file = s.templateFile;
  return (
    <Modal maxWidth={600}>
      <ModalHeader title="New template" sub="Upload the document you already use. Every parameter it contains becomes a merge field the CRM fills from the lead record." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <span className="caps">Document type</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {DOC_TYPES.map((d) => (
            <button key={d} type="button" className={s.templateType === d ? 'choice-pill on' : 'choice-pill'} onClick={() => set({ templateType: d })}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <label className="form-label">
        Template name
        <input className="form-input" placeholder="e.g. Proposal — brand programme v1" />
      </label>
      <button
        type="button"
        onClick={() => set({ templateFile: s.templateType.toLowerCase().replace(/ /g, '-') + '.docx' })}
        style={{ cursor: 'pointer', textAlign: 'left', border: `1px dashed ${file ? '#14503C' : '#D0D5DD'}`, background: file ? '#E7F2EE' : '#F5F6F8', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 5 }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{file || 'Upload a .docx or .pdf'}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45 }}>{file ? 'Scanned · 3 parameters recognised' : 'Choose the document you already send. Parameters written in double braces are detected automatically.'}</span>
      </button>
      {file && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, background: 'var(--bg-soft)', borderRadius: 10, padding: 14 }}>
          <span className="caps">Parameters found</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {Object.entries(PARAM_SOURCES).map(([token, source]) => (
              <span key={token} style={{ fontSize: 12, background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 9px', color: 'var(--ink)' }}>
                {token} <span style={{ color: 'var(--muted)' }}>→ {source}</span>
              </span>
            ))}
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>These fill automatically each time the template runs. Anything not recognised stays as plain text.</span>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={() => set({ templateOpen: false, templateFile: null })}>
          Cancel
        </button>
        <button
          type="button"
          className={file ? 'btn btn-primary' : 'btn btn-disabled'}
          onClick={() => {
            if (!file) return;
            set({ templateOpen: false, templateFile: null });
            flash(s.templateType + ' template saved · available on matching stages');
          }}
        >
          Save template
        </button>
      </div>
    </Modal>
  );
}

function NewFieldModal() {
  const { s, set, flash } = useStore();
  const nf = s.newField;
  const reset = { label: '', type: 'Text', entity: 'Leads' as const, required: false };
  return (
    <Modal maxWidth={520}>
      <ModalHeader title="New field" sub="Custom fields appear on the record and in the create form, and can be merged into documents." />
      <label className="form-label">
        Field name
        <input className="form-input" placeholder="e.g. Contract end date" value={nf.label} onChange={(e) => set((x) => ({ newField: { ...x.newField, label: e.target.value } }))} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <span className="caps">Applies to</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['Leads', 'Contacts'] as const).map((en) => (
            <button key={en} type="button" className={nf.entity === en ? 'choice-pill on' : 'choice-pill'} onClick={() => set((x) => ({ newField: { ...x.newField, entity: en } }))}>
              {en}
            </button>
          ))}
        </div>
      </div>
      <label className="form-label">
        Type
        <select className="form-input" value={nf.type} onChange={(e) => set((x) => ({ newField: { ...x.newField, type: e.target.value } }))}>
          {FIELD_TYPES.map((ft) => (
            <option key={ft}>{ft}</option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => set((x) => ({ newField: { ...x.newField, required: !x.newField.required } }))} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left', border: 0, background: 'transparent', padding: 0 }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, border: `1px solid ${nf.required ? '#14503C' : '#D0D5DD'}`, background: nf.required ? '#14503C' : '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 11 }}>{nf.required ? '✓' : ''}</span>
        <span style={{ fontSize: 13, color: 'var(--ink)' }}>Required before a lead can advance a stage</span>
      </button>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={() => set({ fieldOpen: false, newField: reset })}>
          Cancel
        </button>
        <button
          type="button"
          className={nf.label ? 'btn btn-primary' : 'btn btn-disabled'}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            if (!nf.label) return;
            set((x) => ({ fields: [...x.fields, { id: 'f' + Date.now(), ...nf, system: false, visible: true }], fieldOpen: false, newField: reset }));
            flash(nf.label + ' added to ' + nf.entity.toLowerCase());
          }}
        >
          Add field
        </button>
      </div>
    </Modal>
  );
}

function DrillModal() {
  const { s, set, navigate } = useStore();
  const d = s.drill!;
  const rows = d.leadIds.map((id) => leadById(s, id)).filter((l): l is Lead => !!l);
  const total = rows.reduce((a, l) => a + valueNum(l.value), 0);
  const close = () => set({ drill: null });
  return (
    <Modal maxWidth={560} z={46} onBackdrop={close}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="caps-muted">{d.kicker}</span>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>{d.title}</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
            {rows.length}
            {rows.length === 1 ? ' lead · €' : ' leads · €'}
            {total.toLocaleString('en-US')} open
          </span>
        </div>
        <button type="button" onClick={close} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: '2px 4px' }}>
          ×
        </button>
      </div>
      {rows.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>No leads here right now.</span>}
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
            <span style={{ fontSize: 12.5, color: 'var(--brand)', whiteSpace: 'nowrap' }}>{l.value}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function NewProductModal() {
  const { s, set, flash, addProduct } = useStore();
  const p = s.newProduct;
  const reset = { name: '', type: 'Service', kind: 'One-off', price: '', vat: '20' };
  const setP = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value;
    set((x) => ({ newProduct: { ...x.newProduct, [k]: v } }));
  };
  return (
    <Modal maxWidth={520} z={46} gap={18}>
      <ModalHeader title="New product or service" sub="It becomes pickable on every deal, with this price and VAT as the starting point." />
      <label className="form-label">
        Name
        <input className="form-input" placeholder="e.g. Brand identity sprint" value={p.name} onChange={setP('name')} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="form-label">
          Type
          <select className="form-input" value={p.type} onChange={setP('type')}>
            {PRODUCT_TYPES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Billing
          <select className="form-input" value={p.kind} onChange={setP('kind')}>
            {BILLING_KINDS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Unit price (€)
          <input className="form-input" placeholder="6500" value={p.price} onChange={setP('price')} />
        </label>
        <label className="form-label">
          VAT %
          <input className="form-input" placeholder="20" value={p.vat} onChange={setP('vat')} />
        </label>
      </div>
      <div className="modal-actions" style={{ gap: 10 }}>
        <button type="button" className="btn btn-secondary" onClick={() => set({ productOpen: false, newProduct: reset })}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            const name = p.name.trim();
            if (!name) return flash('Give the product a name first');
            void addProduct({ ...p, name }).then((ok) => {
              if (!ok) return;
              set({ productOpen: false, newProduct: reset });
              flash(name + ' added to the catalog');
            });
          }}
        >
          Add to catalog
        </button>
      </div>
    </Modal>
  );
}
