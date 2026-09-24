import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, type ApiRole, type ApiTenant, type Channel, clearTenantId, crmApi, type DealInput, type DealLineInput, type ProfileInput, type TaskInput } from '../lib/api';
import { paths } from '../lib/paths';
import { loadWorkspace, mapActivity, mapLeadTask, mapLine, type WorkspaceData } from './remote';
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
import type { Champ, ChannelCode, DealLine, Lead, LogEntry, NewContactDraft, NewProductDraft, Person, Profile, SegKey, Stage, State, TaskState, Workspace } from './types';

type Updater = Partial<State> | ((s: State) => Partial<State>);

/** Who is signed in and which workspace (tenant) is open. */
export interface Session {
  userId: string;
  userName: string;
  email: string;
  tenant: ApiTenant;
  tenants: ApiTenant[];
  switchTenant: (id: string) => void;
  signOut: () => void;
  /** Updates the session after the workspace was renamed (switcher, headings). */
  renameTenant: (name: string) => void;
  /** Updates the session after the user changed their name in the profile. */
  renameUser: (name: string) => void;
}

const ROADMAP_KEY = 'cadence.roadmapItems';

/**
 * Business records (deals with their lines and to-dos, companies, contacts, products, funnels,
 * activity), the workspace settings and your profile come from the API. Features the backend
 * doesn't have yet (documents, some settings tabs) still live only in this browser tab, seeded
 * from the design.
 */
function loadInitial(data: WorkspaceData): State {
  const s: State = { ...initialState(), ...data };
  // The pipeline opens on your default funnel for this workspace.
  const preferred = (Object.keys(data.funnels) as SegKey[]).find((k) => data.funnels[k].id && data.funnels[k].id === data.profile.defaultFunnelId);
  if (preferred) s.segment = s.newLeadType = preferred;
  s.taskLeadId = data.leads[0]?.id ?? '';
  s.contactCompany = data.leads[0]?.id ?? '';
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
/** The API's message, plus the first field problem when validation failed. */
const errText = (err: unknown) => {
  if (!(err instanceof Error)) return String(err);
  const issue = err instanceof ApiError ? (err.body as { issues?: { path?: string; message?: string }[] } | null)?.issues?.[0] : undefined;
  return issue?.message ? `${err.message}: ${issue.path ? issue.path + ' ' : ''}${issue.message}` : err.message;
};
const EMPTY_CONTACT: NewContactDraft = { name: '', role: '', email: '', phone: '', linkedin: '', buyerRole: 'Influencer' };
const DISCOVERY_FIELDS = ['headline', 'need', 'constraint', 'decisionMaker', 'discoveryDate'] as const satisfies readonly (keyof Lead & keyof DealInput)[];
/** Workspace settings as the API names them (the bonus trigger has no backend yet). */
const WORKSPACE_FIELDS: Partial<Record<keyof Workspace, 'name' | 'currency' | 'timezone' | 'fiscalYearStartMonth'>> = {
  name: 'name',
  currency: 'currency',
  timezone: 'timezone',
  fiscalMonth: 'fiscalYearStartMonth',
};
/** Profile fields as the API names them. */
const PROFILE_FIELDS: Partial<Record<keyof Profile, keyof ProfileInput>> = {
  name: 'displayName',
  title: 'jobTitle',
  phone: 'phone',
  language: 'language',
  dateFormat: 'dateFormat',
  startPage: 'startPage',
  defaultFunnelId: 'defaultFunnelId',
  digest: 'dailyDigest',
};

function useStoreImpl(data: WorkspaceData, session: Session) {
  const [s, setState] = useState<State>(() => loadInitial(data));
  const ref = useRef(s);
  ref.current = s;
  const navigate = useNavigate();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const genTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  /** Debounced writes that haven't been sent yet, by field key (see saveLater). */
  const saveTimers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>());
  /** Writes sent but not answered yet; `writeSeq` counts every write started. */
  const inFlight = useRef(0);
  const writeSeq = useRef(0);
  const idleWaiters = useRef<(() => void)[]>([]);
  const reloading = useRef<Promise<void> | null>(null);
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
      timers.forEach((t) => clearTimeout(t.timer));
    };
  }, []);

  const flash = useCallback(
    (msg: string, ms = 2600) => {
      clearTimeout(toastTimer.current);
      set({ toast: msg });
      toastTimer.current = setTimeout(() => set({ toast: '' }), ms);
    },
    [set],
  );

  const actions = useMemo(() => {
    const cur = () => ref.current;
    const mapLead = (id: string, fn: (l: Lead) => Lead) => set((x) => ({ leads: x.leads.map((l) => (l.id === id ? fn(l) : l)) }));

    // ------------------------------------------------------------ persistence
    /*
     * A failed save must not throw away other unsaved typing (CD-19). Reloading replaces the
     * workspace with what the database has, so it only happens once every other edit is stored:
     * `reload` first sends the debounced writes still waiting (flush), waits until no write is in
     * flight, and discards its result (and tries again) if a new write started while it loaded.
     * The failed change itself is then shown as stored (reverted), and the toast names it, so
     * the screen never silently shows a value the database doesn't have.
     */
    const isIdle = () => inFlight.current === 0 && saveTimers.current.size === 0;
    const whenIdle = () => (isIdle() ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.current.push(resolve)));
    const notifyIfIdle = () => {
      if (!isIdle()) return;
      const waiters = idleWaiters.current.splice(0);
      waiters.forEach((resolve) => resolve());
    };
    /** Sends every debounced write now instead of after the typing pause. */
    const flushSaves = () => {
      for (const { timer, run } of [...saveTimers.current.values()]) {
        clearTimeout(timer);
        run();
      }
    };
    /** Drops a debounced write that hasn't been sent (its record is being deleted). */
    const dropSave = (key: string) => {
      const pending = saveTimers.current.get(key);
      if (!pending) return;
      clearTimeout(pending.timer);
      saveTimers.current.delete(key);
      notifyIfIdle();
    };
    /** Re-reads the workspace from the API once all pending edits are saved (see above). */
    const reload = (): Promise<void> => {
      reloading.current ??= (async () => {
        try {
          flushSaves();
          for (let attempt = 0; attempt < 5; attempt++) {
            await whenIdle();
            const seq = writeSeq.current;
            const data = await loadWorkspace();
            if (seq === writeSeq.current && isIdle()) {
              set(data);
              return;
            }
          }
        } catch (err) {
          flash('Could not refresh: ' + errText(err));
        } finally {
          reloading.current = null;
        }
      })();
      return reloading.current;
    };
    /**
     * Runs an API write, then `then` on success. On failure it names what wasn't saved and why,
     * and reloads (after the other pending edits are saved) so the screen matches the database.
     */
    const save = async (write: () => Promise<unknown>, then?: () => unknown, what = 'your change') => {
      inFlight.current++;
      writeSeq.current++;
      let failed: unknown = null;
      try {
        await write();
      } catch (err) {
        failed = err ?? new Error('Unknown error');
      } finally {
        inFlight.current--;
        notifyIfIdle();
      }
      if (failed) {
        flash(`Not saved: ${what} (${errText(failed)}). It was reset to the saved value.`, 7000);
        await reload();
        return;
      }
      try {
        await then?.();
      } catch (err) {
        flash('Saved, but could not refresh: ' + errText(err));
      }
    };
    /** Coalesces typing into one write per field (inputs call their action on every keystroke). */
    const saveLater = (key: string, write: () => Promise<unknown>, what?: string) => {
      clearTimeout(saveTimers.current.get(key)?.timer);
      const run = () => {
        saveTimers.current.delete(key);
        void save(write, undefined, what);
      };
      saveTimers.current.set(key, { timer: setTimeout(run, 600), run });
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
      void save(() => crmApi.moveDeal(leadId, stageId), () => refreshLog(leadId), 'the stage move');
      if (stage && stage.doc === 'Proposal' && AUTO_GENERATE_DOCS) startGeneration(leadId);
      else if (stage) flash('Moved to ' + stage.name + ' · next activity: ' + stage.activity);
    };

    const pushLog = (leadId: string, entry: LogEntry) => {
      set((x) => ({ log: { ...x.log, [leadId]: [entry, ...(x.log[leadId] || [])] } }));
      void save(() => crmApi.logActivity(leadId, { channel: channelOf(entry.channel), title: entry.title, detail: entry.detail || null }), undefined, 'the timeline entry');
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
          }, 'a product line');
      for (const l of prev)
        if (!next.some((y) => y.id === l.id)) {
          dropSave('line:' + l.id);
          void save(() => crmApi.deleteDealLine(l.id), undefined, 'removing a product line');
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
      void save(() => crmApi.linkContact(leadId, contactId), undefined, 'linking ' + p.name);
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
      void save(() => crmApi.unlinkContact(leadId, contactId), undefined, 'unlinking ' + p.name);
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
        if (field && !(field === 'fullName' && !value.trim())) saveLater(`contact:${contactId}:${field}`, () => crmApi.updateContact(contactId, { [field]: value }), `${p.name}'s ${k === 'role' ? 'job title' : k === 'buyerRole' ? 'buyer role' : k}`);
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
      }, `the to-do "${item.label || 'New to-do'}"`);
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
      if (id) saveLater('todo-label:' + id, () => crmApi.updateTask(id, { label: val.trim() }), 'the to-do name');
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
        dropSave('todo-label:' + id);
        void save(() => crmApi.deleteTask(id), undefined, 'removing the to-do');
      }
    };

    // ------------------------------------------------------------ tasks from the "New task" dialog
    /** Saves a new task on a lead; resolves false (after showing why) when it wasn't saved. */
    const addLeadTask = async (draft: { leadId: string; stageId: string; title: string; channel: ChannelCode; due: string; ownerId: string; note: string }): Promise<boolean> => {
      try {
        const row = await crmApi.createTask(draft.leadId, {
          stageId: draft.stageId,
          label: draft.title.trim(),
          blocksAdvance: false,
          channel: draft.channel,
          dueDate: draft.due || null,
          assigneeUserId: draft.ownerId || null,
          note: draft.note.trim() || null,
        });
        set((x) => ({ leadTasks: [...x.leadTasks, mapLeadTask(row)] }));
        // The backend logged "Task added" on the timeline; refresh it if it is loaded.
        if (logRequested.current.has(draft.leadId)) void refreshLog(draft.leadId).catch(() => undefined);
        return true;
      } catch (err) {
        flash('Not saved: ' + errText(err));
        return false;
      }
    };
    /** Ticks or unticks a task; ticking also logs it on the lead's timeline. */
    const toggleLeadTask = (id: string) => {
      const t = cur().leadTasks.find((x) => x.id === id);
      if (!t) return;
      const done = !t.done;
      const date = todayLabel();
      set((x) => ({ leadTasks: x.leadTasks.map((y) => (y.id === id ? { ...y, done, at: done ? date : undefined, by: done ? session.userName.split(' ')[0] : undefined } : y)) }));
      void save(() => crmApi.updateTask(id, { done }), undefined, `the task "${t.title}"`);
      if (done) {
        pushLog(t.leadId, { date, channel: t.channel, title: t.title, detail: t.note || 'Task completed.' });
        flash('Marked done · added to the activity timeline');
      }
    };
    /** Deletes a task; the backend logs "Task removed" on the timeline, so refresh it if loaded. */
    const removeLeadTask = (id: string) => {
      const t = cur().leadTasks.find((x) => x.id === id);
      set((x) => ({ leadTasks: x.leadTasks.filter((y) => y.id !== id) }));
      void save(
        () => crmApi.deleteTask(id),
        () => {
          if (t && logRequested.current.has(t.leadId)) return refreshLog(t.leadId).catch(() => undefined);
        },
      );
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
    /** Companies are identified by id (names aren't unique), so renaming one keeps its route. */
    const setCompanyField = (companyId: string, key: 'name' | 'industry' | 'hq' | 'size' | 'source', v: string) => {
      const field = key === 'size' ? 'teamSize' : key;
      if (!(key === 'name' && !v.trim())) saveLater(`company:${companyId}:${field}`, () => crmApi.updateCompany(companyId, { [field]: v }), `the company ${key === 'hq' ? 'HQ' : key === 'size' ? 'team size' : key}`);
      set((x) => ({
        leads: x.leads.map((l) => (l.companyId === companyId ? { ...l, ...(key === 'name' ? { company: v } : { [key]: v }) } : l)),
        extraCompanies: x.extraCompanies.map((c) => (c.id === companyId ? { ...c, [key]: v } : c)),
        extraPeople: key === 'name' ? x.extraPeople.map((p) => (p.companyId === companyId ? { ...p, company: v } : p)) : x.extraPeople,
      }));
    };

    /**
     * Deal fields save to the deal; industry, HQ and team size belong to the company. `companyId`
     * moves the deal to another company, `ownerId` hands it to another workspace member.
     */
    const patchLead = (id: string, patch: Partial<Lead>) => {
      const lead = leadById(cur(), id);
      if (!lead) return;
      const { industry, hq, size, ...dealPatch } = patch;
      const companyId = lead.companyId;
      if ((industry ?? hq ?? size) !== undefined && !companyId) {
        flash('Pick a company first');
        return;
      }
      if (industry !== undefined && companyId) setCompanyField(companyId, 'industry', industry);
      if (hq !== undefined && companyId) setCompanyField(companyId, 'hq', hq);
      if (size !== undefined && companyId) setCompanyField(companyId, 'size', size);
      const { title, closeDate, source, ownerId } = dealPatch;
      if (title !== undefined && title.trim()) saveLater('title:' + id, () => crmApi.updateDeal(id, { title: title.trim() }), 'the deal title');
      if (closeDate !== undefined) saveLater('close:' + id, () => crmApi.updateDeal(id, { closeDate: closeDate || null }), 'the closing date');
      if (source !== undefined) saveLater('source:' + id, () => crmApi.updateDeal(id, { source }), 'the deal source');
      // Discovery notes (merged into the proposal). Empty text clears the field.
      for (const key of DISCOVERY_FIELDS) {
        const v = dealPatch[key];
        if (v !== undefined) saveLater(`${key}:${id}`, () => crmApi.updateDeal(id, { [key]: key === 'discoveryDate' ? v || null : v }), 'the discovery notes');
      }
      if (dealPatch.companyId !== undefined && dealPatch.companyId !== companyId) {
        const target = dealPatch.companyId;
        const rec = target ? companyRecords(cur()).find((c) => c.id === target) : undefined;
        if (target && !rec) return;
        dealPatch.company = rec?.name ?? 'No company';
        void save(() => crmApi.updateDeal(id, { companyId: target }), reload, 'the company of this deal');
      }
      if (ownerId !== undefined && ownerId !== lead.ownerId) {
        dealPatch.owner = cur().team.find((m) => m.status === 'Active' && m.id === ownerId)?.name;
        void save(() => crmApi.updateDeal(id, { ownerUserId: ownerId }), undefined, 'the deal owner');
      }
      mapLead(id, (l) => ({ ...l, ...dealPatch }));
    };

    // ------------------------------------------------------------ deleting (owners and admins)
    const canDelete = session.tenant.role === 'owner' || session.tenant.role === 'admin';
    const canEditWorkspace = canDelete;
    /** Drops pending debounced writes for a record that is about to be deleted. */
    const cancelSaves = (...ids: string[]) => {
      for (const key of [...saveTimers.current.keys()]) if (ids.some((id) => key.includes(id))) dropSave(key);
    };
    /** Deletes a record, then opens the list screen and reloads the workspace. */
    const remove = async (write: () => Promise<unknown>, list: string, done: string) => {
      try {
        await write();
      } catch (err) {
        flash('Not deleted: ' + errText(err));
        return;
      }
      navigate(list, { replace: true });
      await reload();
      flash(done);
    };
    const deleteDeal = async (id: string) => {
      const lead = leadById(cur(), id);
      if (!lead) return;
      cancelSaves(id, ...(cur().dealLines[id] || []).map((l) => l.id));
      await remove(() => crmApi.deleteDeal(id), paths.pipeline, (lead.title || lead.company) + ' deleted');
    };
    const deleteCompany = async (id: string) => {
      const rec = companyRecords(cur()).find((c) => c.id === id);
      if (!rec) return;
      cancelSaves(id);
      await remove(() => crmApi.deleteCompany(id), paths.companies, rec.name + ' deleted');
    };
    const deleteContact = async (personId: string) => {
      const p = personById(cur(), personId);
      const contactId = p?.contactId;
      if (!p || !contactId) return;
      cancelSaves(contactId);
      await remove(() => crmApi.deleteContact(contactId), paths.contacts, p.name + ' deleted');
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
        void save(() => crmApi.updateDeal(id, { funnelId }), () => refreshLog(id), 'the funnel');
        flash('Funnel reassigned · lead moved to the first stage');
      },
      openLead: (id: string) => navigate(paths.lead(id)),
      openContact: (id: string) => navigate(paths.contact(id)),
      openCompany: (id: string) => navigate(paths.company(id)),
      openGenerated: () => {
        const x = cur();
        if (x.genStep < 4 || !x.genLead) return;
        const leadId = x.genLead;
        mapLead(leadId, (l) => ({ ...l, docs: [{ name: 'Proposal — ' + (l.headline || l.title || l.company), state: 'draft', meta: 'v1 · generated just now · not sent' }, ...(l.docs || [])] }));
        set({ genOpen: false, docOpen: true, docLeadId: leadId, sent: false });
      },
      openDoc: (leadId: string) => set({ docOpen: true, docLeadId: leadId, sent: false }),
      sendDoc: () => {
        set({ sent: true });
        // Nothing is emailed and no follow-up task is created yet: say so instead of pretending.
        flash('Marked as sent for this session only · nothing was emailed and no task was created');
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
        }, 'the fit score');
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
      addLeadTask,
      toggleLeadTask,
      removeLeadTask,
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
        let created: { id: string } | undefined;
        // Reload after the write (in `then`): reload waits for writes in flight, this one included.
        void save(
          async () => void (created = await crmApi.createCompany({ name })),
          async () => {
            await reload();
            if (created) navigate(paths.company(created.id));
          },
          'the new company',
        );
      },
      canDelete,
      deleteDeal,
      deleteCompany,
      deleteContact,

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

      // ---------------------------------------------------------- team
      /** Creates an invitation and returns the link to share (shown once; only its hash is stored). */
      inviteMember: async (email: string, role: 'admin' | 'member'): Promise<string | null> => {
        try {
          const { token } = await crmApi.invite(email, role);
          await reload();
          return `${window.location.origin}/invite/${token}`;
        } catch (err) {
          flash('Not invited: ' + errText(err));
          return null;
        }
      },
      revokeInvitation: (id: string) => {
        set((x) => ({ team: x.team.filter((m) => m.id !== id) }));
        void save(() => crmApi.revokeInvitation(id), undefined, 'withdrawing the invitation');
      },
      setMemberRole: (userId: string, role: ApiRole) => {
        void save(() => crmApi.updateMember(userId, role), reload, 'the role');
      },
      /** Removes a member; removing yourself leaves the workspace. */
      removeMember: (userId: string) => {
        const leaving = userId === session.userId;
        void save(
          () => crmApi.removeMember(userId),
          () => {
            if (!leaving) return reload();
            clearTenantId();
            window.location.assign('/');
          },
        );
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
        saveLater(`product:${id}:${field}`, () => crmApi.updateProduct(id, { [field]: key === 'price' || key === 'vat' ? num(v) : v }), `the product ${key === 'kind' ? 'billing' : key === 'vat' ? 'VAT' : key}`);
      },
      removeProduct: (id: string) => {
        set((x) => ({ catalog: x.catalog.filter((k) => k.id !== id) }));
        void save(() => crmApi.deleteProduct(id), undefined, 'removing the product');
      },

      // ---------------------------------------------------------- settings
      /** Owners and admins change the workspace settings; members see them read-only. */
      canEditWorkspace,
      /** Edits workspace settings and saves them (one write per field after a pause). The bonus trigger is browser-only. */
      setWorkspace: (patch: Partial<Workspace>) => {
        set((x) => ({ workspace: { ...x.workspace, ...patch } }));
        for (const [k, v] of Object.entries(patch)) {
          const field = WORKSPACE_FIELDS[k as keyof Workspace];
          if (!field || !canEditWorkspace) continue;
          const value = typeof v === 'string' ? v.trim() : v;
          if (field === 'name' && !value) continue;
          saveLater('workspace:' + field, async () => {
            const ws = await crmApi.updateWorkspace({ [field]: value });
            if (field === 'name') session.renameTenant(ws.name);
          });
        }
      },
      /** Edits your own profile and saves it (one write per field after a pause). */
      patchProfile: (patch: Partial<Profile>) => {
        set((x) => ({
          profile: { ...x.profile, ...patch },
          team: patch.name?.trim() ? x.team.map((m) => (m.status === 'Active' && m.id === session.userId ? { ...m, name: patch.name!.trim() } : m)) : x.team,
        }));
        for (const [k, v] of Object.entries(patch)) {
          const field = PROFILE_FIELDS[k as keyof Profile];
          if (!field) continue;
          const value = field === 'defaultFunnelId' ? v || null : typeof v === 'string' ? v.trim() : v;
          if (field === 'displayName' && !value) continue;
          saveLater('profile:' + field, async () => {
            const p = await crmApi.updateProfile({ [field]: value });
            if (field === 'displayName' && p.displayName) session.renameUser(p.displayName);
          });
        }
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
