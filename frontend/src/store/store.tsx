import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ApiCompanyDetails, type ApiConflict, type ApiDeal, ApiError, type ApiRole, type ApiTenant, type Channel, clearTenantId, CLIENT_ID, type CompanyInput, type ContactInput, crmApi, type CustomFieldEntity, type CustomFieldPatch, type CustomFieldType, type CustomValue, type DealInput, type DealProductsInput, type HistoryEntity, type LostReason, type ProductInput, type ProfileInput, type TaskInput, type VisitPlanInput, type WorkspaceInput, type WorkspaceTerms } from '../lib/api';
import { paths } from '../lib/paths';
import { type DealDoc, docBusy, docsApi, type DocTemplate, type DocType, hasLiveProposal, type PlaceholderReference, type UploadType } from './documents';
import { employeeCardActions } from './employeeCard';
import { connectLive, type LiveEvent } from './live';
import { meetingActions, meetingKey, newMeetingRuntime, upcomingQuery } from './meetings';
import { newPeopleRuntime, PEOPLE_HINTS, peopleActions } from './people';
import { approvalOf, type Changed, loadWorkspace, mapActivity, mapBonusRules, mapCustomField, mapLeadTask, mapLine, mapProduct, mapStageChange, mapTeam, type Part, type WorkspaceData } from './remote';
import { AUTO_GENERATE_DOCS, CHANNELS, initialState, SYSTEM_CHANNEL } from './seed';
import {
  advanceBlockers,
  allPeople,
  COMPANY_STATUS_LABELS,
  companyIdOfPerson,
  companyRecords,
  curOf,
  customFieldsOf,
  initialsOf,
  leadById,
  memberName,
  momentLabel,
  money,
  num,
  personById,
  skipBlocker,
  stageOf,
  stagesFor,
  taskKey,
  taskOf,
  todayLabel,
  todoItemsFor,
  wonBlocker,
} from './selectors';
import { dealTotals } from './dealMath';
import { sortPlans, type VisitPlan } from './visitPlans';
import { CONTACT_EXTRA_KEYS } from './types';
import type { BillingFrequency, BonusRule, ChannelCode, CompanyStatus, ContactExtra, SaleType, CustomFieldDef, DealDiscount, DealLine, Installment, Lead, LeadTask, LogEntry, NewContactDraft, Person, Profile, SegKey, Stage, State, TaskState, TaxMode, Workspace } from './types';

/** What the product dialog edits (CD-83); numbers as typed. */
export interface ProductDraft {
  name: string;
  description: string;
  unit: string;
  price: string;
  qty: string;
  vat: string;
  frequency: BillingFrequency;
  cycles: number | null;
}
/** What the deal's "Products" dialog saves at once (CD-83). */
export interface DealProductsDraft {
  currency: string;
  taxMode: TaxMode;
  lines: DealLine[];
  discounts: DealDiscount[];
  installments: Installment[];
}

type Updater = Partial<State> | ((s: State) => Partial<State>);

/** Who is signed in and which workspace (tenant) is open. */
export interface Session {
  userId: string;
  userName: string;
  email: string;
  tenant: ApiTenant;
  tenants: ApiTenant[];
  switchTenant: (id: string) => void;
  /** Creates a workspace (you become its owner) and opens it. */
  createTenant: (name: string) => Promise<void>;
  signOut: () => void;
  /** Updates the session after the workspace was renamed (switcher, headings). */
  renameTenant: (name: string) => void;
  /** Updates the session after the user changed their name in the profile. */
  renameUser: (name: string) => void;
}

/**
 * Business records (deals with their lines and to-dos, companies, contacts, products, funnels,
 * activity), the workspace settings and your profile come from the API. Features the backend
 * doesn't have yet (some settings tabs) still live only in this browser tab, seeded
 * from the design.
 */
function loadInitial(data: WorkspaceData): State {
  const s: State = { ...initialState(), ...data };
  // The pipeline opens on your default funnel for this workspace, else the first one.
  s.segment = s.newLeadType = data.funnels[data.profile.defaultFunnelId] ? data.profile.defaultFunnelId : Object.keys(data.funnels)[0]!;
  s.taskLeadId = data.leads[0]?.id ?? '';
  try {
    // The Roadmap page was removed (CD-71); drop what it kept in this browser.
    localStorage.removeItem('cadence.roadmapItems');
  } catch {
    // ignore unavailable storage
  }
  return s;
}

const channelOf = (c: string): Channel => ((CHANNELS as readonly string[]).includes(c) ? (c as Channel) : 'NT');
/** The company fields edited on its page (CD-80, CD-357). */
export type CompanyFieldKey = 'name' | 'industry' | 'hq' | 'size' | 'source' | 'domain' | 'notes' | 'pib' | 'mb' | 'address' | 'city' | 'postalCode' | 'activityCode' | 'ownershipType';
const COMPANY_FIELD_LABELS: Partial<Record<CompanyFieldKey, string>> = { hq: 'HQ', size: 'team size', pib: 'PIB', mb: 'MB', address: 'street address', postalCode: 'postal code', activityCode: 'activity code', ownershipType: 'ownership' };

/** The API's message, plus the first field problem when validation failed. */
const errText = (err: unknown) => {
  if (!(err instanceof Error)) return String(err);
  const issue = err instanceof ApiError ? (err.body as { issues?: { path?: string; message?: string }[] } | null)?.issues?.[0] : undefined;
  return issue?.message ? `${err.message}: ${issue.path ? issue.path + ' ' : ''}${issue.message}` : err.message;
};
/** A typed value as the API takes it: numbers as numbers, '' as null (clears the field). */
function customValueForApi(type: CustomFieldType, v: CustomValue | null): CustomValue | null {
  if (v === null || v === '') return null;
  if (type === 'number' && typeof v === 'string') {
    const n = Number(v.trim().replace(',', '.'));
    return v.trim() === '' ? null : Number.isFinite(n) ? n : v;
  }
  return v;
}
/**
 * A 409 from an edit that someone else's change got to first (CD-20): the API's message ("Ana
 * changed this deal while you were editing. Your change to the title wasn't saved.") and the
 * value the record has now.
 */
const conflictText = (err: unknown): string | null => {
  const body = err instanceof ApiError && err.status === 409 ? (err.body as Partial<ApiConflict> | null) : null;
  if (!body?.conflicts?.length || !body.message) return null;
  const shown = (c: ApiConflict['conflicts'][number]) => {
    // A list (a meeting's next steps) by its size; long text (minutes) shortened.
    if (Array.isArray(c.value)) return c.value.length === 1 ? '1 item' : `${c.value.length} items`;
    const v = c.label ?? (c.value === null || c.value === undefined || c.value === '' ? 'empty' : String(c.value));
    return v === 'empty' ? 'empty' : `“${v.length > 80 ? v.slice(0, 78) + '…' : v}”`;
  };
  const now = body.conflicts.length === 1 ? `It now says ${shown(body.conflicts[0]!)}.` : `It now says ${body.conflicts.map(shown).join(', ')}.`;
  return `${body.message} ${now}`;
};
/** Which lists a live change hint means re-reading (see loadWorkspace). */
const PARTS_OF: Record<string, Part[]> = {
  // The getting-started checklist (CD-68, steps from CD-115) ticks itself from these records.
  deal: ['deals', 'onboarding'],
  deal_contact: ['deals'],
  deal_line: ['lines', 'deals'],
  task: ['tasks'],
  company: ['companies', 'onboarding'],
  contact: ['contacts', 'onboarding'],
  product: ['products', 'onboarding'],
  funnel: ['funnels', 'onboarding'],
  activity: [],
  // Meetings (CD-130) aren't part of the workspace load: the meeting slice re-reads them.
  meeting: [],
  visit_plan: ['visitPlans'],
  // People (milestone 13) aren't part of the workspace load: the people slice re-reads them. Reporting
  // lines and roles also decide whose visit plans a manager sees (CD-142).
  employee: ['visitScope', 'visitPlans'],
  employee_role: ['visitScope'],
  department: [],
  team: [],
  // Projects (milestone 14) aren't part of the workspace load: screens re-read them (store/projects.ts).
  project_type: [],
  project: [],
  // Renamed projects or tasks (CD-143): the workspace settings carry the names.
  workspace: ['workspace'],
  // Time off (CD-163) isn't part of the workspace load: the screens showing it read it again (timeOffRev).
  timeoff: [],
  timeoff_policy: [],
  timeoff_reason: [],
  // Holidays (CD-153) aren't part of the workspace load either: the Timesheet and the request form read them again.
  holiday: [],
};
/**
 * Which rows of each list a change hint names (CD-98), so a live update re-reads just those: by id,
 * or by deal for lines and to-dos. A list the hint affects but doesn't name rows for (funnels,
 * the checklist) or a hint without ids (over 50 rows changed) is read whole.
 */
function rowsOf(e: LiveEvent): Partial<Record<Part, readonly string[] | null>> {
  const ids = e.ids ?? null;
  const deals = e.dealIds ?? null;
  switch (e.type) {
    case 'deal':
      return { deals: ids };
    case 'deal_contact':
      return { deals };
    case 'deal_line':
      return { lines: deals, deals };
    case 'task':
      return { tasks: deals };
    case 'company':
      return { companies: ids };
    case 'contact':
      return { contacts: ids };
    case 'product':
      return { products: ids };
    case 'visit_plan':
      return { visitPlans: ids };
    default:
      return {};
  }
}
const ALL_PARTS: Part[] = ['funnels', 'companies', 'contacts', 'deals', 'products', 'lines', 'tasks', 'team', 'customFields', 'bonus', 'onboarding', 'visitPlans', 'visitScope'];
/** A contact with none of the CD-361 details filled in. */
const EMPTY_EXTRA: ContactExtra = { orgUnit: '', source: '', influence: '', birthday: '', spouseName: '', children: '', pets: '' };
const EMPTY_CONTACT: NewContactDraft = { name: '', role: '', email: '', phone: '', linkedin: '', buyerRole: '', notes: '' };
const DISCOVERY_FIELDS = ['headline', 'need', 'constraint', 'decisionMaker', 'discoveryDate'] as const satisfies readonly (keyof Lead & keyof DealInput)[];
/** Qualification text (CD-362), saved as you type like the discovery notes. */
const QUALIFICATION_TEXT = ['pain', 'painSolution', 'qualificationOther'] as const satisfies readonly (keyof Lead & keyof DealInput)[];
/** Workspace settings as the API names them. */
const WORKSPACE_FIELDS: Partial<Record<keyof Workspace, keyof WorkspaceInput>> = {
  name: 'name',
  currency: 'currency',
  timezone: 'timezone',
  fiscalMonth: 'fiscalYearStartMonth',
  customerEmailLanguage: 'customerEmailLanguage',
  employeeDefaultWeeklyHours: 'employeeDefaultWeeklyHours',
  employeeNumberRequired: 'employeeNumberRequired',
  employeeSelfEditBank: 'employeeSelfEditBank',
  ceoEmployeeId: 'ceoEmployeeId',
  autoCreateProjects: 'autoCreateProjects',
  hourLimitMode: 'hourLimitMode',
  modules: 'modules',
  timesheet: 'timesheet',
  country: 'country',
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
  dealAssigned: 'notifyDealAssigned',
  meetingInvites: 'notifyMeetingInvites',
  visitPlans: 'notifyVisitPlans',
  orgChanges: 'notifyOrgChanges',
  taskAssigned: 'notifyTaskAssigned',
  timeOffBalance: 'notifyTimeoffBalance',
  timeOffApprovals: 'notifyTimeoffApprovals',
  sickLeaveNotices: 'notifySickLeave',
  hourLimits: 'notifyHourLimits',
  proposalApprovals: 'notifyProposalApprovals',
};

function useStoreImpl(data: WorkspaceData, session: Session) {
  const [s, setState] = useState<State>(() => loadInitial(data));
  const ref = useRef(s);
  ref.current = s;
  const navigate = useNavigate();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Documents being generated that the store follows (CD-13), by id; and deals whose documents were loaded. */
  const docPolls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const docsRequested = useRef(new Set<string>());
  const placeholderRef = useRef<Promise<PlaceholderReference> | null>(null);
  /** Debounced writes that haven't been sent yet, by field key (see saveLater). */
  const saveTimers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>());
  /** Writes sent but not answered yet; `writeSeq` counts every write started. */
  const inFlight = useRef(0);
  const writeSeq = useRef(0);
  const idleWaiters = useRef<(() => void)[]>([]);
  const reloading = useRef<Promise<void> | null>(null);
  const logRequested = useRef(new Set<string>());
  const pendingTasks = useRef(new Map<string, TaskInput>());
  /** Live updates (CD-20): lists to re-read and deals whose timeline to re-read, gathered over a short pause. */
  // rows: per list, the rows to re-read (CD-98); null = the whole list.
  /** The meeting slice's bookkeeping (CD-130). */
  const meetingRt = useRef(newMeetingRuntime());
  /** The people slice's bookkeeping (milestone 13). */
  const peopleRt = useRef(newPeopleRuntime());
  const livePending = useRef({ parts: new Set<Part>(), rows: new Map<Part, Set<string> | null>(), logs: new Set<string>(), touched: new Set<string>(), timer: undefined as ReturnType<typeof setTimeout> | undefined, running: false, lastFull: 0 });

  const set = useCallback((u: Updater) => setState((prev) => ({ ...prev, ...(typeof u === 'function' ? u(prev) : u) })), []);

  useEffect(() => {
    const timers = saveTimers.current;
    const polls = docPolls.current;
    return () => {
      clearTimeout(toastTimer.current);
      polls.forEach((t) => clearTimeout(t));
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
    /** Re-reads the getting-started checklist (owners and admins) after a change no live hint covers, e.g. templates. */
    const refreshChecklist = () => {
      if (!cur().onboarding) return;
      crmApi.onboarding().then(
        (onboarding) => set({ onboarding }),
        () => undefined, // the checklist just stays as it was
      );
    };

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
    /** Shows a freshly loaded workspace; a funnel that was deleted can't stay open. */
    const applyData = (data: WorkspaceData, touched: Iterable<string> = []) =>
      set((x) => {
        const first = Object.keys(data.funnels)[0]!;
        const valid = (id: string) => (data.funnels[id] ? id : first);
        // Generated documents only live in this tab so far: keep them on their deal.
        const docs = new Map(x.leads.filter((l) => l.docs?.length).map((l) => [l.id, l.docs]));
        const leads = docs.size ? data.leads.map((l) => (docs.has(l.id) ? { ...l, docs: docs.get(l.id) } : l)) : data.leads;
        const now = Date.now();
        const changedAt = { ...x.changedAt };
        for (const id of touched) changedAt[id] = now;
        return {
          ...data,
          leads,
          changedAt,
          segment: valid(x.segment),
          newLeadType: valid(x.newLeadType),
        };
      });
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
              applyData(data);
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
        flash(conflictText(failed) ?? `Not saved: ${what} (${errText(failed)}). It was reset to the saved value.`, conflictText(failed) ? 10_000 : 7000);
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
      set((x) => ({ log: { ...x.log, [leadId]: rows.map((a) => mapActivity(a, x.workspace.timezone)) } }));
    };
    /** The version this tab shows of a record: its edits say they are based on it (If-Match, CD-20). */
    const ver = (kind: HistoryEntity, id: string): string | undefined => cur().versions[`${kind}:${id}`];

    // ------------------------------------------------------------ live updates (CD-20)
    /*
     * A change hint from another tab or person names what changed. After a short pause (hints come
     * in bursts) the lists it affects are read again and shown. Like `reload`, it never overwrites
     * what this tab is editing: it waits until this tab's own edits are saved (without sending
     * typing early), and throws its result away if an edit started while it loaded. An edit made
     * on top of an older version is caught by the API instead (409, see conflictText). Timelines of
     * deals this tab has loaded are re-read too. Errors stay quiet: the next hint or focus retries.
     */
    const queueRefresh = (parts: Iterable<Part>, logs: Iterable<string> = [], touched: Iterable<string> = [], delay = 300, rows: Partial<Record<Part, readonly string[] | null>> = {}) => {
      const p = livePending.current;
      for (const x of parts) {
        const had = p.parts.has(x);
        p.parts.add(x);
        const ids = rows[x];
        const pending = p.rows.get(x);
        // Whole beats rows: a list already due to be read whole stays whole.
        if (!ids || (had && pending === undefined) || pending === null) p.rows.set(x, null);
        else p.rows.set(x, new Set([...(pending ?? []), ...ids]));
      }
      for (const x of logs) p.logs.add(x);
      for (const x of touched) p.touched.add(x);
      clearTimeout(p.timer);
      p.timer = setTimeout(() => void runRefresh(), delay);
    };
    const runRefresh = async () => {
      const p = livePending.current;
      if (p.running) return; // the running refresh picks the new hints up when it is done
      p.running = true;
      let retryLater = false;
      try {
        while (p.parts.size || p.logs.size) {
          const parts = new Set(p.parts);
          const rows = new Map(p.rows);
          const logs = [...p.logs];
          const touched = [...p.touched];
          p.parts.clear();
          p.rows.clear();
          p.logs.clear();
          p.touched.clear();
          for (const id of logs) if (logRequested.current.has(id)) await refreshLog(id).catch(() => undefined);
          if (parts.size === 0) continue;
          let applied = false;
          for (let attempt = 0; attempt < 5 && !applied; attempt++) {
            await whenIdle();
            if (reloading.current) await reloading.current;
            const seq = writeSeq.current;
            const changed: Changed = {};
            for (const [part, ids] of rows) if (ids) changed[part] = ids;
            const data = await loadWorkspace(parts, changed);
            if (seq === writeSeq.current && isIdle()) {
              applyData(data, touched);
              applied = true;
            }
          }
          if (!applied) {
            parts.forEach((x) => p.parts.add(x));
            rows.forEach((ids, x) => {
              const pending = p.rows.get(x);
              p.rows.set(x, ids === null || pending === null ? null : new Set([...ids, ...(pending ?? [])]));
            });
            touched.forEach((x) => p.touched.add(x));
            retryLater = true;
            break;
          }
        }
      } catch {
        retryLater = true;
      } finally {
        p.running = false;
        if (p.parts.size || p.logs.size) queueRefresh([], [], [], retryLater ? 3000 : 300);
      }
    };
    // ------------------------------------------------------------ meetings (CD-130)
    const meetings = meetingActions({
      cur,
      set,
      flash,
      rt: meetingRt.current,
      me: session.userId,
      role: session.tenant.role,
      errText,
      conflictText,
      // A meeting write logged on the deal's timeline (and, marked as held, its last contact): read both again.
      dealChanged: (dealId) => queueRefresh(['deals'], [dealId], [dealId], 300, { deals: [dealId] }),
      tasksChanged: (dealId) => queueRefresh(['tasks'], [dealId], [dealId], 100),
    });

    // ------------------------------------------------------------ people (milestone 13) and the employee card (CD-140)
    const people = peopleActions({ cur, set, flash, rt: peopleRt.current, errText });
    const employeeCard = employeeCardActions({
      cur,
      set,
      flash,
      errText,
      conflictText,
      refreshTeam: async () => {
        try {
          set({ team: mapTeam(await crmApi.team()) });
        } catch {
          // the next reload shows it
        }
      },
      refreshPeople: () => people.refresh(),
    });

    /** Everything this tab shows, after the stream was down (hints may be missing) or on focus. */
    const refreshAll = () => {
      livePending.current.lastFull = Date.now();
      meetings.refreshAll();
      employeeCard.onLive({ type: 'resync' });
      people.refresh();
      queueRefresh(ALL_PARTS, logRequested.current);
    };
    /** The status of these companies from the API, leaving their other fields as they are here (CD-358). */
    const refreshCompanyStatus = async (ids: readonly string[]) => {
      try {
        const rows = new Map((await crmApi.companies(ids)).map((r) => [r.id, r]));
        set((x) => ({
          extraCompanies: x.extraCompanies.map((c) => {
            const r = c.id ? rows.get(c.id) : undefined;
            return r ? { ...c, status: r.status, statusManual: r.statusSetManually, statusChangedAt: r.statusChangedAt } : c;
          }),
        }));
      } catch {
        // the next refresh catches up
      }
    };
    const onLiveEvent = (e: LiveEvent) => {
      // Visit plan progress (CD-135) counts meetings: any meeting or plan change, also this tab's, recounts it.
      if (e.type === 'resync' || e.type === 'meeting' || e.type === 'visit_plan') set((x) => ({ visitRev: x.visitRev + 1 }));
      // The org structure (CD-138) is read again by the screens showing it (store/org.ts).
      if (e.type === 'resync' || PEOPLE_HINTS.has(e.type)) set((x) => ({ orgRev: x.orgRev + 1 }));
      // Project types and projects (CD-272) are read again by the screens showing them.
      // Logged hours show on projects (CD-277): a time entry change reads them again too.
      if (e.type === 'resync' || e.type === 'project_type' || e.type === 'project' || e.type === 'timesheet') set((x) => ({ projectRev: x.projectRev + 1 }));
      // Tasks (CD-146) too, and when their project changes (its name, stage or status shows on them).
      // Time entries (CD-152) change a task's People and hours card and a work order's time too.
      if (e.type === 'resync' || e.type === 'task' || e.type === 'project' || e.type === 'project_type' || e.type === 'timesheet') set((x) => ({ taskRev: x.taskRev + 1 }));
      // Work orders (CD-265), also when their project changes.
      if (e.type === 'resync' || e.type === 'work_order' || e.type === 'project' || e.type === 'timesheet') set((x) => ({ workOrderRev: x.workOrderRev + 1 }));
      // The Timesheet (CD-152): its own entries, days and rows, and the tasks, work orders and projects on its rows.
      // Holidays (CD-153) and the workspace's timesheet settings change everyone's week.
      if (e.type === 'resync' || e.type === 'timesheet' || e.type === 'task' || e.type === 'work_order' || e.type === 'project' || e.type === 'holiday' || e.type === 'workspace')
        set((x) => ({ timesheetRev: x.timesheetRev + 1 }));
      // Time off (CD-163): policies, profiles and entitlements; an employee's start date changes their entitlement too.
      // Reasons and holidays (CD-165) change what a request form shows and counts.
      if (e.type === 'resync' || e.type === 'timeoff' || e.type === 'timeoff_policy' || e.type === 'timeoff_reason' || e.type === 'holiday' || e.type === 'employee' || e.type === 'workspace') set((x) => ({ timeOffRev: x.timeOffRev + 1 }));
      // Today's status (CD-162): approved and pending time off, sick leave and absence lines, hours, holidays, settings and people.
      if (e.type === 'resync' || e.type === 'timeoff' || e.type === 'timesheet' || e.type === 'holiday' || e.type === 'workspace' || PEOPLE_HINTS.has(e.type)) set((x) => ({ statusRev: x.statusRev + 1 }));
      // People lists (Roles & permissions, CD-142) re-read on any employee or role change, this tab's own included.
      if (e.type === 'resync' || e.type === 'employee' || e.type === 'employee_role') set((x) => ({ peopleRev: x.peopleRev + 1 }));
      if (e.type === 'resync') return refreshAll();
      // People (milestone 13): the directory (chart, list, Ctrl/⌘K), open employee cards and their
      // pickers. This tab's own changes too (CD-225): a department added in the panel must show in
      // the card's Department field, a new head on the chart. Both wait a moment (hints come in bursts).
      if (PEOPLE_HINTS.has(e.type)) {
        people.onLive(e);
        employeeCard.onLive(e, e.client === CLIENT_ID);
        if (!PARTS_OF[e.type]?.length) return;
      }
      // A company's status (CD-358) moves on the server after this tab's own saves too (its fields, a
      // contact, a deal): read just the status back, never the fields that may still be being edited.
      if (e.client === CLIENT_ID && e.type === 'company' && e.ids?.length) void refreshCompanyStatus(e.ids);
      if (e.client === CLIENT_ID) return; // this tab's own change: the screen has it already
      if (e.type === 'meeting') return meetings.onLive(e);
      const parts = PARTS_OF[e.type] ?? ALL_PARTS;
      const dealIds = [...(e.dealIds ?? []), ...(e.type === 'deal' ? (e.ids ?? []) : [])];
      const logs = e.dealIds === null ? [...logRequested.current] : dealIds.filter((id) => logRequested.current.has(id));
      queueRefresh(parts, logs, e.type === 'activity' ? [] : [...(e.ids ?? []), ...(e.dealIds ?? [])], 300, rowsOf(e));
    };
    /** Fallback when hints were missed (a sleeping laptop, a proxy that dropped the stream). */
    const onFocus = () => {
      if (Date.now() - livePending.current.lastFull > 10_000) refreshAll();
    };

    /** Loads the activity history of these leads once (screens call it when they open). */
    const ensureLog = (leadIds: string[]) => {
      for (const id of leadIds) {
        if (logRequested.current.has(id)) continue;
        logRequested.current.add(id);
        refreshLog(id).catch(() => logRequested.current.delete(id));
      }
    };

    /**
     * Loads the stage history of every deal (CD-61) for the conversion metrics. Overview calls it
     * each time it opens, so moves made since are included.
     */
    const refreshHistory = async () => {
      try {
        const rows = await crmApi.stageHistory();
        set({ stageHistory: rows.map(mapStageChange) });
      } catch (err) {
        flash('Could not load the stage history: ' + errText(err));
      }
    };

    // ------------------------------------------------------------ documents (CD-13)
    /** Loads the workspace's document templates (Settings, the deal's Documents tab, generation). */
    const loadTemplates = async () => {
      try {
        set({ templates: await docsApi.templates() });
      } catch (err) {
        flash('Could not load the document templates: ' + errText(err));
      }
    };
    const putDoc = (doc: DealDoc) =>
      set((x) => {
        const list = x.dealDocs[doc.dealId] || [];
        const next = list.some((d) => d.id === doc.id) ? list.map((d) => (d.id === doc.id ? doc : d)) : [doc, ...list];
        return { dealDocs: { ...x.dealDocs, [doc.dealId]: next } };
      });
    /** Follows a document the worker is generating until it is ready or failed. */
    const pollDoc = (doc: DealDoc) => {
      if (docPolls.current.has(doc.id)) return;
      const started = Date.now();
      const tick = async () => {
        try {
          const latest = await docsApi.document(doc.id);
          putDoc(latest);
          if (!docBusy(latest)) {
            docPolls.current.delete(doc.id);
            if (latest.status === 'ready') flash(`${latest.name} is ready`);
            else flash(`Could not generate ${latest.name}: ${latest.error ?? 'unknown error'}`, 7000);
            void refreshLog(latest.dealId).catch(() => undefined);
            return;
          }
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            docPolls.current.delete(doc.id);
            return;
          }
        }
        // The worker normally takes a second or two; keep asking for a few minutes, slowing down.
        if (Date.now() - started > 5 * 60_000) {
          docPolls.current.delete(doc.id);
          return;
        }
        docPolls.current.set(doc.id, setTimeout(tick, Date.now() - started < 20_000 ? 700 : 3000));
      };
      docPolls.current.set(doc.id, setTimeout(tick, 400));
    };
    /** Loads a deal's documents once per session (and follows any still being generated). */
    const ensureDocs = (leadId: string) => {
      if (docsRequested.current.has(leadId)) return;
      docsRequested.current.add(leadId);
      docsApi
        .documents(leadId)
        .then((docs) => {
          set((x) => ({ dealDocs: { ...x.dealDocs, [leadId]: docs } }));
          docs.filter(docBusy).forEach(pollDoc);
        })
        .catch((err) => {
          docsRequested.current.delete(leadId);
          flash('Could not load the documents: ' + errText(err));
        });
    };
    /** Queues a document for the worker; returns it (queued) or null when that failed. */
    const generateDoc = async (leadId: string, templateId: string): Promise<DealDoc | null> => {
      try {
        const doc = await docsApi.generate(leadId, templateId);
        putDoc(doc);
        pollDoc(doc);
        return doc;
      } catch (err) {
        flash('Could not generate the document: ' + errText(err), 7000);
        return null;
      }
    };
    /** Opens the generation dialog for a deal (on entering a Proposal stage, or from its Documents tab). */
    const startGeneration = (leadId: string) => {
      set({ genOpen: true, genLead: leadId, genDocId: null });
      void loadTemplates();
    };

    const moveLead = (leadId: string, stageId: string) => {
      const lead = leadById(cur(), leadId);
      if (!lead || lead.stage === stageId) return;
      if (lead.outcome === 'lost') {
        flash('This opportunity is lost. Reopen it before moving it to another stage.');
        return;
      }
      const stages = stagesFor(cur(), lead.segment);
      const stage = stages.find((st) => st.id === stageId);
      // The advance gate (CD-363), as the API applies it: forward moves only, Won only from the last stage
      // in a gated funnel, no jumping over a gated stage. Said here instead of moving and snapping back;
      // the API refuses it anyway (409).
      if (stage && stages.indexOf(stage) > stages.findIndex((st) => st.id === lead.stage)) {
        const blockers = advanceBlockers(cur(), lead);
        const route = stage.won ? wonBlocker(cur(), lead) : skipBlocker(cur(), lead, stage);
        if (route) blockers.unshift(route);
        if (blockers.length) {
          flash(`Can't move to ${stage.name} yet: ${blockers.join('; ')}.`, 7000);
          return;
        }
      }
      mapLead(leadId, (l) => ({ ...l, stage: stageId, stall: 0, lateDays: 0, outcome: stage?.won ? 'won' : 'open', stageSince: new Date().toISOString() }));
      void save(() => crmApi.moveDeal(leadId, stageId), () => refreshLog(leadId), 'the stage move');
      // Not when it has its proposal already (one per opportunity, CD-120).
      if (stage && stage.doc === 'Proposal' && AUTO_GENERATE_DOCS && !hasLiveProposal(cur().dealDocs[leadId])) startGeneration(leadId);
      else if (stage) flash('Moved to ' + stage.name + ' · next activity: ' + stage.activity);
    };

    /** A timeline entry made here, by the signed-in person unless `actor` says otherwise (CD-318). */
    const pushLog = (leadId: string, draft: Omit<LogEntry, 'actor'> & { actor?: string | null }) => {
      const entry: LogEntry = { actor: session.userName, ...draft };
      set((x) => ({ log: { ...x.log, [leadId]: [entry, ...(x.log[leadId] || [])] } }));
      void save(() => crmApi.logActivity(leadId, { channel: channelOf(entry.channel), title: entry.title, detail: entry.detail || null }), undefined, 'the timeline entry');
    };

    // ------------------------------------------------------------ deal products (CD-83)
    /**
     * Saves what the deal's "Products" dialog shows, all at once: currency, tax mode, lines,
     * discounts and installments. New lines, discounts and installments have ids starting with
     * "new-" and are sent without one. The API recalculates the deal value.
     */
    const saveDealProducts = async (leadId: string, draft: DealProductsDraft): Promise<boolean> => {
      const keep = (id: string) => (id.startsWith('new-') ? {} : { id });
      const input: DealProductsInput = {
        currency: draft.currency,
        taxMode: draft.taxMode,
        lines: draft.lines.map((l) => ({
          ...keep(l.id),
          productId: l.itemId,
          description: l.description.trim() || null,
          startDate: l.start || null,
          quantity: num(l.qty),
          unitPrice: num(l.price),
          discountKind: l.discountKind,
          discountValue: num(l.discount),
          vatRate: Math.min(100, num(l.vat)),
          billingFrequency: l.frequency,
          billingCycles: l.frequency === 'one_time' ? null : l.cycles,
        })),
        discounts: draft.discounts.map((d) => ({ ...keep(d.id), label: d.label.trim(), kind: d.kind, value: num(d.value) })),
        installments: draft.installments.map((x) => ({ ...keep(x.id), description: x.description.trim(), date: x.date || null, amount: num(x.amount) })),
      };
      inFlight.current++;
      writeSeq.current++;
      try {
        const res = await crmApi.saveDealProducts(leadId, input);
        const lines = res.lines.map(mapLine);
        set((y) => ({
          dealLines: { ...y.dealLines, [leadId]: lines },
          leads: y.leads.map((l) => {
            if (l.id !== leadId) return l;
            const next = { ...l, currency: draft.currency, taxMode: draft.taxMode, discounts: draft.discounts, installments: draft.installments };
            return { ...next, value: money(dealTotals(lines, next.taxMode, next.discounts).subtotal, curOf(y, next)) };
          }),
        }));
      } catch (err) {
        flash('Not saved: the opportunity products (' + errText(err) + ')', 7000);
        return false;
      } finally {
        inFlight.current--;
        notifyIfIdle();
      }
      void reload();
      return true;
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

    const CONTACT_FIELDS: Partial<Record<keyof Person, keyof ContactInput>> = {
      name: 'fullName',
      role: 'jobTitle',
      email: 'email',
      phone: 'phone',
      linkedin: 'linkedin',
      buyerRole: 'buyerRole',
      notes: 'notes',
      // Details and personal details (CD-361)
      orgUnit: 'orgUnit',
      source: 'source',
      influence: 'influence',
      birthday: 'birthday',
      spouseName: 'spouseName',
      children: 'children',
      pets: 'pets',
    };
    const FIELD_WORDS: Partial<Record<keyof Person, string>> = { role: 'job title', buyerRole: 'role in the decision', orgUnit: 'org unit', influence: 'influence on the opportunity', spouseName: 'spouse' };
    const patchPerson = (id: string, patch: Partial<Person>) => {
      const p = personById(cur(), id);
      const contactId = p?.contactId;
      if (!p || !contactId) return;
      if (patch.ownerId) {
        const ownerUserId = patch.ownerId;
        void save(() => crmApi.updateContact(contactId, { ownerUserId }, ver('contact', contactId)), reload, `${p.name}'s owner`);
      }
      for (const [k, v] of Object.entries(patch)) {
        const field = CONTACT_FIELDS[k as keyof Person];
        const text = String(v ?? '');
        // An empty role in the decision or birthday is "none" (null), not an empty string (CD-361).
        const value = (field === 'buyerRole' || field === 'birthday') && !text ? null : text;
        if (field && !(field === 'fullName' && !text.trim())) saveLater(`contact:${contactId}:${field}`, () => crmApi.updateContact(contactId, { [field]: value }, ver('contact', contactId)), `${p.name}'s ${FIELD_WORDS[k as keyof Person] ?? k}`);
      }
      const withInitials = patch.name !== undefined ? { ...patch, initials: initialsOf(patch.name) } : patch;
      if (p.primary) {
        const map: Record<string, string> = { name: 'contact', role: 'role', email: 'email', phone: 'phone', buyerRole: 'buyerRole', notes: 'contactNotes', linkedin: 'contactLinkedin', initials: 'initials', ownerId: 'contactOwnerId' };
        const lp: Record<string, unknown> = {};
        const extra: Partial<ContactExtra> = {};
        Object.entries(withInitials).forEach(([k, v]) => {
          if ((CONTACT_EXTRA_KEYS as readonly string[]).includes(k)) extra[k as keyof ContactExtra] = String(v ?? '');
          else lp[map[k] || k] = v;
        });
        set((x) => ({ leads: x.leads.map((l) => (l.contactId === contactId ? { ...l, ...lp, contactExtra: { ...(l.contactExtra ?? EMPTY_EXTRA), ...extra } } : l)) }));
      } else {
        set((x) => ({ extraPeople: x.extraPeople.map((y) => (y.id === id ? { ...y, ...withInitials } : y)) }));
      }
    };

    /**
     * Moves a contact to another company (CD-464), with no deal: any company, deals or not. A moved
     * primary contact is replaced on their old company's deals by another contact of that company, if
     * there is one.
     */
    const setPersonCompany = (id: string, companyId: string) => {
      const x = cur();
      const p = personById(x, id);
      const target = companyRecords(x).find((c) => c.id === companyId);
      const contactId = p?.contactId;
      if (!p || !target || !contactId || companyId === companyIdOfPerson(x, p)) return;
      const oldCompanyId = companyIdOfPerson(x, p);
      const affected = p.primary ? x.leads.filter((l) => l.contactId === contactId) : [];
      // Only a contact of the same company replaces them; a contact without a company has no colleagues.
      const promoted = affected.length && oldCompanyId ? allPeople(x).find((y) => y.contactId && y.contactId !== contactId && companyIdOfPerson(x, y) === oldCompanyId) : undefined;
      void save(
        async () => {
          await crmApi.updateContact(contactId, { companyId }, ver('contact', contactId));
          for (const l of affected) await crmApi.updateDeal(l.id, { primaryContactId: promoted?.contactId ?? null });
        },
        async () => {
          await reload();
          navigate(paths.contact(contactId), { replace: true });
          flash('Contact moved to ' + target.name);
        },
        'the company of ' + p.name,
      );
    };

    // ------------------------------------------------------------ stage to-dos
    /**
     * Saves a to-do's state. Playbook to-dos are upserted by deal + stage + checklist item; off-playbook
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
      const itemId = item.offPlaybook ? undefined : stagesFor(x, lead!.segment).find((st) => st.id === stageId)?.checklistIds[idx];
      saveLater('task:' + key, async () => {
        const body = pendingTasks.current.get(key) ?? {};
        pendingTasks.current.delete(key);
        if (itemId) await crmApi.upsertPlaybookTask(leadId, { stageId, checklistItemId: itemId, ...body });
        else if (extraId) await crmApi.updateTask(extraId, body);
      }, `the to-do "${item.label || 'New to-do'}"`);
    };

    const patchTask = (leadId: string, stageId: string, idx: number, patch: TaskState) => {
      const full = patch.done && !patch.by ? { at: todayLabel(cur().workspace.timezone), by: session.userName.split(' ')[0], ...patch } : patch;
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
      const date = todayLabel(cur().workspace.timezone);
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
        set((x) => ({ leadTasks: [...x.leadTasks, mapLeadTask(row, x.workspace.timezone)] }));
        // The backend logged "Task added" on the timeline; refresh it if it is loaded.
        if (logRequested.current.has(draft.leadId)) void refreshLog(draft.leadId).catch(() => undefined);
        return true;
      } catch (err) {
        flash('Not saved: ' + errText(err));
        return false;
      }
    };
    /**
     * Changes a task's title, owner, due date, channel or note (CD-27). The screen updates at once;
     * a failed save says why and puts the saved values back (see save).
     */
    const updateLeadTask = (id: string, patch: Partial<Pick<LeadTask, 'title' | 'ownerId' | 'due' | 'channel' | 'note'>>) => {
      const t = cur().leadTasks.find((x) => x.id === id);
      if (!t) return;
      const title = patch.title?.trim() || t.title;
      const note = patch.note?.trim() ?? t.note;
      const body: TaskInput = {};
      if (title !== t.title) body.label = title;
      if (note !== t.note) body.note = note || null;
      if (patch.due !== undefined && patch.due !== t.due) body.dueDate = patch.due || null;
      if (patch.ownerId !== undefined && patch.ownerId !== t.ownerId) body.assigneeUserId = patch.ownerId || null;
      if (patch.channel !== undefined && patch.channel !== t.channel) body.channel = patch.channel;
      if (!Object.keys(body).length) return;
      const ownerId = patch.ownerId ?? t.ownerId;
      const ownerName = cur().team.find((m) => m.status === 'Active' && m.id === ownerId)?.name ?? t.ownerName;
      set((x) => ({ leadTasks: x.leadTasks.map((y) => (y.id === id ? { ...y, title, note, due: patch.due ?? t.due, channel: patch.channel ?? t.channel, ownerId, ownerName } : y)) }));
      void save(() => crmApi.updateTask(id, body), undefined, `the task "${t.title}"`);
    };
    /** Ticks or unticks a task; ticking also logs it on the lead's timeline. */
    const toggleLeadTask = (id: string) => {
      const t = cur().leadTasks.find((x) => x.id === id);
      if (!t) return;
      const done = !t.done;
      const date = todayLabel(cur().workspace.timezone);
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
      if (i >= stages.length - 1) {
        flash('Already at the final stage.');
        return;
      }
      moveLead(lead.id, stages[i + 1]!.id);
    };

    /** "Documentation complete, ready to send" on a stage of a deal (CD-363): who and when come from the API. */
    const setDocsComplete = (leadId: string, stageId: string, complete: boolean) => {
      mapLead(leadId, (l) => {
        const next = { ...l.docsComplete };
        if (complete) next[stageId] = { at: new Date().toISOString(), by: session.userId };
        else delete next[stageId];
        return { ...l, docsComplete: next };
      });
      void save(
        () => crmApi.setDocsComplete(leadId, stageId, complete),
        async () => {
          await reload();
          await refreshLog(leadId);
        },
        'the documentation',
      );
    };

    /** "Remind the owner" (CD-363): an email to whoever answers for the deal's stage. */
    const remindStageOwner = async (leadId: string) => {
      try {
        const { recipientUserId } = await crmApi.remindStageOwner(leadId);
        flash(`Reminder sent to ${memberName(cur(), recipientUserId)}`);
        await refreshLog(leadId);
      } catch (err) {
        flash('Not sent: ' + errText(err));
      }
    };

    // ------------------------------------------------------------ proposal approval (CD-120)
    /** Request, approve, decline or revoke a proposal's approval (decline is a revoke of a pending request); the API answers with where it now stands. */
    const proposalApproval = async (leadId: string, step: 'request' | 'approve' | 'decline' | 'revoke') => {
      try {
        const state = await crmApi.approval(leadId, step === 'decline' ? 'revoke' : step);
        mapLead(leadId, (l) => ({ ...l, approval: approvalOf(state) }));
        const lead = leadById(cur(), leadId);
        const approver = memberName(cur(), cur().funnels[lead?.segment ?? '']?.approverId ?? null);
        flash(step === 'request' ? `Approval requested · ${approver} got an email and a task` : step === 'approve' ? 'Proposal approved · it can be sent now' : step === 'decline' ? 'Approval request declined · the proposal needs a new request' : 'Approval revoked · the proposal needs approval again before it is sent');
        // The approver's task is added, ticked or removed with it; the deal row is read again too, or the
        // refresh would rebuild the deal from its previous load and drop the new approval.
        queueRefresh(['deals', 'tasks'], [], [leadId], 0, { deals: [leadId], tasks: [leadId] });
        await refreshLog(leadId);
      } catch (err) {
        flash((step === 'request' ? 'Not requested: ' : step === 'approve' ? 'Not approved: ' : step === 'decline' ? 'Not declined: ' : 'Not revoked: ') + errText(err), 7000);
      }
    };
    /** "Send proposal" (CD-120): the API refuses it until the funnel's approval is in. Resolves whether it was saved. */
    const markProposalSent = async (leadId: string): Promise<boolean> => {
      try {
        const state = await crmApi.markProposalSent(leadId);
        mapLead(leadId, (l) => ({ ...l, approval: approvalOf(state) }));
        // Nothing is emailed and no follow-up task is created yet: say so instead of pretending.
        flash('Proposal marked as sent · emailing it from Pultly is coming soon, nothing was emailed');
        await refreshLog(leadId);
        return true;
      } catch (err) {
        flash('Not marked as sent: ' + errText(err), 7000);
        return false;
      }
    };
    /** "Import my own" (CD-120): uploads the files with their types. Resolves whether they were saved. */
    const uploadDocs = async (leadId: string, files: { file: File; type: UploadType }[]): Promise<boolean> => {
      try {
        const docs = await docsApi.uploadDocuments(leadId, files);
        docs.forEach(putDoc);
        flash(files.length === 1 ? `${files[0]!.file.name} saved` : `${files.length} documents saved`);
        await refreshLog(leadId);
        return true;
      } catch (err) {
        flash('Not saved: ' + errText(err), 7000);
        return false;
      }
    };

    // ------------------------------------------------------------ lost deals
    /** The lost state of a deal as the API returned it. */
    const outcomeOf = (d: ApiDeal): Partial<Lead> => ({ outcome: d.outcome, lostReason: d.lostReason ?? undefined, lostNote: d.lostNote ?? undefined, lostAt: d.lostAt ?? undefined });
    /** Marks a deal lost with a reason (and an optional note); resolves false (after saying why) when it wasn't saved. */
    const markLost = async (leadId: string, reason: LostReason, note: string): Promise<boolean> => {
      try {
        const deal = await crmApi.markLost(leadId, reason, note.trim() || null);
        mapLead(leadId, (l) => ({ ...l, ...outcomeOf(deal) }));
        // The backend logged "Marked as lost: <reason>" on the timeline.
        void refreshLog(leadId).catch(() => undefined);
        return true;
      } catch (err) {
        flash('Not saved: ' + errText(err));
        return false;
      }
    };
    /** Reopens a lost deal in the stage it was lost in. */
    const reopenLead = (leadId: string) => {
      mapLead(leadId, (l) => ({ ...l, outcome: 'open', lostReason: undefined, lostNote: undefined, lostAt: undefined }));
      void save(
        async () => {
          const deal = await crmApi.reopenDeal(leadId);
          mapLead(leadId, (l) => ({ ...l, ...outcomeOf(deal) }));
        },
        () => refreshLog(leadId),
        'reopening the opportunity',
      );
      flash('Opportunity reopened');
    };

    // ------------------------------------------------------------ funnel builder
    /**
     * Edits one stage of the open funnel and saves it (editing funnels is an admin action).
     * `structural` changes (adding or removing a to-do) shift the to-dos after it, so they are
     * saved at once and the workspace is reloaded; renames keep their item id and just save.
     */
    const editStage = (idx: number, fn: (stage: Stage) => void, structural = false) => {
      if (!canEditFunnels) return; // members see the playbook read-only; the API refuses them (403)
      const x = cur();
      const funnels = JSON.parse(JSON.stringify(x.funnels)) as State['funnels'];
      const funnel = funnels[x.segment];
      const st = funnel.stages[idx];
      if (!st) return;
      fn(st);
      set({ funnels });
      const funnelId = funnel.id;
      if (!funnelId) return;
      const write = () =>
        crmApi.updateStage(funnelId, st.id, {
          name: st.name.trim() || 'Stage',
          activity: st.activity,
          channel: channelOf(st.channel),
          documentOnEntry: st.doc === 'None' ? null : st.doc,
          winProbability: st.prob === '' ? 0 : st.prob,
          // Items keep their id, so renaming one keeps the deals' ticks on it (CD-32).
          checklistItems: st.checklist.map((label, i) => ({ id: st.checklistIds[i]!, label: label.trim() })),
          // Owner, target and advance gates (CD-363).
          ownerUserId: st.ownerId,
          targetDays: st.targetDays,
          gateDocsComplete: st.gateDocs,
          gateTodos: st.gateTodos,
        });
      // A to-do whose name is cleared while typing isn't saved (that would remove the item and
      // its ticks); the stage saves again once it has a name, or when it is removed.
      if (st.checklist.some((c) => !c.trim())) return;
      if (!structural) return saveLater('stage:' + st.id, write, 'the stage ' + (st.name.trim() || 'Stage'));
      dropSave('stage:' + st.id);
      void save(write, reload, 'the to-dos of ' + (st.name.trim() || 'Stage'));
    };

    // ------------------------------------------------------------ funnels and stages (CD-9, CD-10)
    /** Owners and admins edit the playbook: funnels, stages and to-dos. */
    const canEditFunnels = session.tenant.role === 'owner' || session.tenant.role === 'admin';
    /** Saves the pending edits of the open funnel first, then runs a change that reshapes it, then reloads. */
    const reshape = (write: () => Promise<unknown>, what: string, then?: () => unknown) => {
      flushSaves();
      void save(
        async () => {
          await whenIdleExcept();
          await write();
        },
        async () => {
          await reload();
          await then?.();
        },
        what,
      );
    };
    /** Waits for the writes already sent (this one isn't counted yet when it starts). */
    const whenIdleExcept = () => new Promise<void>((resolve) => {
      const check = () => (inFlight.current <= 1 && saveTimers.current.size === 0 ? resolve() : setTimeout(check, 50));
      check();
    });
    const openFunnel = () => cur().funnels[cur().segment];
    /** Adds a stage to the open funnel, just before its won stage. */
    const addStage = () => {
      const funnel = openFunnel();
      if (!funnel) return;
      let name = 'New stage';
      for (let i = 2; funnel.stages.some((st) => st.name === name); i++) name = 'New stage ' + i;
      reshape(() => crmApi.createStage(funnel.id, { name }), 'the new stage', () => flash(name + ' added · rename it and set its activity'));
    };
    /** Moves a stage of the open funnel one place up (-1) or down (+1). */
    const moveStage = (idx: number, dir: -1 | 1) => {
      const funnel = openFunnel();
      const to = idx + dir;
      if (!funnel || to < 0 || to >= funnel.stages.length) return;
      const stages = [...funnel.stages];
      [stages[idx], stages[to]] = [stages[to]!, stages[idx]!];
      set((x) => ({ funnels: { ...x.funnels, [funnel.id]: { ...funnel, stages } } }));
      reshape(() => crmApi.reorderStages(funnel.id, stages.map((st) => st.id)), 'the stage order');
    };
    /** Deletes a stage of the open funnel; its deals (if any) move to `moveTo`. */
    const removeStage = (idx: number, moveTo?: string) => {
      const funnel = openFunnel();
      const st = funnel?.stages[idx];
      if (!funnel || !st) return;
      dropSave('stage:' + st.id);
      const moved = cur().leads.filter((l) => l.stage === st.id).length;
      const target = funnel.stages.find((x) => x.id === moveTo);
      reshape(() => crmApi.deleteStage(funnel.id, st.id, moveTo), 'removing ' + st.name, () =>
        flash(st.name + ' removed' + (moved && target ? ` · ${moved} ${moved === 1 ? 'opportunity' : 'opportunities'} moved to ${target.name}` : '')),
      );
    };
    /** New funnel from a copy of another one's stages (or a small default set); opens it. */
    const createFunnel = async (input: { label: string; note: string; copyFrom: string }): Promise<boolean> => {
      try {
        const f = await crmApi.createFunnel({ label: input.label.trim(), note: input.note.trim() || null, ...(input.copyFrom !== 'blank' ? { copyFromFunnelId: input.copyFrom } : {}) });
        await reload();
        set({ segment: f.id, personaOpen: false });
        flash(f.label + ' created · edit its stages below');
        return true;
      } catch (err) {
        flash('Not saved: ' + errText(err));
        return false;
      }
    };
    /** Renames the open funnel or changes its note (one write per field after a pause). */
    const patchFunnel = (id: string, patch: { label?: string; note?: string; targetDays?: number | null; proposalApproval?: boolean; approverId?: string | null }) => {
      const funnel = cur().funnels[id];
      if (!funnel) return;
      set((x) => ({ funnels: { ...x.funnels, [id]: { ...funnel, ...patch } } }));
      if (patch.targetDays !== undefined) saveLater('funnel-target:' + id, () => crmApi.updateFunnel(id, { targetDays: patch.targetDays ?? null }), 'the default target days');
      if (patch.label !== undefined && patch.label.trim()) saveLater('funnel-label:' + id, () => crmApi.updateFunnel(id, { label: patch.label!.trim() }), 'the funnel name');
      if (patch.note !== undefined) saveLater('funnel-note:' + id, () => crmApi.updateFunnel(id, { note: patch.note!.trim() || null }), 'the funnel description');
      // Proposal approval (CD-120): the switch and the approver go together (the API needs an approver to switch it on).
      if (patch.proposalApproval !== undefined || patch.approverId !== undefined) {
        const next = { ...funnel, ...patch };
        if (next.proposalApproval && !next.approverId) return;
        void save(() => crmApi.updateFunnel(id, { proposalApproval: next.proposalApproval, approverUserId: next.approverId }), undefined, 'the proposal approval');
      }
    };
    /** Deletes a funnel that never had deals (the API refuses others with a reason). */
    const deleteFunnel = async (id: string) => {
      const funnel = cur().funnels[id];
      if (!funnel) return;
      cancelSaves(id, ...funnel.stages.map((st) => st.id));
      try {
        await crmApi.deleteFunnel(id);
      } catch (err) {
        flash('Not deleted: ' + errText(err), 7000);
        return;
      }
      await reload();
      flash(funnel.label + ' deleted');
    };

    // ------------------------------------------------------------ companies
    /**
     * Companies are identified by id (names aren't unique), so renaming one keeps its route. Domain
     * and notes (CD-209) live on the company only; the other fields are also copied onto its deals.
     */
    const setCompanyField = (companyId: string, key: CompanyFieldKey, v: string) => {
      const field = key === 'size' ? 'teamSize' : key;
      // An empty name or PIB is never sent (the API refuses both); no ownership is null.
      const value = key === 'ownershipType' ? v || null : v;
      if (!((key === 'name' || key === 'pib') && !v.trim())) saveLater(`company:${companyId}:${field}`, () => crmApi.updateCompany(companyId, { [field]: value }, ver('company', companyId)), `the company ${COMPANY_FIELD_LABELS[key] ?? key}`);
      // Industry, HQ and team size are shown on its opportunities too; the identity stays on the company.
      const onDeals = key === 'name' || key === 'industry' || key === 'hq' || key === 'size' || key === 'source';
      set((x) => ({
        leads: onDeals ? x.leads.map((l) => (l.companyId === companyId ? { ...l, ...(key === 'name' ? { company: v } : { [key]: v }) } : l)) : x.leads,
        extraCompanies: x.extraCompanies.map((c) => (c.id === companyId ? { ...c, [key]: v } : c)),
        extraPeople: key === 'name' ? x.extraPeople.map((p) => (p.companyId === companyId ? { ...p, company: v } : p)) : x.extraPeople,
      }));
    };

    /** Hands a company to another workspace member (CD-80). */
    const setCompanyOwner = (companyId: string, ownerId: string) => {
      set((x) => ({ extraCompanies: x.extraCompanies.map((c) => (c.id === companyId ? { ...c, ownerId } : c)) }));
      void save(() => crmApi.updateCompany(companyId, { ownerUserId: ownerId }, ver('company', companyId)), reload, 'the company owner');
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
      if (title !== undefined && title.trim()) saveLater('title:' + id, () => crmApi.updateDeal(id, { title: title.trim() }, ver('deal', id)), 'the opportunity title');
      if (closeDate !== undefined) saveLater('close:' + id, () => crmApi.updateDeal(id, { closeDate: closeDate || null }, ver('deal', id)), 'the closing date');
      if (source !== undefined) saveLater('source:' + id, () => crmApi.updateDeal(id, { source }, ver('deal', id)), 'the opportunity source');
      if (dealPatch.saleType !== undefined) void save(() => crmApi.updateDeal(id, { saleType: dealPatch.saleType || null }, ver('deal', id)), undefined, 'the sale type');
      // Discovery notes (merged into the proposal). Empty text clears the field.
      for (const key of DISCOVERY_FIELDS) {
        const v = dealPatch[key];
        if (v !== undefined) saveLater(`${key}:${id}`, () => crmApi.updateDeal(id, { [key]: key === 'discoveryDate' ? v || null : v }, ver('deal', id)), 'the discovery notes');
      }
      // Qualification (CD-362): text as you type; sponsors and the steps to be qualified at once.
      for (const key of QUALIFICATION_TEXT) {
        const v = dealPatch[key];
        if (v !== undefined) saveLater(`${key}:${id}`, () => crmApi.updateDeal(id, { [key]: v }, ver('deal', id)), 'the qualification');
      }
      for (const key of ['sponsorContactId', 'powerSponsorContactId'] as const) {
        const v = dealPatch[key];
        if (v !== undefined && v !== lead[key]) void save(() => crmApi.updateDeal(id, { [key]: v || null }, ver('deal', id)), undefined, key === 'sponsorContactId' ? 'the sponsor' : 'the power sponsor');
      }
      const steps = dealPatch.qualificationSteps;
      if (steps !== undefined) void save(() => crmApi.updateDeal(id, { qualificationSteps: steps }, ver('deal', id)), undefined, 'the steps to be qualified');
      if (dealPatch.companyId !== undefined && dealPatch.companyId !== companyId) {
        const target = dealPatch.companyId;
        const rec = target ? companyRecords(cur()).find((c) => c.id === target) : undefined;
        if (target && !rec) return;
        dealPatch.company = rec?.name ?? 'No company';
        void save(() => crmApi.updateDeal(id, { companyId: target }, ver('deal', id)), reload, 'the company of this opportunity');
      }
      if (ownerId !== undefined && ownerId !== lead.ownerId) {
        dealPatch.owner = cur().team.find((m) => m.status === 'Active' && m.id === ownerId)?.name;
        void save(() => crmApi.updateDeal(id, { ownerUserId: ownerId }, ver('deal', id)), undefined, 'the opportunity owner');
      }
      mapLead(id, (l) => ({ ...l, ...dealPatch }));
    };

    /** The Qualified switch (CD-362): the server records who and when, and logs it; reloading the deal and its timeline shows both. */
    const setQualified = (id: string, on: boolean) => {
      mapLead(id, (l) => ({ ...l, qualifiedAt: on ? new Date().toISOString() : undefined, qualifiedBy: on ? session.userId : undefined }));
      void save(() => crmApi.updateDeal(id, { qualified: on }, ver('deal', id)), () => Promise.all([reload(), refreshLog(id)]), 'Qualified');
    };

    // ------------------------------------------------------------ deleting (owners and admins)
    const canDelete = canEditFunnels;
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
      cancelSaves(id);
      await remove(() => crmApi.deleteDeal(id), paths.pipeline, (lead.title || lead.company) + ' deleted');
    };
    const deleteCompany = async (id: string) => {
      const rec = companyRecords(cur()).find((c) => c.id === id);
      if (!rec) return;
      cancelSaves(id);
      await remove(() => crmApi.deleteCompany(id), paths.companies, rec.name + ' deleted');
    };
    /**
     * Fills in what a lead misses, from the New opportunity dialog (CD-360): its identity fields and
     * one contact (an existing one, or a new one). The API recomputes the status; the reload brings it.
     */
    const completeCompany = async (companyId: string, company: CompanyInput, contact: { id: string; patch: ContactInput } | { create: ContactInput & { fullName: string } } | null) => {
      try {
        if (Object.keys(company).length) await crmApi.updateCompany(companyId, company);
        if (contact && 'id' in contact && Object.keys(contact.patch).length) await crmApi.updateContact(contact.id, contact.patch);
        if (contact && 'create' in contact) await crmApi.createContact({ ...contact.create, companyId });
        await reload();
      } catch (err) {
        flash('Not saved: ' + errText(err), 7000);
      }
    };
    /** "Set status back…" or "Back to automatic" (CD-358); the API refuses a move forward and says why. */
    const setCompanyStatus = async (companyId: string, status: CompanyStatus | null) => {
      try {
        const row = await crmApi.setCompanyStatus(companyId, status);
        set((x) => ({ extraCompanies: x.extraCompanies.map((c) => (c.id === companyId ? { ...c, status: row.status, statusManual: row.statusSetManually, statusChangedAt: row.statusChangedAt } : c)) }));
        flash(status ? `Status set back to ${COMPANY_STATUS_LABELS[row.status]}` : `The status is automatic again: ${COMPANY_STATUS_LABELS[row.status]}`);
      } catch (err) {
        flash('Status not changed: ' + errText(err), 7000);
      }
    };
    /** A company's status changes as Activity entries, newest first (CD-358). */
    const companyStatusHistory = async (companyId: string): Promise<LogEntry[]> => {
      const tz = cur().workspace.timezone;
      return (await crmApi.companyStatusHistory(companyId)).map((r) => ({
        date: momentLabel(r.at, tz),
        at: r.at,
        channel: SYSTEM_CHANNEL,
        title: `Status: ${COMPANY_STATUS_LABELS[r.to]} · ${r.reason === 'manual' ? 'set by hand' : 'automatic'}`,
        detail: `Was ${COMPANY_STATUS_LABELS[r.from]}.`,
        actor: r.actorName,
      }));
    };
    const deleteContact = async (personId: string) => {
      const p = personById(cur(), personId);
      const contactId = p?.contactId;
      if (!p || !contactId) return;
      cancelSaves(contactId);
      await remove(() => crmApi.deleteContact(contactId), paths.contacts, p.name + ' deleted');
    };

    // ------------------------------------------------------------ visit plans (CD-134; owners and admins edit)
    const mapPlan = (id: string, fn: (p: VisitPlan) => VisitPlan) => set((x) => ({ visitPlans: x.visitPlans.map((p) => (p.id === id ? fn(p) : p)) }));
    /** After a save, the plan's new version (If-Match for the next one). The screen already shows the change. */
    const planSaved = (plan: VisitPlan) => set((x) => ({ versions: { ...x.versions, ['visit_plan:' + plan.id]: plan.updatedAt } }));
    const planWrite = (id: string, input: Partial<VisitPlanInput>) => crmApi.updateVisitPlan(id, input, ver('visit_plan', id)).then(planSaved);
    /** Creates a plan; on failure (e.g. a plan for that person and period exists) returns the reason instead. */
    const createVisitPlan = async (input: VisitPlanInput): Promise<{ plan: VisitPlan } | { error: string }> => {
      try {
        const plan = await crmApi.createVisitPlan(input);
        set((x) => ({ visitPlans: sortPlans([plan, ...x.visitPlans.filter((p) => p.id !== plan.id)]), versions: { ...x.versions, ['visit_plan:' + plan.id]: plan.updatedAt } }));
        return { plan };
      } catch (err) {
        return { error: errText(err) };
      }
    };
    /** Replaces a plan's lines (add a customer, change a number, remove one); typing is saved after a pause. */
    const setPlanLines = (id: string, lines: { companyId: string; plannedVisits: number }[]) => {
      const names = new Map(companyRecords(cur()).map((c) => [c.id, c.name]));
      const plan = cur().visitPlans.find((p) => p.id === id);
      if (!plan) return;
      const old = new Map(plan.lines.map((l) => [l.companyId, l]));
      const next = lines.map((l) => ({ id: old.get(l.companyId)?.id ?? '', companyId: l.companyId, companyName: old.get(l.companyId)?.companyName ?? names.get(l.companyId) ?? 'Company', plannedVisits: l.plannedVisits }));
      mapPlan(id, (p) => ({ ...p, lines: next, totalPlanned: next.reduce((sum, l) => sum + l.plannedVisits, 0) }));
      saveLater(`visit_plan:${id}:lines`, () => {
        const now = cur().visitPlans.find((p) => p.id === id);
        return now ? planWrite(id, { lines: now.lines.map((l) => ({ companyId: l.companyId, plannedVisits: l.plannedVisits })) }) : Promise.resolve();
      }, 'the customers of this plan');
    };
    const setPlanNote = (id: string, note: string) => {
      mapPlan(id, (p) => ({ ...p, note }));
      saveLater(`visit_plan:${id}:note`, () => planWrite(id, { note: note.trim() || null }), 'the note of this plan');
    };
    const deleteVisitPlan = async (id: string) => {
      const plan = cur().visitPlans.find((p) => p.id === id);
      if (!plan) return;
      cancelSaves(id);
      await remove(() => crmApi.deleteVisitPlan(id), paths.visitPlans, `Visit plan for ${plan.periodLabel} deleted`);
    };

    return {
      set,
      flash,
      navigate,
      reload,
      /** Live updates (CD-20), wired up below. */
      live: { onEvent: onLiveEvent, refreshAll, onFocus },
      /** Meetings (CD-130): queries, saving and the meeting dialog (store/meetings.ts). */
      meetings,
      /** The employee card (CD-140): reading, saving, invitations, linking, leaving (store/employeeCard.ts). */
      employeeCard,
      /** Employees, org levels and units (milestone 13; store/people.ts). */
      people,
      /** A page of the change history of a deal, company or contact (CD-69), newest first. */
      loadChanges: (entity: HistoryEntity, id: string, offset = 0) => crmApi.history(entity, id, offset),
      ensureLog,
      refreshHistory,
      moveLead,
      startGeneration,
      pushLog,
      patchLead,
      setQualified,
      patchLeadSegment: (id: string, seg: SegKey) => {
        const funnelId = cur().funnels[seg]?.id;
        if (!funnelId) return;
        if (leadById(cur(), id)?.outcome === 'lost') {
          flash('This opportunity is lost. Reopen it before changing its funnel.');
          return;
        }
        mapLead(id, (l) => ({ ...l, segment: seg, stage: stagesFor(cur(), seg)[0]!.id }));
        void save(() => crmApi.updateDeal(id, { funnelId }, ver('deal', id)), () => refreshLog(id), 'the funnel');
        flash('Funnel reassigned · lead moved to the first stage');
      },
      openLead: (id: string) => navigate(paths.lead(id)),
      /** By the backend contact id when there is one (CD-224): a clean URL, not the person id "<deal>:p". */
      openContact: (id: string) => navigate(paths.contact(personById(cur(), id)?.contactId ?? id)),
      openCompany: (id: string) => navigate(paths.company(id)),
      loadTemplates,
      ensureDocs,
      generateDoc,
      /** Generates from the dialog and keeps the dialog on that document. */
      generateInDialog: async (templateId: string) => {
        const leadId = cur().genLead;
        if (!leadId) return;
        const doc = await generateDoc(leadId, templateId);
        if (doc) set({ genDocId: doc.id });
      },
      downloadDoc: (doc: DealDoc) => docsApi.downloadDocument(doc).catch((err) => flash('Could not download: ' + errText(err), 7000)),
      deleteDoc: async (doc: DealDoc) => {
        try {
          await docsApi.deleteDocument(doc.id);
          set((x) => ({ dealDocs: { ...x.dealDocs, [doc.dealId]: (x.dealDocs[doc.dealId] || []).filter((d) => d.id !== doc.id) } }));
          flash(doc.name + ' deleted');
          void refreshLog(doc.dealId).catch(() => undefined);
          // Without its proposal, its approval, task and sent date are cleared (CD-120): read that deal back.
          if (doc.docType === 'Proposal') queueRefresh(['deals', 'tasks'], [], [doc.dealId], 0, { deals: [doc.dealId], tasks: [doc.dealId] });
        } catch (err) {
          flash('Could not delete the document: ' + errText(err), 7000);
        }
      },
      scanTemplate: (file: File) => docsApi.scan(file),
      /** The merge field reference (fetched once per session). */
      loadPlaceholders: () =>
        (placeholderRef.current ??= docsApi.placeholders().catch((err) => {
          placeholderRef.current = null;
          throw err;
        })),
      downloadTemplate: (t: DocTemplate) => docsApi.downloadTemplate(t).catch((err) => flash('Could not download: ' + errText(err), 7000)),
      downloadStarter: () => docsApi.downloadStarter().catch((err) => flash('Could not download: ' + errText(err), 7000)),
      /** Uploads a template (owners and admins); returns it, or throws with the API's reason. */
      uploadTemplate: async (file: File, name: string, docType: DocType) => {
        const t = await docsApi.createTemplate(file, name, docType);
        set((x) => ({ templates: [t, ...(x.templates || []).filter((y) => y.id !== t.id)] }));
        flash(`${t.name} saved`);
        refreshChecklist();
        return t;
      },
      deleteTemplate: async (t: DocTemplate) => {
        try {
          await docsApi.deleteTemplate(t.id);
          set((x) => ({ templates: (x.templates || []).filter((y) => y.id !== t.id) }));
          flash(`${t.name} deleted · documents made from it are kept`);
          refreshChecklist();
        } catch (err) {
          flash('Could not delete the template: ' + errText(err), 7000);
        }
      },
      openDoc: (leadId: string) => set({ docOpen: true, docLeadId: leadId }),
      markProposalSent,
      proposalApproval,
      uploadDocs,
      saveDealProducts,
      openDealProducts: (leadId: string) => set({ dealProductsId: leadId }),
      linkPerson,
      unlinkPerson,
      patchPerson,
      setPersonCompany,
      patchTask,
      completeTask,
      addTodo,
      renameExtra,
      removeExtra,
      advanceStage,
      setDocsComplete,
      remindStageOwner,
      markLost,
      reopenLead,
      addLeadTask,
      updateLeadTask,
      toggleLeadTask,
      removeLeadTask,
      canEditFunnels,
      addStage,
      moveStage,
      createFunnel,
      patchFunnel,
      deleteFunnel,
      editStage: (idx: number, key: 'name' | 'activity' | 'channel' | 'doc', val: string) => editStage(idx, (st) => void ((st as unknown as Record<string, string>)[key] = val)),
      /** Stage owner, target days and advance gates (CD-363). */
      setStageRule: (idx: number, patch: Partial<Pick<Stage, 'ownerId' | 'targetDays' | 'gateDocs' | 'gateTodos'>>) => editStage(idx, (st) => void Object.assign(st, patch)),
      editProb: (idx: number, raw: string) => editStage(idx, (st) => void (st.prob = raw === '' ? '' : Math.max(0, Math.min(100, Math.round(Number(raw) || 0))))),
      removeStage,
      addGate: (idx: number) =>
        editStage(
          idx,
          (st) => {
            let label = 'New to-do';
            for (let i = 2; st.checklist.includes(label); i++) label = 'New to-do ' + i;
            st.checklist.push(label);
            st.checklistIds.push(crypto.randomUUID());
          },
          true,
        ),
      renameGate: (idx: number, gi: number, val: string) => editStage(idx, (st) => void (st.checklist[gi] = val)),
      removeGate: (idx: number, gi: number) =>
        editStage(
          idx,
          (st) => {
            st.checklist.splice(gi, 1);
            st.checklistIds.splice(gi, 1);
          },
          true,
        ),
      setCompanyField,
      setCompanyOwner,
      /** Opens the New company dialog (CD-357): a company needs its name and PIB to exist. */
      addCompany: () => set({ newCompanyOpen: true }),
      /**
       * Creates a company from the New company dialog and opens it. A PIB already in the workspace
       * comes back as the existing company's id, so the dialog can offer to open that one instead.
       */
      createCompany: async (input: CompanyInput & { name: string; pib: string }): Promise<{ ok: true } | { ok: false; error: string; existingId?: string }> => {
        try {
          const created = await crmApi.createCompany(input);
          await reload();
          set({ newCompanyOpen: false });
          navigate(paths.company(created.id));
          flash(input.name + ' added as a lead');
          return { ok: true };
        } catch (err) {
          const existingId = err instanceof ApiError && err.status === 409 ? (err.body as { existingCompanyId?: string } | null)?.existingCompanyId : undefined;
          return { ok: false, error: errText(err), existingId };
        }
      },
      canDelete,
      createVisitPlan,
      setPlanLines,
      setPlanNote,
      deleteVisitPlan,
      deleteDeal,
      deleteCompany,
      setCompanyStatus,
      completeCompany,
      companyStatusHistory,
      deleteContact,

      // ---------------------------------------------------------- creating records
      /**
       * New deal; creates the company and the primary contact first when they are new. Opened from
       * the meeting form (CD-213), it stays there and the form picks the new deal.
       */
      createDeal: async (input: { company: { id: string; name: string }; contact: { contactId?: string; name: string } | null; segment: SegKey; saleType: SaleType; customFields?: CustomFieldPatch }) => {
        const funnelId = cur().funnels[input.segment]?.id;
        if (!funnelId) return;
        try {
          // Only an opportunity or a client (CD-360): the dialog offers no other, and the API checks it (409).
          const companyId = input.company.id;
          let primaryContactId = input.contact?.contactId;
          if (input.contact && !primaryContactId) primaryContactId = (await crmApi.createContact({ fullName: input.contact.name, companyId, buyerRole: 'Decision maker' })).id;
          const deal = await crmApi.createDeal({ title: input.company.name, funnelId, companyId, saleType: input.saleType, primaryContactId: primaryContactId ?? null, ...(input.customFields ? { customFields: input.customFields } : {}) });
          await reload();
          if (cur().newLeadForMeeting) {
            set({ newLeadOpen: false, newLeadCompanyId: null, newLeadContactId: null, newLeadForMeeting: false, newLeadMade: { companyId, dealId: deal.id }, segment: input.segment });
            flash(input.company.name + ' added · picked for the meeting');
            return;
          }
          set({ newLeadOpen: false, newLeadCompanyId: null, newLeadContactId: null, segment: input.segment });
          navigate(paths.lead(deal.id));
          flash(input.company.name + ' added · funnel assigned · first task due today');
        } catch (err) {
          flash('Not saved: ' + errText(err));
        }
      },
      /**
       * New contact at the company of the chosen lead, linked to that lead; or at `companyId` with no
       * deal. Returns its id (the meeting dialog adds it as a participant, CD-131), or null if not saved.
       */
      createContact: async (draft: NewContactDraft, leadId: string | undefined, customFields?: CustomFieldPatch, companyId?: string): Promise<string | null> => {
        const lead = companyId ? undefined : leadById(cur(), leadId);
        try {
          const c = await crmApi.createContact({
            fullName: draft.name,
            jobTitle: draft.role,
            email: draft.email,
            phone: draft.phone,
            linkedin: draft.linkedin,
            buyerRole: draft.buyerRole || null,
            notes: draft.notes,
            // The dialog's owner; without one the API makes whoever creates it the owner.
            ...(draft.ownerId ? { ownerUserId: draft.ownerId } : {}),
            companyId: companyId ?? lead?.companyId ?? null,
            ...(customFields ? { customFields } : {}),
          });
          if (lead) await crmApi.linkContact(lead.id, c.id);
          await reload();
          set({ contactOpen: false, contactCompanyId: null, contactDealId: '', newContact: EMPTY_CONTACT });
          flash(draft.name + (lead ? ' added to ' + lead.company : ' added'));
          return c.id;
        } catch (err) {
          flash('Not saved: ' + errText(err));
          return null;
        }
      },

      // ---------------------------------------------------------- getting started (CD-68)
      /** Hides the checklist for you (or shows it again); other admins decide for themselves. */
      setOnboardingDismissed: async (dismissed: boolean) => {
        try {
          const onboarding = await crmApi.setOnboardingDismissed(dismissed);
          set({ onboarding });
        } catch (err) {
          flash('Not saved: ' + errText(err));
        }
      },
      loadSampleData: async () => {
        try {
          await crmApi.loadSampleData();
          await reload();
          flash('Sample data loaded · remove it in one click when you are done');
        } catch (err) {
          flash('Sample data not loaded: ' + errText(err), 7000);
        }
      },
      removeSampleData: async () => {
        try {
          const { removed, kept } = await crmApi.removeSampleData();
          await reload();
          const n = removed.company + removed.contact + removed.product + removed.deal;
          const k = kept.company + kept.contact + kept.product + kept.deal;
          flash(`Sample data removed (${n} record${n === 1 ? '' : 's'})` + (k ? ` · ${k} kept because your own records use ${k === 1 ? 'it' : 'them'}` : ''), 7000);
        } catch (err) {
          flash('Sample data not removed: ' + errText(err), 7000);
        }
      },

      // ---------------------------------------------------------- team
      /** Creates an invitation, which the worker emails (CD-7), and returns its link to copy as a fallback. */
      inviteMember: async (email: string, role: 'admin' | 'member', names?: { firstName: string; lastName: string }): Promise<string | null> => {
        try {
          const { token } = await crmApi.invite(email, role, names);
          await reload();
          return `${window.location.origin}/invite/${token}`;
        } catch (err) {
          flash('Not invited: ' + errText(err));
          return null;
        }
      },
      /** Reloads only the team (the Team tab polls this while invitation emails are on their way). */
      refreshTeam: async () => {
        try {
          set({ team: mapTeam(await crmApi.team()) });
        } catch {
          // the next poll or reload tries again
        }
      },
      /** Emails a pending invitation again (same link, 7 more days). */
      resendInvitation: async (id: string) => {
        try {
          const row = await crmApi.resendInvitation(id);
          set((x) => ({ team: x.team.map((m) => (m.id === id ? { ...m, invite: { emailStatus: row.emailStatus, emailSentAt: row.emailSentAt, emailError: row.emailError, hasLink: row.hasLink } } : m)) }));
          flash('Sending the invitation to ' + row.email + ' again');
        } catch (err) {
          flash('Not resent: ' + errText(err), 7000);
        }
      },
      /** Copies a pending invitation's link to the clipboard, for when the email doesn't arrive. */
      copyInvitationLink: async (id: string): Promise<string | null> => {
        try {
          const { token } = await crmApi.invitationLink(id);
          const link = `${window.location.origin}/invite/${token}`;
          await navigator.clipboard.writeText(link).then(
            () => flash('Invite link copied. It works once, for the invited email address.'),
            () => flash('Invite link: ' + link, 12000),
          );
          return link;
        } catch (err) {
          flash('No link: ' + errText(err), 7000);
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
      /** Creates a product (id null) or saves one from the product dialog (CD-83). */
      saveProduct: async (id: string | null, draft: ProductDraft): Promise<boolean> => {
        const input: ProductInput = {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          unit: draft.unit.trim() || null,
          unitPrice: num(draft.price),
          quantity: num(draft.qty) || 1,
          vatRate: Math.min(100, num(draft.vat)),
          billingFrequency: draft.frequency,
          billingCycles: draft.frequency === 'one_time' ? null : draft.cycles,
        };
        try {
          const p = mapProduct(id ? await crmApi.updateProduct(id, input) : await crmApi.createProduct({ ...input, name: input.name! }));
          set((x) => ({ catalog: id ? x.catalog.map((c) => (c.id === id ? p : c)) : [...x.catalog, p] }));
          return true;
        } catch (err) {
          flash('Not saved: ' + errText(err));
          return false;
        }
      },
      removeProduct: (id: string) => {
        set((x) => ({ catalog: x.catalog.filter((k) => k.id !== id) }));
        void save(() => crmApi.deleteProduct(id), undefined, 'removing the product');
      },
      openProduct: (id: string | null) => set({ productOpen: true, productEditId: id }),

      // ---------------------------------------------------------- custom fields (CD-15)
      /** Owners and admins define custom fields; everyone fills them in. */
      canEditFields: canEditFunnels,
      /** Sets a custom field value on a deal, company or contact; saved after a pause (one write per field). */
      setCustomValue: (entity: CustomFieldEntity, recordId: string, field: CustomFieldDef, value: CustomValue | null) => {
        set((x) => {
          const values = { ...(x.customValues[entity][recordId] || {}) };
          if (value === null || value === '') delete values[field.id];
          else values[field.id] = value;
          return { customValues: { ...x.customValues, [entity]: { ...x.customValues[entity], [recordId]: values } } };
        });
        const body = { customFields: { [field.id]: customValueForApi(field.type, value) } };
        const write = entity === 'deal' ? () => crmApi.updateDeal(recordId, body) : entity === 'company' ? () => crmApi.updateCompany(recordId, body) : () => crmApi.updateContact(recordId, body);
        saveLater(`custom:${recordId}:${field.id}`, write, field.label);
      },
      createCustomField: async (draft: { entity: CustomFieldEntity; label: string; type: CustomFieldType; required: boolean; options: string[] }): Promise<boolean> => {
        try {
          const f = await crmApi.createCustomField({ entity: draft.entity, label: draft.label.trim(), type: draft.type, required: draft.required, ...(draft.type === 'select' ? { options: draft.options.map((label) => ({ label })) } : {}) });
          set((x) => ({ customFields: [...x.customFields, mapCustomField(f)] }));
          return true;
        } catch (err) {
          flash('Not saved: ' + errText(err));
          return false;
        }
      },
      /** Renames a field (after a pause), or changes its options or whether it is required. */
      updateCustomField: (id: string, patch: { label?: string; required?: boolean; options?: { id?: string; label: string }[] }) => {
        const f = cur().customFields.find((x) => x.id === id);
        if (!f) return;
        set((x) => ({ customFields: x.customFields.map((y) => (y.id === id ? { ...y, ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.required !== undefined ? { required: patch.required } : {}) } : y)) }));
        if (patch.label !== undefined) {
          if (patch.label.trim()) saveLater('field-label:' + id, () => crmApi.updateCustomField(id, { label: patch.label!.trim() }), 'the field name');
          return;
        }
        void save(
          async () => {
            const row = await crmApi.updateCustomField(id, { ...(patch.required !== undefined ? { required: patch.required } : {}), ...(patch.options ? { options: patch.options } : {}) });
            set((x) => ({ customFields: x.customFields.map((y) => (y.id === id ? { ...mapCustomField(row), label: y.label } : y)) }));
          },
          undefined,
          patch.options ? 'the options of ' + f.label : f.label,
        );
      },
      /** Moves a field one place up (-1) or down (+1) among the fields of its record type. */
      moveCustomField: (id: string, dir: -1 | 1) => {
        const f = cur().customFields.find((x) => x.id === id);
        if (!f) return;
        const list = customFieldsOf(cur(), f.entity);
        const i = list.findIndex((x) => x.id === id);
        const j = i + dir;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j]!, list[i]!];
        set((x) => ({ customFields: [...x.customFields.filter((y) => y.entity !== f.entity), ...list] }));
        void save(() => crmApi.reorderCustomFields(f.entity, list.map((x) => x.id)), undefined, 'the field order');
      },
      /** Hides a field everywhere (its values are kept in the records, unseen). */
      deleteCustomField: (id: string) => {
        const f = cur().customFields.find((x) => x.id === id);
        if (!f) return;
        cancelSaves(id);
        set((x) => ({ customFields: x.customFields.filter((y) => y.id !== id) }));
        void save(() => crmApi.deleteCustomField(id), undefined, 'deleting ' + f.label);
        flash(f.label + ' deleted');
      },

      // ---------------------------------------------------------- sales bonuses (CD-17)
      /** Only owners and admins see and set the bonus rules; the API returns 403 to members. */
      canSeeBonuses: canEditFunnels,
      setBonusTrigger: (trigger: string) => {
        set({ bonusTrigger: trigger });
        void save(() => crmApi.updateBonusSettings(trigger), undefined, 'when bonuses are earned');
      },
      /** Edits one number of a salesperson's rule; the whole rule is saved after a pause. */
      setBonusRule: (userId: string, key: keyof BonusRule, v: string) => {
        set((x) => {
          const saved = x.bonusRules?.[userId] ?? { rate: '', floor: '', fixed: '' };
          return { bonusRules: { ...(x.bonusRules ?? {}), [userId]: { ...saved, [key]: v } } };
        });
        saveLater(
          'bonus:' + userId,
          async () => {
            const r = cur().bonusRules?.[userId];
            if (!r) return;
            const saved = await crmApi.putBonusRule(userId, { rate: Math.min(100, num(r.rate)), floor: num(r.floor), fixed: num(r.fixed) });
            // Keep what is still being typed for this person; take the stored rules for everyone else.
            const stored = mapBonusRules(saved);
            set((x) => ({ bonusRules: { ...stored, [userId]: x.bonusRules?.[userId] ?? stored[userId]! } }));
          },
          'the bonus rule',
        );
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
      /**
       * Renames projects and tasks (CD-143, owners and admins): all four names at once. Returns the
       * API's field errors ({ task: '…' }) when it refuses them, else null.
       */
      saveTerms: async (terms: WorkspaceTerms): Promise<Partial<Record<keyof WorkspaceTerms, string>> | null> => {
        try {
          const ws = await crmApi.updateWorkspace({ terms });
          set((x) => ({ workspace: { ...x.workspace, terms: ws.terms } }));
          return null;
        } catch (err) {
          const issues = err instanceof ApiError ? ((err.body as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? []) : [];
          const out: Partial<Record<keyof WorkspaceTerms, string>> = {};
          for (const i of issues) {
            const key = i.path.split('.').pop() as keyof WorkspaceTerms;
            if (key in terms) out[key] = i.message;
          }
          return Object.keys(out).length ? out : { project: errText(err) };
        }
      },
      /** Saves the company details (CD-167, owners and admins); returns the API's message when it refuses them, else null. */
      saveCompany: async (company: Partial<ApiCompanyDetails>): Promise<string | null> => {
        try {
          const ws = await crmApi.updateWorkspace({ company });
          set((x) => ({ workspace: { ...x.workspace, company: ws.company } }));
          return null;
        } catch (err) {
          return errText(err);
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

  // Live updates (CD-20): the workspace's change stream, and a refresh when the window gets focus.
  // Connected once per workspace: `actions` is rebuilt on navigation (useNavigate changes), so the
  // handlers are reached through a ref instead of reconnecting (and dropping queued refreshes).
  const liveRef = useRef(actions.live);
  liveRef.current = actions.live;
  useEffect(() => {
    const live = {
      onEvent: (e: LiveEvent) => liveRef.current.onEvent(e),
      refreshAll: () => liveRef.current.refreshAll(),
      onFocus: () => liveRef.current.onFocus(),
    };
    const pending = livePending.current;
    const mounted = Date.now();
    const stop = connectLive({
      onEvent: live.onEvent,
      // After a drop, hints may be missing: read everything. The first connect only needs that if
      // the workspace was loaded a while before the stream was up.
      onOpen: (first) => {
        // Says the stream is up (the e2e tests wait for it; handy when debugging).
        document.documentElement.dataset.live = 'on';
        if (!first || Date.now() - mounted > 3000) live.refreshAll();
      },
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') live.onFocus();
    };
    window.addEventListener('focus', live.onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop();
      delete document.documentElement.dataset.live;
      clearTimeout(pending.timer);
      window.removeEventListener('focus', live.onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // The planned meetings of the coming year stay loaded: a deal with one has a next step (CD-130).
  const watchMeetings = useRef(actions.meetings.watch);
  watchMeetings.current = actions.meetings.watch;
  useEffect(() => {
    const q = upcomingQuery();
    return watchMeetings.current(meetingKey(q), q);
  }, []);

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
