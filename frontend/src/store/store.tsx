import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ApiTenant, type Channel, crmApi, type DealLineInput, type TaskInput } from '../lib/api';
import { paths } from '../lib/paths';
import { loadWorkspace, mapActivity, mapLine, type WorkspaceData } from './remote';
import { AUTO_GENERATE_DOCS, CHANNELS, GATE_STAGE_ADVANCE, initialState } from './seed';
import {
  champFor,
  closeIsoOf,
  companyRecords,
  defaultStart,
  initialsOf,
  itemById,
  leadById,
  money,
  netOf,
  num,
  personById,
  stageDone,
  stageOf,
  stagesFor,
  taskKey,
  taskOf,
  todayLabel,
  todoItemsFor,
} from './selectors';
import type { Champ, DealLine, Lead, LogEntry, NewContactDraft, NewProductDraft, Person, SegKey, Stage, State, TaskState } from './types';

type Updater = Partial<State> | ((s: State) => Partial<State>);

/** Who is signed in and which workspace (tenant) is open. */
export interface Session {
  userName: string;
  email: string;
  tenant: ApiTenant;
  tenants: ApiTenant[];
  switchTenant: (id: string) => void;
  signOut: () => void;
}

const ROADMAP_KEY = 'cadence.roadmapItems';

/**
 * Business records (deals with their lines and to-dos, companies, contacts, products, funnels,
 * activity) come from the API. Features the backend doesn't have yet (documents, team, settings)
 * still live only in this browser tab, seeded from the design.
 */
function loadInitial(data: WorkspaceData, session: Session): State {
  const s: State = { ...initialState(), ...data };
  s.workspace = { ...s.workspace, name: session.tenant.name };
  s.profile = { name: session.userName, email: session.email };
  s.taskCompany = data.leads[0]?.company ?? '';
  s.contactCompany = data.leads[0]?.company ?? '';
  try {
    const saved = localStorage.getItem(ROADMAP_KEY);
    const items: unknown = saved ? JSON.parse(saved) : null;
    if (Array.isArray(items)) s.roadmapItems = items as State['roadmapItems'];
  } catch {
    // ignore unreadable storage
  }
  return s;
}

const channelOf = (c: string): Channel => ((CHANNELS as readonly string[]).includes(c) ? (c as Channel) : 'NT');
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const EMPTY_CONTACT: NewContactDraft = { name: '', role: '', email: '', phone: '', linkedin: '', buyerRole: 'Influencer' };

function useStoreImpl(data: WorkspaceData, session: Session) {
  const [s, setState] = useState<State>(() => loadInitial(data, session));
  const ref = useRef(s);
  ref.current = s;
  const navigate = useNavigate();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const genTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const logRequested = useRef(new Set<string>());
  const pendingTasks = useRef(new Map<string, TaskInput>());

  const set = useCallback((u: Updater) => setState((prev) => ({ ...prev, ...(typeof u === 'function' ? u(prev) : u) })), []);

  useEffect(() => {
    try {
      localStorage.setItem(ROADMAP_KEY, JSON.stringify(s.roadmapItems));
    } catch {
      // ignore
    }
  }, [s.roadmapItems]);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      clearTimeout(toastTimer.current);
      clearInterval(genTimer.current);
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const flash = useCallback(
    (msg: string) => {
      clearTimeout(toastTimer.current);
      set({ toast: msg });
      toastTimer.current = setTimeout(() => set({ toast: '' }), 2600);
    },
    [set],
  );

  const actions = useMemo(() => {
    const cur = () => ref.current;
    const mapLead = (id: string, fn: (l: Lead) => Lead) => set((x) => ({ leads: x.leads.map((l) => (l.id === id ? fn(l) : l)) }));

    // ------------------------------------------------------------ persistence
    /** Re-reads the workspace from the API (after changes that touch several records). */
    const reload = async () => {
      try {
        set(await loadWorkspace());
      } catch (err) {
        flash('Could not refresh: ' + errText(err));
      }
    };
    /** Runs an API write; on failure shows why and reloads so the screen matches the database. */
    const save = (write: () => Promise<unknown>, then?: () => unknown) =>
      write()
        .then(() => then?.())
        .catch((err: unknown) => {
          flash('Not saved: ' + errText(err));
          void reload();
        });
    /** Coalesces typing into one write per field (inputs call their action on every keystroke). */
    const saveLater = (key: string, write: () => Promise<unknown>) => {
      clearTimeout(saveTimers.current.get(key));
      saveTimers.current.set(
        key,
        setTimeout(() => {
          saveTimers.current.delete(key);
          void save(write);
        }, 600),
      );
    };
    const refreshLog = async (leadId: string) => {
      const rows = await crmApi.activities(leadId);
      set((x) => ({ log: { ...x.log, [leadId]: rows.map(mapActivity) } }));
    };
    /** Loads the activity history of these leads once (screens call it when they open). */
    const ensureLog = (leadIds: string[]) => {
      for (const id of leadIds) {
        if (logRequested.current.has(id)) continue;
        logRequested.current.add(id);
        refreshLog(id).catch(() => logRequested.current.delete(id));
      }
    };

    const startGeneration = (leadId: string) => {
      clearInterval(genTimer.current);
      set({ genOpen: true, genLead: leadId, genStep: 0, sent: false });
      genTimer.current = setInterval(() => {
        set((x) => {
          if (x.genStep >= 4) {
            clearInterval(genTimer.current);
            return {};
          }
          return { genStep: x.genStep + 1 };
        });
      }, 620);
    };

    const moveLead = (leadId: string, stageId: string) => {
      const lead = leadById(cur(), leadId);
      if (!lead || lead.stage === stageId) return;
      const stage = stagesFor(cur(), lead.segment).find((st) => st.id === stageId);
      mapLead(leadId, (l) => ({ ...l, stage: stageId, stall: 0 }));
      void save(() => crmApi.moveDeal(leadId, stageId), () => refreshLog(leadId));
      if (stage && stage.doc === 'Proposal' && AUTO_GENERATE_DOCS) startGeneration(leadId);
      else if (stage) flash('Moved to ' + stage.name + ' · next activity: ' + stage.activity);
    };

    const pushLog = (leadId: string, entry: LogEntry) => {
      set((x) => ({ log: { ...x.log, [leadId]: [entry, ...(x.log[leadId] || [])] } }));
      void save(() => crmApi.logActivity(leadId, { channel: channelOf(entry.channel), title: entry.title, detail: entry.detail || null }));
    };

    // ------------------------------------------------------------ deal lines
    /** A line as the API takes it (the UI keeps numbers as typed strings while editing). */
    const lineInput = (l: DealLine): DealLineInput => ({
      productId: l.itemId || null,
      quantity: num(l.qty),
      unitPrice: num(l.price),
      vatRate: Math.min(100, num(l.vat)),
      schedule: l.schedule,
      startDate: l.start || null,
      months: Math.min(120, Math.max(1, Math.round(num(l.months)) || 1)),
      milestones: (l.milestones || []).map((m) => ({ label: m.label, pct: Math.min(100, num(m.pct)), ...(m.date ? { date: m.date } : {}) })),
    });

    /**
     * Applies a change to a deal's lines and saves what changed: edited lines are saved after a
     * pause (one write per line), removed lines are deleted. The backend recalculates the amount.
     */
    const updateLines = (leadId: string, fn: (lines: DealLine[]) => DealLine[]) => {
      const x = cur();
      const prev = x.dealLines[leadId] || [];
      const next = fn(prev.map((l) => ({ ...l })));
      set((y) => ({
        dealLines: { ...y.dealLines, [leadId]: next },
        leads: y.leads.map((l) => (l.id === leadId ? { ...l, value: money(netOf(next)) } : l)),
      }));
      const before = new Map(prev.map((l) => [l.id, JSON.stringify(l)]));
      for (const l of next)
        if (before.get(l.id) !== JSON.stringify(l))
          saveLater('line:' + l.id, async () => {
            const line = (cur().dealLines[leadId] || []).find((y) => y.id === l.id);
            if (line) await crmApi.updateDealLine(line.id, lineInput(line));
          });
      for (const l of prev)
        if (!next.some((y) => y.id === l.id)) {
          clearTimeout(saveTimers.current.get('line:' + l.id));
          void save(() => crmApi.deleteDealLine(l.id));
        }
    };

    const patchLine = (leadId: string, lineId: string, key: keyof DealLine, v: string) => {
      const lead = leadById(cur(), leadId);
      const minIso = lead ? closeIsoOf(lead) : '';
      if (key === 'start' && minIso && v && v < minIso) {
        flash('Payments must fall after the closing date');
        return;
      }
      updateLines(leadId, (ls) =>
        ls.map((l) => {
          if (l.id !== lineId) return l;
          if (key === 'itemId') {
            const it = itemById(cur(), v);
            return { ...l, itemId: v, price: it.price, vat: it.vat };
          }
          return { ...l, [key]: v };
        }),
      );
    };

    const addDealLine = (lead: Lead) => {
      if (!closeIsoOf(lead)) {
        flash('Set the closing date first');
        return;
      }
      const it = cur().catalog[0];
      if (!it) {
        flash('Add a product to the catalog first');
        return;
      }
      const position = (cur().dealLines[lead.id] || []).length;
      void save(async () => {
        const row = await crmApi.createDealLine(lead.id, {
          productId: it.id,
          position,
          quantity: 1,
          unitPrice: num(it.price),
          vatRate: num(it.vat),
          schedule: 'Full amount on one date',
          startDate: defaultStart(lead),
          months: 6,
        });
        set((y) => {
          const next = [...(y.dealLines[lead.id] || []), mapLine(row)];
          return { dealLines: { ...y.dealLines, [lead.id]: next }, leads: y.leads.map((l) => (l.id === lead.id ? { ...l, value: money(netOf(next)) } : l)) };
        });
      });
    };

    const patchMilestone = (leadId: string, lineId: string, idx: number, key: 'label' | 'pct' | 'date', v: string) => {
      const lead = leadById(cur(), leadId);
      const minIso = lead ? closeIsoOf(lead) : '';
      if (key === 'date' && minIso && v && v < minIso) {
        flash('Milestones must fall after the closing date');
        return;
      }
      updateLines(leadId, (ls) =>
        ls.map((l) => (l.id === lineId ? { ...l, milestones: (l.milestones || []).map((m, i) => (i === idx ? { ...m, [key]: v } : m)) } : l)),
      );
    };

    // ------------------------------------------------------------ people
    const linkPerson = (leadId: string, personId: string) => {
      const p = personById(cur(), personId);
      const contactId = p?.contactId;
      if (!p || !contactId) return;
      set((x) => ({ links: { ...x.links, [leadId]: [...(x.links[leadId] || []), personId] } }));
      void save(() => crmApi.linkContact(leadId, contactId));
      flash(p.name + ' linked to this lead');
    };
    const unlinkPerson = (leadId: string, personId: string) => {
      const p = personById(cur(), personId);
      const contactId = p?.contactId;
      if (!p || !contactId) return;
      if (p.primary && p.leadId === leadId) {
        flash(p.name + ' is the primary contact of this lead');
        return;
      }
      set((x) => ({ links: { ...x.links, [leadId]: (x.links[leadId] || []).filter((i) => i !== personId) } }));
      void save(() => crmApi.unlinkContact(leadId, contactId));
    };

    const CONTACT_FIELDS: Partial<Record<keyof Person, 'fullName' | 'jobTitle' | 'email' | 'phone' | 'linkedin' | 'buyerRole'>> = {
      name: 'fullName',
      role: 'jobTitle',
      email: 'email',
      phone: 'phone',
      linkedin: 'linkedin',
      buyerRole: 'buyerRole',
    };
    const patchPerson = (id: string, patch: Partial<Person>) => {
      const p = personById(cur(), id);
      const contactId = p?.contactId;
      if (!p || !contactId) return;
      for (const [k, v] of Object.entries(patch)) {
        const field = CONTACT_FIELDS[k as keyof Person];
        const value = String(v ?? '');
        if (field && !(field === 'fullName' && !value.trim())) saveLater(`contact:${contactId}:${field}`, () => crmApi.updateContact(contactId, { [field]: value }));
      }
      const withInitials = patch.name !== undefined ? { ...patch, initials: initialsOf(patch.name) } : patch;
      if (p.primary) {
        const map: Record<string, string> = { name: 'contact', role: 'role', email: 'email', phone: 'phone', buyerRole: 'buyerRole', initials: 'initials' };
        const lp: Record<string, unknown> = {};
        Object.entries(withInitials).forEach(([k, v]) => (lp[map[k] || k] = v));
        set((x) => ({ leads: x.leads.map((l) => (l.contactId === contactId ? { ...l, ...lp } : l)) }));
      } else {
        set((x) => ({ extraPeople: x.extraPeople.map((y) => (y.id === id ? { ...y, ...withInitials } : y)) }));
      }
    };

    /**
     * Moves a contact to the company of another lead and links them to that lead. A moved primary
     * contact is replaced on their old leads by another contact of that company, if there is one.
     */
    const movePerson = (id: string, newLeadId: string) => {
      const x = cur();
      const p = personById(x, id);
      const target = leadById(x, newLeadId);
      const contactId = p?.contactId;
      if (!p || !target || !contactId || newLeadId === p.leadId) return;
      const promoted = p.primary ? x.extraPeople.find((y) => y.leadId === p.leadId && y.contactId) : undefined;
      const affected = p.primary ? x.leads.filter((l) => l.contactId === contactId) : [];
      void save(
        async () => {
          await crmApi.updateContact(contactId, { companyId: target.companyId ?? null });
          for (const l of affected) await crmApi.updateDeal(l.id, { primaryContactId: promoted?.contactId ?? null });
          await crmApi.linkContact(newLeadId, contactId);
        },
        async () => {
          await reload();
          navigate(paths.contact(contactId), { replace: true });
          flash('Contact moved to ' + target.company);
        },
      );
    };

    // ------------------------------------------------------------ stage to-dos
    /**
     * Saves a to-do's state. Playbook to-dos are upserted by deal + stage + label; off-playbook
     * to-dos by id. Changes made within the pause (done, then a note) are merged into one write.
     */
    const persistTask = (leadId: string, stageId: string, idx: number, fields: TaskInput) => {
      const x = cur();
      const lead = leadById(x, leadId);
      const item = lead ? todoItemsFor(x, lead, stageId)[idx] : undefined;
      if (!item) return;
      const key = taskKey(leadId, stageId, idx);
      pendingTasks.current.set(key, { ...pendingTasks.current.get(key), ...fields });
      const extraId = item.offPlaybook ? x.extraTodoIds[leadId + '::' + stageId]?.[item.extraIdx!] : undefined;
      saveLater('task:' + key, async () => {
        const body = pendingTasks.current.get(key) ?? {};
        pendingTasks.current.delete(key);
        if (!item.offPlaybook) await crmApi.upsertPlaybookTask(leadId, { stageId, label: item.label, ...body });
        else if (extraId) await crmApi.updateTask(extraId, body);
      });
    };

    const patchTask = (leadId: string, stageId: string, idx: number, patch: TaskState) => {
      const full = patch.done && !patch.by ? { at: todayLabel(), by: session.userName.split(' ')[0], ...patch } : patch;
      set((x) => {
        const key = taskKey(leadId, stageId, idx);
        return { tasks: { ...x.tasks, [key]: { ...x.tasks[key], ...full } } };
      });
      const fields: TaskInput = {};
      if (patch.done !== undefined) fields.done = patch.done;
      if (patch.outcome !== undefined) fields.outcome = patch.outcome;
      if (patch.note !== undefined) fields.note = patch.note;
      if (Object.keys(fields).length) persistTask(leadId, stageId, idx, fields);
    };

    const completeTask = (lead: Lead, stageId: string, idx: number, label: string) => {
      const existing = taskOf(cur(), lead.id, stageId, idx);
      if (existing.done) {
        patchTask(lead.id, stageId, idx, { done: false });
        return;
      }
      const date = todayLabel();
      patchTask(lead.id, stageId, idx, { done: true, at: date, by: session.userName.split(' ')[0] });
      const stage = stagesFor(cur(), lead.segment).find((x) => x.id === stageId);
      pushLog(lead.id, {
        date,
        channel: stage ? stage.channel : 'RS',
        title: label,
        detail: (existing.note || 'Completed against the ' + (stage ? stage.name : '') + ' playbook.') + (existing.outcome ? ' · ' + existing.outcome : ''),
      });
      flash('Marked done · added to the activity timeline');
    };

    const addTodo = (leadId: string, stageId: string) => {
      const key = leadId + '::' + stageId;
      const position = (cur().extraTodos[key] || []).length;
      void save(async () => {
        const row = await crmApi.createTask(leadId, { stageId, label: '', position });
        set((x) => ({
          extraTodos: { ...x.extraTodos, [key]: [...(x.extraTodos[key] || []), ''] },
          extraTodoIds: { ...x.extraTodoIds, [key]: [...(x.extraTodoIds[key] || []), row.id] },
        }));
      });
    };
    const renameExtra = (leadId: string, stageId: string, extraIdx: number, val: string) => {
      const key = leadId + '::' + stageId;
      const id = cur().extraTodoIds[key]?.[extraIdx];
      set((x) => {
        const list = [...(x.extraTodos[key] || [])];
        list[extraIdx] = val;
        return { extraTodos: { ...x.extraTodos, [key]: list } };
      });
      if (id) saveLater('todo-label:' + id, () => crmApi.updateTask(id, { label: val.trim() }));
    };
    const removeExtra = (leadId: string, stageId: string, extraIdx: number, taskIdx: number) => {
      const key = leadId + '::' + stageId;
      const id = cur().extraTodoIds[key]?.[extraIdx];
      set((x) => {
        const list = [...(x.extraTodos[key] || [])];
        const ids = [...(x.extraTodoIds[key] || [])];
        const count = list.length;
        list.splice(extraIdx, 1);
        ids.splice(extraIdx, 1);
        // The to-dos after the removed one move up by one position.
        const tasks = { ...x.tasks };
        const first = taskIdx - extraIdx;
        for (let i = taskIdx; i < first + count; i++) {
          const nextState = tasks[taskKey(leadId, stageId, i + 1)];
          if (nextState) tasks[taskKey(leadId, stageId, i)] = nextState;
          else delete tasks[taskKey(leadId, stageId, i)];
        }
        return { extraTodos: { ...x.extraTodos, [key]: list }, extraTodoIds: { ...x.extraTodoIds, [key]: ids }, tasks };
      });
      if (id) {
        clearTimeout(saveTimers.current.get('todo-label:' + id));
        void save(() => crmApi.deleteTask(id));
      }
    };

    const advanceStage = (leadId: string) => {
      const lead = leadById(cur(), leadId);
      if (!lead) return;
      const stages = stagesFor(cur(), lead.segment);
      const stage = stageOf(cur(), lead);
      const i = stages.indexOf(stage);
      if (GATE_STAGE_ADVANCE && !stageDone(cur(), lead, stage.id)) {
        flash('Complete the to-do first — that is what keeps the funnel honest.');
        return;
      }
      if (i >= stages.length - 1) {
        flash('Already at the final stage.');
        return;
      }
      moveLead(lead.id, stages[i + 1]!.id);
    };

    // ------------------------------------------------------------ funnel builder
    /** Edits one stage of the open funnel and saves it (editing funnels is an admin action). */
    const editStage = (idx: number, fn: (stage: Stage) => void) => {
      const x = cur();
      const funnels = JSON.parse(JSON.stringify(x.funnels)) as State['funnels'];
      const funnel = funnels[x.segment];
      const st = funnel.stages[idx];
      if (!st) return;
      fn(st);
      set({ funnels });
      const funnelId = funnel.id;
      if (!funnelId) return;
      saveLater('stage:' + st.id, () =>
        crmApi.updateStage(funnelId, st.id, {
          name: st.name.trim() || 'Stage',
          activity: st.activity,
          channel: channelOf(st.channel),
          documentOnEntry: st.doc === 'None' ? null : st.doc,
          winProbability: st.prob === '' ? 0 : st.prob,
          checklist: st.checklist.map((c) => c.trim()).filter(Boolean),
        }),
      );
    };
    const notYet = (..._args: unknown[]) => flash('Adding and removing stages is not supported yet. Edits to existing stages are saved.');

    // ------------------------------------------------------------ companies
    const setCompanyField = (name: string, key: 'name' | 'industry' | 'hq' | 'size' | 'source', v: string) => {
      const id = companyRecords(cur()).find((c) => c.name === name)?.id;
      const field = key === 'size' ? 'teamSize' : key;
      if (id && !(key === 'name' && !v.trim())) saveLater(`company:${id}:${field}`, () => crmApi.updateCompany(id, { [field]: v }));
      set((x) => ({
        leads: x.leads.map((l) => (l.company === name ? { ...l, ...(key === 'name' ? { company: v } : { [key]: v }) } : l)),
        extraCompanies: x.extraCompanies.map((c) => (c.name === name ? { ...c, [key]: v } : c)),
        extraPeople: key === 'name' ? x.extraPeople.map((p) => (p.company === name ? { ...p, company: v } : p)) : x.extraPeople,
      }));
      if (key === 'name') navigate(paths.company(v), { replace: true });
    };

    /** Deal fields save to the deal; industry, HQ and team size belong to the company. */
    const patchLead = (id: string, patch: Partial<Lead>) => {
      const lead = leadById(cur(), id);
      if (!lead) return;
      const { industry, hq, size, ...dealPatch } = patch;
      if (industry !== undefined) setCompanyField(lead.company, 'industry', industry);
      if (hq !== undefined) setCompanyField(lead.company, 'hq', hq);
      if (size !== undefined) setCompanyField(lead.company, 'size', size);
      const { title, closeDate, source, company } = dealPatch;
      if (title !== undefined && title.trim()) saveLater('title:' + id, () => crmApi.updateDeal(id, { title: title.trim() }));
      if (closeDate !== undefined) saveLater('close:' + id, () => crmApi.updateDeal(id, { closeDate: closeDate || null }));
      if (source !== undefined) saveLater('source:' + id, () => crmApi.updateDeal(id, { source }));
      if (company !== undefined) {
        const companyId = companyRecords(cur()).find((c) => c.name === company)?.id;
        if (companyId) void save(() => crmApi.updateDeal(id, { companyId }), reload);
      }
      mapLead(id, (l) => ({ ...l, ...dealPatch }));
    };

    return {
      set,
      flash,
      navigate,
      reload,
      ensureLog,
      moveLead,
      startGeneration,
      pushLog,
      patchLead,
      patchLeadSegment: (id: string, seg: SegKey) => {
        const funnelId = cur().funnels[seg].id;
        if (!funnelId) return;
        mapLead(id, (l) => ({ ...l, segment: seg, stage: stagesFor(cur(), seg)[0]!.id }));
        void save(() => crmApi.updateDeal(id, { funnelId }), () => refreshLog(id));
        flash('Funnel reassigned · lead moved to the first stage');
      },
      openLead: (id: string) => navigate(paths.lead(id)),
      openContact: (id: string) => navigate(paths.contact(id)),
      openCompany: (name: string) => navigate(paths.company(name)),
      openGenerated: () => {
        const x = cur();
        if (x.genStep < 4 || !x.genLead) return;
        const leadId = x.genLead;
        mapLead(leadId, (l) => ({ ...l, docs: [{ name: 'Proposal — ' + l.headline, state: 'draft', meta: 'v1 · generated just now · not sent' }, ...(l.docs || [])] }));
        set({ genOpen: false, docOpen: true, docLeadId: leadId, sent: false });
      },
      openDoc: (leadId: string) => set({ docOpen: true, docLeadId: leadId, sent: false }),
      sendDoc: () => {
        set({ sent: true });
        flash('Proposal sent · walkthrough task created for tomorrow');
      },
      updateLines,
      patchLine,
      addDealLine,
      removeDealLine: (leadId: string, lineId: string) => updateLines(leadId, (ls) => ls.filter((l) => l.id !== lineId)),
      addMilestone: (leadId: string, lineId: string) =>
        updateLines(leadId, (ls) => ls.map((l) => (l.id === lineId ? { ...l, milestones: [...(l.milestones || []), { label: 'New milestone', pct: 0 }] } : l))),
      patchMilestone,
      setChamp: (leadId: string, key: keyof Champ, v: number) => {
        set((y) => {
          const lead = leadById(y, leadId);
          if (!lead) return {};
          const champ = { ...(y.champ[leadId] || champFor(y, lead)), [key]: v };
          const total = champ.C + champ.H + champ.M + champ.P;
          return { champ: { ...y.champ, [leadId]: champ }, leads: y.leads.map((l) => (l.id === leadId ? { ...l, score: total } : l)) };
        });
        // Quick clicks across the four criteria become one write of the final scores.
        saveLater('champ:' + leadId, async () => {
          const champ = cur().champ[leadId];
          if (champ) await crmApi.updateDeal(leadId, { champ });
        });
      },
      linkPerson,
      unlinkPerson,
      patchPerson,
      movePerson,
      patchTask,
      completeTask,
      addTodo,
      renameExtra,
      removeExtra,
      advanceStage,
      addStage: notYet,
      editStage: (idx: number, key: 'name' | 'activity' | 'channel' | 'doc', val: string) => editStage(idx, (st) => void ((st as unknown as Record<string, string>)[key] = val)),
      editProb: (idx: number, raw: string) => editStage(idx, (st) => void (st.prob = raw === '' ? '' : Math.max(0, Math.min(100, Math.round(Number(raw) || 0))))),
      removeStage: notYet,
      addGate: (idx: number) => editStage(idx, (st) => void st.checklist.push('New to-do')),
      renameGate: (idx: number, gi: number, val: string) => editStage(idx, (st) => void (st.checklist[gi] = val)),
      removeGate: (idx: number, gi: number) => editStage(idx, (st) => void st.checklist.splice(gi, 1)),
      setCompanyField,
      addCompany: () => {
        const taken = new Set(companyRecords(cur()).map((c) => c.name));
        let name = 'New company';
        for (let i = 2; taken.has(name); i++) name = 'New company ' + i;
        void save(
          () => crmApi.createCompany({ name }),
          async () => {
            await reload();
            navigate(paths.company(name));
          },
        );
      },

      // ---------------------------------------------------------- creating records
      /** New deal; creates the company and the primary contact first when they are new. */
      createDeal: async (input: { company: { id?: string; name: string }; contact: { contactId?: string; name: string } | null; segment: SegKey }) => {
        const funnelId = cur().funnels[input.segment].id;
        if (!funnelId) return;
        try {
          const companyId = input.company.id ?? (await crmApi.createCompany({ name: input.company.name })).id;
          let primaryContactId = input.contact?.contactId;
          if (input.contact && !primaryContactId) primaryContactId = (await crmApi.createContact({ fullName: input.contact.name, companyId, buyerRole: 'Decision maker' })).id;
          const deal = await crmApi.createDeal({ title: input.company.name, funnelId, companyId, primaryContactId: primaryContactId ?? null });
          await reload();
          set({ newLeadOpen: false, segment: input.segment });
          navigate(paths.lead(deal.id));
          flash(input.company.name + ' added · funnel assigned · first task due today');
        } catch (err) {
          flash('Not saved: ' + errText(err));
        }
      },
      /** New contact at the company of the chosen lead, linked to that lead. */
      createContact: async (draft: NewContactDraft, leadId: string | undefined) => {
        const lead = leadById(cur(), leadId);
        try {
          const c = await crmApi.createContact({
            fullName: draft.name,
            jobTitle: draft.role,
            email: draft.email,
            phone: draft.phone,
            linkedin: draft.linkedin,
            buyerRole: draft.buyerRole,
            companyId: lead?.companyId ?? null,
          });
          if (lead) await crmApi.linkContact(lead.id, c.id);
          await reload();
          set({ contactOpen: false, newContact: EMPTY_CONTACT });
          flash(draft.name + (lead ? ' added to ' + lead.company : ' added'));
        } catch (err) {
          flash('Not saved: ' + errText(err));
        }
      },

      // ---------------------------------------------------------- product catalog
      addProduct: async (draft: NewProductDraft): Promise<boolean> => {
        try {
          const p = await crmApi.createProduct({
            name: draft.name,
            type: draft.type as 'Service' | 'Product',
            billingKind: draft.kind as 'One-off' | 'Monthly' | 'Yearly' | 'Hourly',
            unitPrice: num(draft.price),
            vatRate: num(draft.vat),
          });
          set((x) => ({ catalog: [...x.catalog, { id: p.id, name: p.name, type: p.type, kind: p.billingKind, price: Number(p.unitPrice), vat: Number(p.vatRate) }] }));
          return true;
        } catch (err) {
          flash('Not saved: ' + errText(err));
          return false;
        }
      },
      patchProduct: (id: string, key: 'name' | 'type' | 'kind' | 'price' | 'vat', v: string) => {
        set((x) => ({ catalog: x.catalog.map((c) => (c.id === id ? { ...c, [key]: v } : c)) }));
        const field = ({ name: 'name', type: 'type', kind: 'billingKind', price: 'unitPrice', vat: 'vatRate' } as const)[key];
        if (key === 'name' && !v.trim()) return;
        saveLater(`product:${id}:${field}`, () => crmApi.updateProduct(id, { [field]: key === 'price' || key === 'vat' ? num(v) : v }));
      },
      removeProduct: (id: string) => {
        set((x) => ({ catalog: x.catalog.filter((k) => k.id !== id) }));
        void save(() => crmApi.deleteProduct(id));
      },
    };
  }, [set, flash, navigate, session]);

  return { s, ...actions };
}

export type Store = ReturnType<typeof useStoreImpl> & { session: Session };
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ data, session, children }: { data: WorkspaceData; session: Session; children: ReactNode }) {
  const store = useStoreImpl(data, session);
  return <StoreContext.Provider value={{ ...store, session }}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}
