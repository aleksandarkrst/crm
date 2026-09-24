export const paths = {
  overview: '/overview',
  pipeline: '/pipeline',
  today: '/today',
  companies: '/companies',
  company: (id: string) => '/companies/' + encodeURIComponent(id),
  contacts: '/contacts',
  contact: (id: string) => '/contacts/' + encodeURIComponent(id),
  products: '/products',
  settings: (tab = 'workspace') => '/settings/' + tab,
  profile: '/profile',
  lead: (id: string) => '/deals/' + encodeURIComponent(id),
};
