/**
 * The Calendar's state in its URL (CD-130): view, period, filters, and a prefilled New meeting dialog.
 * `ids` (CD-211): exactly these meetings in the table (a report's number); `report=N`: the filter
 * stands in for a report's N meetings, too many to list by id.
 */
export type CalendarParams = Partial<
  Record<'view' | 'date' | 'from' | 'to' | 'ids' | 'report' | 'user' | 'type' | 'status' | 'company' | 'deal' | 'contact' | 'notClosed' | 'missingMinutes' | 'sort' | 'new' | 'companyId' | 'dealId' | 'contactId' | 'organizer' | 'start', string | null | undefined>
>;
/** The New meeting page's prefill (CD-221): ISO `start`/`end`, ids, the type and the title. */
export type NewMeetingParams = Partial<Record<'companyId' | 'dealId' | 'contactId' | 'type' | 'organizer' | 'start' | 'end' | 'title', string | null | undefined>>;
/** The Org structure page's state in its URL (CD-137), so a link shows the same view. */
export type OrgParams = Partial<Record<'tab' | 'mode' | 'q' | 'dept' | 'team' | 'manager' | 'scope' | 'status' | 'account' | 'issues' | 'sort' | 'dir' | 'new', string | null | undefined>>;
const query = (params: Partial<Record<string, string | null | undefined>> = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? '?' + s : '';
};

export const paths = {
  overview: '/overview',
  pipeline: '/pipeline',
  today: '/today',
  calendar: (params?: CalendarParams) => '/calendar' + query(params),
  meeting: (id: string) => '/meetings/' + encodeURIComponent(id),
  /** The New meeting page (CD-221), prefilled; the quick create's guests, location and agenda come in the history state. */
  newMeeting: (params: NewMeetingParams = {}) => '/meetings/new' + query(params),
  visitPlans: '/visit-plans',
  visitPlan: (id: string) => '/visit-plans/' + encodeURIComponent(id),
  companies: '/companies',
  company: (id: string) => '/companies/' + encodeURIComponent(id),
  contacts: '/contacts',
  contact: (id: string) => '/contacts/' + encodeURIComponent(id),
  products: '/products',
  /** Org structure (CD-137): `tab` chart|list, `mode` department|reporting, and the filters (store/people.ts). */
  org: (params: OrgParams = {}) => '/org' + query(params),
  /** Reports (CD-135, owners and admins); `visit-plans` is the Visit-plan completion tab, with its filters. */
  reports: (tab = 'visit-plans', params: Partial<Record<'periodType' | 'periodStart' | 'salesperson' | 'company', string | null | undefined>> = {}) => `/reports/${tab}` + query(params),
  settings: (tab = 'workspace') => '/settings/' + tab,
  profile: '/profile',
  /** An employee card (CD-140); `deactivate` opens its Deactivate dialog. */
  employee: (id: string, params?: { deactivate?: boolean }) => '/people/' + encodeURIComponent(id) + (params?.deactivate ? '?deactivate=1' : ''),
  lead: (id: string) => '/deals/' + encodeURIComponent(id),
};
