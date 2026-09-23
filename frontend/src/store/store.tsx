import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { paths } from '../lib/paths';
import { AUTO_GENERATE_DOCS, GATE_STAGE_ADVANCE, INDUSTRIES, initialState, mkStage, OWNERS, SOURCES, TEAM_SIZES } from './seed';
import {
  champFor,
  closeIsoOf,
  defaultStart,
  initialsOf,
  itemById,
  leadById,
  linesOf,
  money,
  netOf,
  personById,
  stageDone,
  stageOf,
  stagesFor,
  taskKey,
  taskOf,
  todayLabel,
} from './selectors';
import type { Champ, DealLine, Lead, LogEntry, Person, SegKey, Stage, State, TaskState } from './types';

type Updater = Partial<State> | ((s: State) => Partial<State>);

const ROADMAP_KEY = 'cadence.roadmapItems';

function loadInitial(): State {
  const s = initialState();
  try {
    const saved = localStorage.getItem(ROADMAP_KEY);
    const items: unknown = saved ? JSON.parse(saved) : null;
    if (Array.isArray(items)) s.roadmapItems = items as State['roadmapItems'];
  } catch {
    // ignore unreadable storage
  }
  return s;
}

function useStoreImpl() {
  const [s, setState] = useState<State>(loadInitial);
  const ref = useRef(s);
  ref.current = s;
  const navigate = useNavigate();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const genTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  const set = useCallback((u: Updater) => setState((prev) => ({ ...prev, ...(typeof u === 'function' ? u(prev) : u) })), []);

  useEffect(() => {
    try {
      localStorage.setItem(ROADMAP_KEY, JSON.stringify(s.roadmapItems));
    } catch {
      // ignore
    }
  }, [s.roadmapItems]);

  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
      clearInterval(genTimer.current);
    },
    [],
  );

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
      if (!lead) return;
      const stage = stagesFor(cur(), lead.segment).find((st) => st.id === stageId);
      mapLead(leadId, (l) => ({ ...l, stage: stageId, stall: 0 }));
      if (stage && stage.doc === 'Proposal' && AUTO_GENERATE_DOCS) startGeneration(leadId);
      else if (stage) flash('Moved to ' + stage.name + ' · next activity: ' + stage.activity);
    };

    const pushLog = (leadId: string, entry: LogEntry) => set((x) => ({ log: { ...x.log, [leadId]: [entry, ...(x.log[leadId] || [])] } }));

    // ------------------------------------------------------------ deal lines
    const updateLines = (leadId: string, fn: (lines: DealLine[]) => DealLine[]) =>
      set((x) => {
        const lead = leadById(x, leadId);
        const current = x.dealLines[leadId] || linesOf(x, lead);
        const next = fn(current.map((l) => ({ ...l })));
        return {
          dealLines: { ...x.dealLines, [leadId]: next },
          leads: x.leads.map((l) => (l.id === leadId ? { ...l, value: money(netOf(next)) } : l)),
        };
      });

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
      const it = cur().catalog[0]!;
      updateLines(lead.id, (ls) =>
        ls.concat([
          {
            id: 'dl' + Date.now(),
            itemId: it.id,
            qty: 1,
            price: it.price,
            vat: it.vat,
            schedule: 'Full amount on one date',
            start: defaultStart(lead),
            months: 6,
            milestones: [
              { label: 'On signature', pct: 40 },
              { label: 'On delivery', pct: 60 },
            ],
          },
        ]),
      );
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
      set((x) => ({ links: { ...x.links, [leadId]: [...(x.links[leadId] || []), personId] } }));
      const p = personById(cur(), personId);
      flash((p ? p.name : 'Contact') + ' linked to this lead');
    };
    const unlinkPerson = (leadId: string, personId: string) =>
      set((x) => ({ links: { ...x.links, [leadId]: (x.links[leadId] || []).filter((i) => i !== personId) } }));

    const patchPerson = (id: string, patch: Partial<Person>) => {
      const p = personById(cur(), id);
      if (!p) return;
      const withInitials = patch.name !== undefined ? { ...patch, initials: initialsOf(patch.name) } : patch;
      if (p.primary) {
        const map: Record<string, string> = { name: 'contact', role: 'role', email: 'email', phone: 'phone', buyerRole: 'buyerRole', initials: 'initials' };
        const lp: Record<string, unknown> = {};
        Object.entries(withInitials).forEach(([k, v]) => (lp[map[k] || k] = v));
        mapLead(p.leadId, (l) => ({ ...l, ...lp }));
      } else {
        set((x) => ({ extraPeople: x.extraPeople.map((y) => (y.id === id ? { ...y, ...withInitials } : y)) }));
      }
    };

    /** Moves a contact to another company's lead; a moved primary contact is replaced. */
    const movePerson = (id: string, newLeadId: string) => {
      const p = personById(cur(), id);
      if (!p || newLeadId === p.leadId) return;
      if (p.primary) {
        const promoted = cur().extraPeople.find((y) => y.leadId === p.leadId);
        const newId = 'p' + Date.now();
        set((x) => ({
          leads: x.leads.map((l) =>
            l.id === p.leadId
              ? {
                  ...l,
                  ...(promoted
                    ? { contact: promoted.name, role: promoted.role, email: promoted.email, phone: promoted.phone, buyerRole: promoted.buyerRole, initials: promoted.initials }
                    : { contact: 'No primary contact', role: '—', email: '—', phone: '—', initials: '—' }),
                }
              : l,
          ),
          extraPeople: x.extraPeople
            .filter((y) => !promoted || y.id !== promoted.id)
            .concat([{ id: newId, leadId: newLeadId, primary: false, name: p.name, role: p.role, email: p.email, phone: p.phone, buyerRole: p.buyerRole, initials: p.initials }]),
        }));
        navigate(paths.contact(newId), { replace: true });
      } else {
        set((x) => ({ extraPeople: x.extraPeople.map((y) => (y.id === id ? { ...y, leadId: newLeadId } : y)) }));
      }
      flash('Contact moved to ' + (leadById(cur(), newLeadId)?.company || 'another company'));
    };

    // ------------------------------------------------------------ stage to-dos
    const patchTask = (leadId: string, stageId: string, idx: number, patch: TaskState) =>
      set((x) => {
        const key = taskKey(leadId, stageId, idx);
        return { tasks: { ...x.tasks, [key]: { ...x.tasks[key], ...patch } } };
      });

    const completeTask = (lead: Lead, stageId: string, idx: number, label: string) => {
      const existing = taskOf(cur(), lead.id, stageId, idx);
      if (existing.done) {
        patchTask(lead.id, stageId, idx, { done: false });
        return;
      }
      const date = todayLabel();
      patchTask(lead.id, stageId, idx, { done: true, at: date, by: 'Mila' });
      const stage = stagesFor(cur(), lead.segment).find((x) => x.id === stageId);
      pushLog(lead.id, {
        date,
        channel: stage ? stage.channel : 'RS',
        title: label,
        detail: (existing.note || 'Completed against the ' + (stage ? stage.name : '') + ' playbook.') + (existing.outcome ? ' · ' + existing.outcome : ''),
      });
      flash('Marked done · added to the activity timeline');
    };

    const addTodo = (leadId: string, stageId: string) =>
      set((x) => {
        const key = leadId + '::' + stageId;
        return { extraTodos: { ...x.extraTodos, [key]: [...(x.extraTodos[key] || []), ''] } };
      });
    const renameExtra = (leadId: string, stageId: string, extraIdx: number, val: string) =>
      set((x) => {
        const key = leadId + '::' + stageId;
        const list = [...(x.extraTodos[key] || [])];
        list[extraIdx] = val;
        return { extraTodos: { ...x.extraTodos, [key]: list } };
      });
    const removeExtra = (leadId: string, stageId: string, extraIdx: number, taskIdx: number) =>
      set((x) => {
        const key = leadId + '::' + stageId;
        const list = [...(x.extraTodos[key] || [])];
        list.splice(extraIdx, 1);
        const tasks = { ...x.tasks };
        delete tasks[taskKey(leadId, stageId, taskIdx)];
        return { extraTodos: { ...x.extraTodos, [key]: list }, tasks };
      });

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
    const editFunnel = (fn: (stages: Stage[]) => void) =>
      set((x) => {
        const funnels = JSON.parse(JSON.stringify(x.funnels)) as State['funnels'];
        fn(funnels[x.segment].stages);
        return { funnels };
      });

    // ------------------------------------------------------------ companies
    const setCompanyField = (name: string, key: 'name' | 'industry' | 'hq' | 'size' | 'source', v: string) => {
      set((x) => ({
        leads: x.leads.map((l) => (l.company === name ? { ...l, ...(key === 'name' ? { company: v } : { [key]: v }) } : l)),
        extraCompanies: x.extraCompanies.map((c) => (c.name === name ? { ...c, [key]: v } : c)),
      }));
      if (key === 'name') navigate(paths.company(v), { replace: true });
    };

    return {
      set,
      flash,
      navigate,
      moveLead,
      startGeneration,
      pushLog,
      patchLead: (id: string, patch: Partial<Lead>) => mapLead(id, (l) => ({ ...l, ...patch })),
      patchLeadSegment: (id: string, seg: SegKey) => {
        mapLead(id, (l) => ({ ...l, segment: seg, stage: stagesFor(cur(), seg)[0]!.id }));
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
      setChamp: (leadId: string, key: keyof Champ, v: number) =>
        set((x) => {
          const lead = leadById(x, leadId)!;
          const base = { ...(x.champ[leadId] || champFor(x, lead)), [key]: v };
          const total = base.C + base.H + base.M + base.P;
          return { champ: { ...x.champ, [leadId]: base }, leads: x.leads.map((l) => (l.id === leadId ? { ...l, score: total } : l)) };
        }),
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
      addStage: () => editFunnel((st) => st.splice(st.length - 1, 0, mkStage('s' + Date.now(), 'New stage', 'Personalized email', 'EM', 'None', ['Define the gate']))),
      editStage: (idx: number, key: 'name' | 'activity' | 'channel' | 'doc', val: string) => editFunnel((st) => void ((st[idx] as unknown as Record<string, string>)[key] = val)),
      editProb: (idx: number, raw: string) =>
        editFunnel((st) => void (st[idx]!.prob = raw === '' ? '' : Math.max(0, Math.min(100, Math.round(Number(raw) || 0))))),
      removeStage: (idx: number) => editFunnel((st) => void st.splice(idx, 1)),
      addGate: (idx: number) => editFunnel((st) => void st[idx]!.checklist.push('New to-do')),
      renameGate: (idx: number, gi: number, val: string) => editFunnel((st) => void (st[idx]!.checklist[gi] = val)),
      removeGate: (idx: number, gi: number) => editFunnel((st) => void st[idx]!.checklist.splice(gi, 1)),
      setCompanyField,
      addCompany: () => {
        const name = 'New company';
        set((x) => ({ extraCompanies: [...x.extraCompanies, { name, industry: INDUSTRIES[0]!, hq: '', size: TEAM_SIZES[0]!, source: SOURCES[0]!, owner: OWNERS[0]! }] }));
        navigate(paths.company(name));
      },
    };
  }, [set, flash, navigate]);

  return { s, ...actions };
}

export type Store = ReturnType<typeof useStoreImpl>;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const store = useStoreImpl();
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}
