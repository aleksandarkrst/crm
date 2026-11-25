import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { FilterEmpty, FilterRow } from '../components/FilterRow';
import { Icon } from '../components/icons';
import { Screen } from '../components/Layout';
import { deviceTimeZone } from '../lib/timeZones';
import { filterPeople, type FilterTask, taskFields } from '../store/filterFields';
import { applyFilters, clearAll, type FilterValue } from '../store/filters';
import { CHANNEL_LABELS } from '../store/seed';
import { leadById, opportunityName, stageOf, stagesFor } from '../store/selectors';
import { useStore } from '../store/store';
import { addDays, datesRange, dayRange, instantToZoned, todayIn } from '../store/time';
import { APPROVAL_TASK_TITLE, dueTag, type DueTone, groupOf, leftText, minutesSuggestion, tickedToday, TODAY_GROUPS, type TodayGroup } from '../store/today';
import { usePageFilters } from '../store/usePageFilters';
import { useMeetingList } from '../store/useMeetings';
import { paths } from '../lib/paths';
import type { Lead } from '../store/types';
interface TodayRow extends FilterTask {
  id: string;
  leadId: string;
  /** "[opportunity], [company]" under the title. */
  where: string;
  group: TodayGroup;
  tag: { text: string; tone: DueTone };
  /** Set for to-dos (they can be ticked); the stage's next step has none. */
  taskId?: string;
  approval: boolean;
  /** Sorts a group: approvals first, then by due date, the stage steps last. */
  rank: string;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const whereOf = (l: Lead) => (l.title?.trim() ? `${opportunityName(l)}, ${l.company}` : l.company);

/**
 * Today (CD-532, board C-Today): your to-do list for the day, with today's meetings beside it.
 * Late, Today and After the win hold the to-dos (from New task, minutes and approval requests) and
 * each open opportunity's next stage step; a ticked to-do stays struck through until the day ends,
 * also after a reload. "Today" is your own day: this device's time zone, else the workspace's.
 * Without the Salesperson filter (in + Filter) it shows your own to-dos and meetings.
 */
export function Today() {
  const { s, set, toggleLeadTask, session } = useStore();
  const me = session.userId;
  const tz = deviceTimeZone() ?? s.workspace.timezone;
  const today = todayIn(tz);
  const [saved, setSaved] = usePageFilters('today', { order: ['due', 'company'], f: {} });
  // Adding Salesperson starts it at you, so the list doesn't jump to everyone's to-dos.
  const setFilters = (v: FilterValue) => setSaved(v.order.includes('owner') && !saved.order.includes('owner') && !v.f.owner?.vals?.length ? { ...v, f: { ...v.f, owner: { op: 'is', vals: [me] } } } : v);
  const byOwner = saved.order.includes('owner');
  const owners = byOwner ? (saved.f.owner?.vals ?? []) : [me];

  // Meetings today: yours as organizer or internal participant, or the chosen salespeople's.
  const range = useMemo(() => dayRange(today, tz), [today, tz]);
  const many = owners.length > 1;
  const { meetings: dayMeetings } = useMeetingList({ from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString(), userId: many ? undefined : (owners[0] ?? me), status: ['planned', 'held'], sort: 'asc' });
  const meetings = many ? dayMeetings.filter((m) => owners.includes(m.organizerUserId ?? '') || m.participants.some((p) => p.kind === 'internal' && !!p.userId && owners.includes(p.userId))) : dayMeetings;
  const now = Date.now();
  const nextId = meetings.find((m) => Date.parse(m.endsAt) > now)?.id;

  // Pultly suggests: your meetings of the last seven days that were held without minutes.
  const lastWeek = useMemo(() => datesRange(addDays(today, -7), addDays(today, -1), tz), [today, tz]);
  const { meetings: noMinutes } = useMeetingList({ from: new Date(lastWeek.from).toISOString(), to: new Date(lastWeek.to).toISOString(), userId: me, status: ['held'], missingMinutes: true, sort: 'asc' });
  const suggestion = minutesSuggestion(noMinutes.length);

  // To-dos: open ones, plus those ticked today (they stay in their place until the day ends).
  const taskRows = s.leadTasks.flatMap<TodayRow>((t) => {
    const lead = leadById(s, t.leadId);
    if (!lead || (t.done && !tickedToday(t, today, tz))) return [];
    const dueIso = t.due || today;
    const approval = t.title === APPROVAL_TASK_TITLE && t.channel === 'NT';
    return [
      {
        id: t.id,
        taskId: t.id,
        leadId: t.leadId,
        title: t.title,
        where: whereOf(lead),
        group: groupOf({ dueIso, won: lead.outcome === 'won', approval }, today),
        tag: dueTag(dueIso, today, t.done),
        approval,
        rank: (approval ? '0' : '1') + dueIso,
        stageName: stagesFor(s, lead.segment).find((x) => x.id === t.stageId)?.name ?? stageOf(s, lead).name,
        channelLabel: CHANNEL_LABELS[t.channel] || t.channel,
        ownerId: t.ownerId || null,
        companyId: lead.companyId ?? null,
        dueIso,
        note: t.note,
        done: t.done,
      },
    ];
  });
  // Each open opportunity's next stage step (CD-478: Won and Lost ones have none): due today once it
  // has been quiet for a day, else tomorrow. It can't be ticked; doing the step moves the stage.
  const stepRows = s.leads
    .filter((l) => l.outcome === 'open')
    .map<TodayRow>((l) => {
      const st = stageOf(s, l);
      const dueIso = l.stall > 0 ? today : addDays(today, 1);
      return {
        id: 'step:' + l.id,
        leadId: l.id,
        title: st.activity,
        where: whereOf(l),
        group: 'today',
        tag: dueTag(dueIso, today),
        approval: false,
        rank: '2' + dueIso,
        stageName: st.name,
        channelLabel: CHANNEL_LABELS[st.channel] || st.channel,
        ownerId: l.ownerId ?? null,
        companyId: l.companyId ?? null,
        dueIso,
        note: '',
        done: false,
      };
    });
  const allRows = [...taskRows, ...stepRows].filter((r) => byOwner || r.ownerId === me);
  const fields = taskFields(s, allRows);
  const rows = applyFilters(allRows, fields, saved, { today, fiscalMonth: s.workspace.fiscalMonth });
  const groups = TODAY_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.group === g.id).sort((a, b) => a.rank.localeCompare(b.rank)) })).filter((g) => g.rows.length > 0);
  const open = rows.filter((r) => !r.done).length;
  const noMatch = allRows.length > 0 && rows.length === 0;
  const dateText = new Date(Date.parse(today + 'T12:00:00Z')).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace(/^(\w+) /, '$1, ');

  return (
    <Screen title="Today">
      <div className="td" data-testid="today">
        <div className="td-head">
          <span className="td-summary" data-testid="today-summary">
            {dateText}, {leftText(open)}
          </span>
          <button type="button" className="gs-btn primary td-new" data-testid="today-new-todo" onClick={() => set({ taskOpen: true, taskEditId: null, taskQuick: true })}>
            Add task
          </button>
        </div>
        <div className="ov-fbar">
          <FilterRow fields={fields} value={saved} onChange={setFilters} people={filterPeople(s, me)} me={me} />
          <span className="ov-count" data-testid="today-count">
            {plural(rows.length, 'to-do')} in view
          </span>
        </div>

        {s.leads.length === 0 ? (
          <EmptyState title="Nothing to do yet" text="Today fills itself from your opportunities: each opportunity's next step in the funnel, plus the to-dos you add. Start with an opportunity." action={{ label: 'New opportunity', onClick: () => set({ newLeadOpen: true }) }} />
        ) : (
          <div className="td-cols">
            <div className="td-main">
              {noMatch ? (
                <FilterEmpty noun="to-dos" onClear={() => setSaved(clearAll(fields))} />
              ) : groups.length === 0 ? (
                <section className="gs-glass td-card">
                  <div className="td-empty" data-testid="today-empty">
                    Nothing to do today. New to-dos show up here.
                  </div>
                </section>
              ) : (
                groups.map((g) => (
                  <section key={g.id} className="gs-glass td-card" data-group={g.title}>
                    <div className="td-card-head">
                      <h2>{g.title}</h2>
                      <span className="ov-sub">{g.sub}</span>
                    </div>
                    {g.rows.map((r) => (
                      <div key={r.id} className={'td-row' + (r.done ? ' done' : '')} data-task={r.taskId}>
                        {r.taskId ? (
                          <button type="button" role="checkbox" aria-checked={r.done} aria-label={r.title} className={'td-check' + (r.done ? ' on' : '')} onClick={() => toggleLeadTask(r.taskId!, { undo: true })}>
                            <Icon name="check" size={13} />
                          </button>
                        ) : (
                          <span className="td-step" title="The stage's next step: doing it moves the opportunity on" aria-hidden />
                        )}
                        <span className="td-text">
                          <span className="td-title">{r.title}</span>
                          <Link to={paths.lead(r.leadId)} className="td-where">
                            {r.where}
                          </Link>
                        </span>
                        {r.approval && !r.done && (
                          <Link to={paths.lead(r.leadId, 'docs')} className="gs-btn small" data-testid="today-review">
                            Review
                          </Link>
                        )}
                        <span className={'td-tag ' + r.tag.tone}>{r.tag.text}</span>
                      </div>
                    ))}
                  </section>
                ))
              )}
            </div>

            <div className="td-side">
              <section className="gs-glass td-card" data-testid="meetings-today">
                <div className="td-card-head">
                  <h2>Meetings today</h2>
                  <Link to={paths.calendar()} className="td-link">
                    All meetings
                  </Link>
                </div>
                {meetings.length === 0 ? (
                  <div className="td-empty">No meetings today.</div>
                ) : (
                  meetings.map((m) => {
                    const contact = m.participants.find((p) => p.kind === 'external')?.name;
                    const sub = [m.location, contact].filter(Boolean).join(', ');
                    return (
                      <Link key={m.id} to={paths.meeting(m.id)} className="td-row td-meeting" data-meeting-id={m.id}>
                        <b className={'td-time' + (m.id === nextId ? ' next' : '')}>{instantToZoned(m.startsAt, tz).time}</b>
                        <span className="td-text">
                          <b className="td-meeting-title">
                            {m.title}, {m.companyName}
                          </b>
                          {sub && <span className="ov-sub">{sub}</span>}
                        </span>
                      </Link>
                    );
                  })
                )}
              </section>

              {suggestion && noMinutes[0] && (
                <section className="td-suggest" data-testid="pultly-suggests">
                  <span className="td-suggest-label">Pultly suggests</span>
                  <b className="td-suggest-text">{suggestion}</b>
                  <Link to={paths.meeting(noMinutes[0].id)} className="td-suggest-btn">
                    Write the minutes
                  </Link>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
