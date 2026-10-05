/** The Calendar's state in its URL (CD-130): view, period, filters, and a prefilled New meeting dialog. */
export type CalendarParams = Partial<
  Record<'view' | 'date' | 'from' | 'to' | 'user' | 'type' | 'status' | 'company' | 'deal' | 'contact' | 'notClosed' | 'missingMinutes' | 'sort' | 'new' | 'companyId' | 'dealId' | 'contactId' | 'organizer' | 'start', string | null | undefined>
>;
const query = (params: CalendarParams = {}) => {
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
  companies: '/companies',
  company: (id: string) => '/companies/' + encodeURIComponent(id),
  contacts: '/contacts',
  contact: (id: string) => '/contacts/' + encodeURIComponent(id),
  products: '/products',
  settings: (tab = 'workspace') => '/settings/' + tab,
  profile: '/profile',
  lead: (id: string) => '/deals/' + encodeURIComponent(id),
};
