import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { FilterBar } from '../components/ui';
import { paths } from '../lib/paths';
import { VisitPlanDialog } from '../modals/VisitPlanDialog';
import { memberName } from '../store/selectors';
import { useStore } from '../store/store';

const ANY_PERIOD = 'Period';
const ANY_PERSON = 'Salesperson';
const COLS = 'minmax(0,1.4fr) minmax(0,1.4fr) 0.8fr 0.9fr 0.7fr 0.8fr';

/**
 * Customer visit plans (CD-134): one row per plan. Owners and admins see everyone's and make new
 * ones; members see their own. Held visits and completion come with visit tracking (CD-135) and
 * show "—" until then.
 */
export function VisitPlans() {
  const { s, canDelete: canManage } = useStore();
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

  return (
    <Screen title="Visit plans">
      <FilterBar
        chips={[
          { value: period, options: [ANY_PERIOD, ...[...periods].map(([value, label]) => ({ value, label }))], onChange: setPeriod },
          // Members only have their own plans: no salesperson to pick.
          ...(canManage ? [{ value: person, options: [ANY_PERSON, ...[...people].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))], onChange: setPerson }] : []),
        ]}
        dirty={period !== ANY_PERIOD || person !== ANY_PERSON}
        onClear={() => {
          setPeriod(ANY_PERIOD);
          setPerson(ANY_PERSON);
        }}
        meta={rows.length === 1 ? '1 plan' : `${rows.length} plans`}
        action={canManage ? { label: 'New plan', onClick: () => setCreating(true) } : undefined}
      />
      {s.visitPlans.length === 0 ? (
        canManage ? (
          <EmptyState
            testId="visit-plans-empty"
            title="No visit plans yet"
            text="A visit plan says which customers a salesperson should visit in a month or quarter, and how often. The salesperson gets an email with their plan."
            action={{ label: 'New plan', onClick: () => setCreating(true) }}
          />
        ) : (
          <EmptyState testId="visit-plans-empty" title="No visit plans for you yet" text="When an owner or admin makes a visit plan for you, it shows here, and you get an email with it." />
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
              {/* CD-135: held visits and completion % come with visit tracking. */}
              <span className="vp-cell" data-label="Held" style={{ fontSize: 13, color: 'var(--muted)' }} title="Counted once visit tracking is on">
                —
              </span>
              <span className="vp-cell" data-label="Completion" style={{ fontSize: 13, color: 'var(--muted)' }} title="Counted once visit tracking is on">
                —
              </span>
            </div>
          ))}
        </div>
      )}
      {creating && <VisitPlanDialog onClose={() => setCreating(false)} />}
    </Screen>
  );
}
