import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { FilterBar } from '../components/ui';
import { type ApiVisitTotals, crmApi } from '../lib/api';
import { paths } from '../lib/paths';
import { VisitPlanDialog } from '../modals/VisitPlanDialog';
import { memberName } from '../store/selectors';
import { useStore } from '../store/store';
import { canCreatePlans, completionLabel, paceOf } from '../store/visitPlans';
import { useVisitProgress } from '../store/useVisitProgress';

const ANY_PERIOD = 'Period';
const ANY_PERSON = 'Salesperson';
const COLS = 'minmax(0,1.4fr) minmax(0,1.4fr) 0.8fr 0.9fr 0.7fr 0.8fr';

/** The totals of these plans, by plan id (in requests of up to 200 plans). */
async function loadTotals(ids: string[]): Promise<Map<string, ApiVisitTotals>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  const parts = await Promise.all(chunks.map((c) => crmApi.visitPlansProgress(c)));
  return new Map(parts.flat().map((p) => [p.planId, p.totals]));
}

/**
 * Customer visit plans (CD-134): one row per plan. Owners and admins see everyone's and make new
 * ones; managers see their reports' and make their direct reports' (CD-142); members see their own. Held visits (counted toward the plan: at most the planned number
 * per customer) and completion, coloured by pace (CD-135, spec 9.2), stay current as visits are held.
 */
export function VisitPlans() {
  const { s } = useStore();
  const seesTeam = s.visitScope.seesTeam;
  const canCreate = canCreatePlans(s.visitScope);
  const navigate = useNavigate();
  const [period, setPeriod] = useState(ANY_PERIOD);
  const [person, setPerson] = useState(ANY_PERSON);
  const [creating, setCreating] = useState(false);

  const periods = new Map<string, string>();
  for (const p of s.visitPlans) periods.set(`${p.periodType}:${p.periodStart}`, p.periodLabel);
  const people = new Map<string, string>();
  for (const p of s.visitPlans) people.set(p.salespersonUserId, memberName(s, p.salespersonUserId, p.salespersonName));
  const rows = s.visitPlans.filter((p) => (period === ANY_PERIOD || `${p.periodType}:${p.periodStart}` === period) && (person === ANY_PERSON || p.salespersonUserId === person));
  const open = (id: string) => navigate(paths.visitPlan(id));
  const ids = rows.map((p) => p.id);
  const { data: totals } = useVisitProgress(ids.length ? 'list:' + [...ids].sort().join(',') : null, () => loadTotals(ids));

  return (
    <Screen title="Visit plans">
      <FilterBar
        chips={[
          { value: period, options: [ANY_PERIOD, ...[...periods].map(([value, label]) => ({ value, label }))], onChange: setPeriod },
          // Members only have their own plans: no salesperson to pick.
          ...(seesTeam ? [{ value: person, options: [ANY_PERSON, ...[...people].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))], onChange: setPerson }] : []),
        ]}
        dirty={period !== ANY_PERIOD || person !== ANY_PERSON}
        onClear={() => {
          setPeriod(ANY_PERIOD);
          setPerson(ANY_PERSON);
        }}
        meta={rows.length === 1 ? '1 plan' : `${rows.length} plans`}
        action={canCreate ? { label: 'New plan', onClick: () => setCreating(true) } : undefined}
      />
      {s.visitPlans.length === 0 ? (
        canCreate ? (
          <EmptyState
            testId="visit-plans-empty"
            title="No visit plans yet"
            text="A visit plan says which customers a salesperson should visit in a month, and how often. A quarter adds up its three months. The salesperson gets an email with their plan."
            action={{ label: 'New plan', onClick: () => setCreating(true) }}
          />
        ) : (
          <EmptyState testId="visit-plans-empty" title="No visit plans for you yet" text="When your manager, an owner or an admin makes a visit plan for you, it shows here, and you get an email with it." />
        )
      ) : (
        <div className="card vp-list">
          <div className="table-head vp-list-head" style={{ gridTemplateColumns: COLS }}>
            {['Salesperson', 'Period', 'Customers', 'Planned visits', 'Held', 'Completion'].map((h) => (
              <span key={h} className="th">
                {h}
              </span>
            ))}
          </div>
          {rows.length === 0 && <div className="empty-state">No plans match these filters.</div>}
          {rows.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              data-testid="visit-plan-row"
              className="table-row clickable vp-list-row"
              style={{ gridTemplateColumns: COLS, alignItems: 'center' }}
              onClick={() => open(p.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(p.id))}
            >
              <span className="vp-cell-name" style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {memberName(s, p.salespersonUserId, p.salespersonName)}
              </span>
              <span className="vp-cell-period" style={{ fontSize: 13 }}>
                {p.periodLabel}
              </span>
              <span className="vp-cell" data-label="Customers" style={{ fontSize: 13 }}>
                {p.lines.length}
              </span>
              <span className="vp-cell" data-label="Planned" style={{ fontSize: 13 }} data-testid="visit-plan-total">
                {p.totalPlanned}
              </span>
              <PlanTotals totals={totals?.get(p.id)} />
            </div>
          ))}
        </div>
      )}
      {creating && <VisitPlanDialog onClose={() => setCreating(false)} />}
    </Screen>
  );
}

/** Held visits and completion of one plan in the list; "…" while counting. */
function PlanTotals({ totals: t }: { totals: ApiVisitTotals | undefined }) {
  if (!t) {
    return (
      <>
        <span className="vp-cell" data-label="Held" style={{ fontSize: 13, color: 'var(--muted)' }}>
          …
        </span>
        <span className="vp-cell" data-label="Completion" style={{ fontSize: 13, color: 'var(--muted)' }}>
          …
        </span>
      </>
    );
  }
  const pace = paceOf(t);
  return (
    <>
      <span className="vp-cell" data-label="Held" style={{ fontSize: 13 }} data-testid="visit-plan-held" title={t.overPlan ? `${t.held} held, ${t.overPlan} over plan` : undefined}>
        {t.heldCapped}
        {t.overPlan > 0 && <span className="vp-over"> +{t.overPlan}</span>}
      </span>
      <span className="vp-cell" data-label="Completion" style={{ fontSize: 13 }}>
        <span className={pace.className} title={pace.title} data-testid="visit-plan-completion" data-pace={t.pace}>
          {completionLabel(t.completion)}
        </span>
      </span>
    </>
  );
}
