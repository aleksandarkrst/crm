/** Small line icons for the deal summary (CD-83): each field shows an icon instead of a label. */
const PATHS = {
  value: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3',
  contacts: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M17 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  funnel: 'M3 4h18l-7 8.5V20l-4-2v-5.5z',
  source: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  company: 'M4 21V5l8-2v18M12 8h8v13M8 8v.01M8 12v.01M8 16v.01M16 12v.01M16 16v.01M2 21h20',
  industry: 'M4 8h16v12H4zM9 8V5h6v3M4 13h16',
  location: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  team: 'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20v-1a5 5 0 0 1 10 0v1M12 20v-1a5 5 0 0 1 10 0v1',
  owner: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a7 7 0 0 1 16 0v1',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  note: 'M6 3h9l4 4v14H6zM9 11h7M9 15h7M9 7h3',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A field of the deal summary: an icon (its name on hover and for screen readers), then the value. */
export function IconRow({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="field-row icon-row" data-label={label}>
      <span className="icon-row-icon" title={label}>
        <Icon name={icon} title={label} />
      </span>
      {children}
    </div>
  );
}
