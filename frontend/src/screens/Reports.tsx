import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen } from '../components/Layout';
import { FilterBar } from '../components/ui';
import { type ApiVisitReport, type ApiVisitReportRow, type ApiVisitRowTotals, type ApiVisitTotals, crmApi, type VisitPlanPeriodType } from '../lib/api';
import { datedName, downloadText, toCsv } from '../lib/csv';
import { paths } from '../lib/paths';
import { companyLabels, companyRecords, memberLabels } from '../store/selectors';
import { useStore } from '../store/store';
import { todayIn } from '../store/time';
import { useVisitProgress } from '../store/useVisitProgress';
import { completionLabel, paceOf, periodOptions, periodStartOf, seesPlansOf, type VisitCount, visitsInCalendar } from '../store/visitPlans';

const TABS = [{ value: 'visit-plans', label: 'Visit-plan completion' }] as const;
const COLS = 'minmax(0,1.5fr) minmax(0,1.2fr) 0.7fr 0.7fr 0.8fr 0.8fr 0.9fr 0.8fr 0.8fr';
const ANY_PERSON = 'Salesperson';
const ANY_CUSTOMER = 'Customer';

/**
 * Reports (CD-135), for owners and admins. "Visit-plan completion": per salesperson, for a month
 * or fiscal quarter (the sum of its three monthly plans, CD-212), the planned visits, the held ones (completion caps each customer at its plan),
 * upcoming, not closed, unplanned and over-plan visits; filtered by salesperson and customer (the
 * customer filter shows how often that customer was visited, across salespeople). Every count opens
 * the Calendar's table with exactly the meetings behind it (CD-211); plans open their page. The filters live in the URL,
 * and the filtered table exports as CSV. Numbers come from the same counting as the plan pages.
 */
export function Reports() {
  const { s } = useStore();
  // Owners and admins: everyone; managers: themselves and their reports (CD-142).
  const isManager = s.visitScope.seesTeam;
  const { tab = 'visit-plans' } = useParams();
  const [params, setParams] = useSearchParams();
  const today = todayIn(s.workspace.timezone);
  const fiscal = s.workspace.fiscalMonth;

  const periodType: VisitPlanPeriodType = params.get('periodType') === 'quarter' ? 'quarter' : 'month';
  const options = periodOptions(periodType, today, fiscal, 12, 3);
  const requested = params.get('periodStart');
  const periodStart = requested && options.some((o) => o.value === requested) ? requested : periodStartOf(periodType, today, fiscal);
  const salesperson = params.get('salesperson') ?? '';
  const company = params.get('company') ?? '';
  const key = isManager ? ['report', periodType, periodStart, salesperson, company].join(':') : null;
  const { data: report, error } = useVisitProgress(key, () => crmApi.visitReport({ periodType, periodStart, salespersonUserId: salesperson || undefined, companyId: company || undefined }));

  if (!isManager) return <Navigate to="/" replace />;
  if (!TABS.some((t) => t.value === tab)) return <Navigate to={paths.reports()} replace />;

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  const people = [...memberLabels(s)].filter(([id]) => seesPlansOf(s.visitScope, id)).sort((a, b) => a[1].localeCompare(b[1]));
  const records = companyRecords(s);
  const companyNames = companyLabels(records);
  const customers = records.map((c) => ({ value: c.id, label: companyNames.get(c.id) ?? c.name })).sort((a, b) => a.label.localeCompare(b.label));
  const shown = report && report.periodStart === periodStart && report.periodType === periodType ? report : undefined;

  const exportCsv = () => {
    if (!shown) return;
    type Row = ApiVisitTotals & { name: string };
    const rows: Row[] = [...shown.rows.map((r) => ({ ...r, name: r.salespersonName })), { ...shown.totals, name: 'Total' }];
    const csv = toCsv<Row>(rows, [
      { header: 'Salesperson', value: (r) => r.name },
      { header: 'Period', value: () => shown.periodLabel },
      { header: 'Customer', value: () => (company ? (companyNames.get(company) ?? '') : 'All customers') },
      { header: 'Planned visits', value: (r) => r.planned },
      { header: 'Held visits', value: (r) => r.held },
      { header: 'Held, counted toward the plan', value: (r) => r.heldCapped },
      { header: 'Upcoming', value: (r) => r.upcoming },
      { header: 'Not closed', value: (r) => r.notClosed },
      { header: 'Visit-plan completion', value: (r) => completionLabel(r.completion) },
      { header: 'Unplanned visits', value: (r) => r.unplanned },
      { header: 'Over plan', value: (r) => r.overPlan },
    ]);
    downloadText(datedName(`visit-plan-completion-${periodStart}`), csv);
  };

  return (
    <Screen title="Reports">
      <div className="report-tabs" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.value}
            to={paths.reports(t.value)}
            role="tab"
            aria-selected={tab === t.value}
            className="composer-tab"
            data-testid={'report-tab-' + t.value}
            style={{ textDecoration: 'none', borderBottom: `2px solid ${tab === t.value ? 'var(--brand)' : 'transparent'}`, fontWeight: tab === t.value ? 600 : 500, color: tab === t.value ? 'var(--brand)' : 'var(--text-2)' }}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <FilterBar
        chips={[
          {
            value: periodType,
            options: [
              { value: 'month', label: 'Month' },
              { value: 'quarter', label: 'Quarter' },
            ],
            onChange: (v) => update({ periodType: v, periodStart: null }),
            keepFirst: true,
          },
          { value: periodStart, options, onChange: (v) => update({ periodStart: v }), keepFirst: true },
          { value: salesperson || ANY_PERSON, options: [ANY_PERSON, ...people.map(([value, label]) => ({ value, label }))], onChange: (v) => update({ salesperson: v === ANY_PERSON ? null : v }) },
          { value: company || ANY_CUSTOMER, options: [ANY_CUSTOMER, ...customers], onChange: (v) => update({ company: v === ANY_CUSTOMER ? null : v }) },
        ]}
        dirty={!!salesperson || !!company}
        onClear={() => update({ salesperson: null, company: null })}
        meta="Only Customer visits count"
        extra={
          <button type="button" className="btn btn-secondary" data-testid="report-export" disabled={!shown} onClick={exportCsv}>
            Export CSV
          </button>
        }
      />
      {error && !shown && <div className="empty-state">{error}</div>}
      {!error && !shown && <div className="empty-state">Counting visits…</div>}
      {shown && <VisitReportTable report={shown} companyId={company || null} />}
    </Screen>
  );
}

function VisitReportTable({ report, companyId }: { report: ApiVisitReport; companyId: string | null }) {
  const count = (kind: VisitCount, n: number, r: ApiVisitRowTotals, userId: string | null, testId: string, text: string = String(n)) =>
    n === 0 ? (
      <span style={{ color: 'var(--muted)' }} data-testid={testId}>
        {text}
      </span>
    ) : (
      <Link to={visitsInCalendar(kind, r.meetingIds[kind], report, { userId, companyId })} className="vp-count" data-testid={testId}>
        {text}
      </Link>
    );
  const numbers = (r: ApiVisitRowTotals, userId: string | null) => {
    const pace = paceOf(r);
    return (
      <>
        <span className="vp-cell" data-label="Planned" data-testid="report-planned">
          {r.planned}
        </span>
        <span className="vp-cell" data-label="Held" title={r.overPlan ? `${r.heldCapped} counted toward the plan` : undefined}>
          {count('held', r.held, r, userId, 'report-held')}
        </span>
        <span className="vp-cell" data-label="Upcoming">
          {count('upcoming', r.upcoming, r, userId, 'report-upcoming')}
        </span>
        <span className="vp-cell" data-label="Not closed">
          {count('notClosed', r.notClosed, r, userId, 'report-not-closed')}
        </span>
        <span className="vp-cell" data-label="Completion">
          {r.planned ? (
            <span className={pace.className} title={pace.title} data-testid="report-completion" data-pace={r.pace}>
              {completionLabel(r.completion)}
            </span>
          ) : (
            <span style={{ color: 'var(--muted)' }}>—</span>
          )}
        </span>
        <span className="vp-cell" data-label="Unplanned">
          {count('unplanned', r.unplanned, r, userId, 'report-unplanned')}
        </span>
        <span className="vp-cell" data-label="Over plan" data-testid="report-over">
          {r.overPlan ? `+${r.overPlan}` : 0}
        </span>
      </>
    );
  };
  // A month links its plan; a quarter each of its monthly plans (CD-212).
  const planCell = (r: ApiVisitReportRow) =>
    r.plans.length === 0 ? (
      <span style={{ color: 'var(--muted)' }}>No plan</span>
    ) : report.periodType === 'month' ? (
      <Link to={paths.visitPlan(r.plans[0]!.id)} className="crumb-link" data-testid="report-plan-link">
        {report.periodLabel}
      </Link>
    ) : (
      <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
        {r.plans.map((p) => (
          <Link key={p.id} to={paths.visitPlan(p.id)} className="crumb-link" data-testid="report-plan-link" title={p.periodLabel}>
            {p.periodLabel.split(' ')[0]!.slice(0, 3)}
          </Link>
        ))}
      </span>
    );

  return (
    <div className="card report-table" data-testid="visit-report">
      <div className="table-head vp-list-head" style={{ gridTemplateColumns: COLS }}>
        {['Salesperson', 'Plan', 'Planned', 'Held', 'Upcoming', 'Not closed', 'Completion', 'Unplanned', 'Over plan'].map((h) => (
          <span key={h} className="th">
            {h}
          </span>
        ))}
      </div>
      {report.rows.length === 0 && <div className="empty-state">No visit plans or visits for {report.periodLabel}.</div>}
      {report.rows.map((r) => (
        <div key={r.salespersonUserId} className="table-row vp-list-row" data-testid="report-row" data-user-id={r.salespersonUserId} style={{ gridTemplateColumns: COLS, alignItems: 'center', fontSize: 13 }}>
          <span className="vp-cell-name" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.salespersonName}
          </span>
          <span className="vp-cell-period">{planCell(r)}</span>
          {numbers(r, r.salespersonUserId)}
        </div>
      ))}
      {report.rows.length > 1 && (
        <div className="table-row vp-list-row vp-plan-total" data-testid="report-total" style={{ gridTemplateColumns: COLS, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
          <span className="vp-cell-name">Total</span>
          <span className="vp-cell-period" />
          {numbers(report.totals, null)}
        </div>
      )}
    </div>
  );
}
