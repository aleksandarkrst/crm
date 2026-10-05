import { useState } from 'react';
import { Link } from 'react-router-dom';
import { crmApi, type VisitPlanPeriodType } from '../lib/api';
import { paths } from '../lib/paths';
import { memberLabels } from '../store/selectors';
import { useStore } from '../store/store';
import { todayIn } from '../store/time';
import { useVisitProgress } from '../store/useVisitProgress';
import { completionLabel, paceOf, periodOptions, periodStartOf, seesPlansOf } from '../store/visitPlans';

const selectStyle = { border: '1px solid var(--border)', background: 'var(--white)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, color: 'var(--ink)' };

/**
 * "Visit-plan progress" on Overview (CD-135, spec 9.2): planned visits, held visits (counted toward
 * the plan) and completion for a month or quarter of its own choosing, not the dashboard's closing
 * period. Members see their own and open their plan; owners and admins see the team or one
 * salesperson and open the report with the same choice. Same numbers as the plan pages and Reports.
 */
export function VisitProgressCard() {
  const { s } = useStore();
  // Owners, admins and managers (their reports, CD-142) see the team; members their own.
  const isManager = s.visitScope.seesTeam;
  const today = todayIn(s.workspace.timezone);
  const fiscal = s.workspace.fiscalMonth;
  const [periodType, setPeriodType] = useState<VisitPlanPeriodType>('month');
  const [periodStart, setPeriodStart] = useState(() => periodStartOf('month', today, fiscal));
  const [person, setPerson] = useState('all');
  const who = isManager ? person : 'me';
  const { data } = useVisitProgress(['summary', periodType, periodStart, who].join(':'), () =>
    crmApi.visitSummary({ periodType, periodStart, all: who === 'all', salespersonUserId: who !== 'all' && who !== 'me' ? who : undefined }),
  );
  const shown = data && data.periodStart === periodStart && data.periodType === periodType ? data : undefined;
  const people = [...memberLabels(s)].filter(([id]) => seesPlansOf(s.visitScope, id)).sort((a, b) => a[1].localeCompare(b[1]));
  const pace = shown ? paceOf(shown) : null;
  // A quarter adds up monthly plans (CD-212): "Open my plan" opens this month's, else the first.
  const thisMonth = periodStartOf('month', today, fiscal);
  const ownPlan = shown?.plans.find((p) => p.periodStart === thisMonth) ?? shown?.plans[0];

  return (
    <div className="card" data-testid="visit-progress-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span className="card-title">Visit-plan progress</span>
          <span className="card-sub">
            Held Customer visits against the visit plans{isManager ? '' : ' you have'}
            {periodType === 'quarter' ? ' (the sum of the monthly plans)' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select
            aria-label="Plan period type"
            data-testid="visit-progress-type"
            value={periodType}
            style={selectStyle}
            onChange={(e) => {
              const type = e.target.value as VisitPlanPeriodType;
              setPeriodType(type);
              setPeriodStart(periodStartOf(type, today, fiscal));
            }}
          >
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
          </select>
          <select aria-label="Plan period" data-testid="visit-progress-period" value={periodStart} style={selectStyle} onChange={(e) => setPeriodStart(e.target.value)}>
            {periodOptions(periodType, today, fiscal, 12, 3).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {isManager && (
            <select aria-label="Salesperson" data-testid="visit-progress-person" value={person} style={selectStyle} onChange={(e) => setPerson(e.target.value)}>
              <option value="all">Whole team</option>
              {people.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {!shown ? (
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Counting visits…</span>
      ) : shown.planned === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--text-2)' }} data-testid="visit-progress-empty">
          No visit plan for {shown.periodLabel}
          {isManager && who !== 'all' ? ' for this salesperson' : ''}.
        </span>
      ) : (
        <>
          <div className="vp-card-stats">
            <div className="vp-card-stat">
              <span className="caps">Planned visits</span>
              <span className="display" style={{ fontSize: 26, lineHeight: 1 }} data-testid="visit-progress-planned">
                {shown.planned}
              </span>
            </div>
            <div className="vp-card-stat">
              <span className="caps">Held</span>
              <span className="display" style={{ fontSize: 26, lineHeight: 1 }} data-testid="visit-progress-held">
                {shown.heldCapped}
              </span>
            </div>
            <div className="vp-card-stat">
              <span className="caps">Completion</span>
              <span className={pace!.className} title={pace!.title} style={{ fontSize: 15 }} data-testid="visit-progress-completion" data-pace={shown.pace}>
                {completionLabel(shown.completion)}
              </span>
            </div>
          </div>
          <div className={shown.pace === 'behind' ? 'vp-progress-bar behind' : 'vp-progress-bar'} aria-hidden>
            <span style={{ width: `${Math.round(shown.completion * 100)}%` }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {shown.upcoming} upcoming · {shown.notClosed} not closed
            {shown.overPlan ? ` · +${shown.overPlan} over plan` : ''}
            {shown.unplanned ? ` · ${shown.unplanned} unplanned` : ''}
          </span>
        </>
      )}
      <div>
        {isManager ? (
          <Link to={paths.reports('visit-plans', { periodType, periodStart, salesperson: who !== 'all' ? who : null })} className="crumb-link" data-testid="visit-progress-report">
            Open the report
          </Link>
        ) : ownPlan ? (
          <Link to={paths.visitPlan(ownPlan.id)} className="crumb-link" data-testid="visit-progress-plan">
            Open my plan
          </Link>
        ) : null}
      </div>
    </div>
  );
}
