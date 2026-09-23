export const docStateClass = (state: string) => (state === 'signed' ? 'badge-brand' : state === 'sent' ? 'badge-warn' : 'badge-neutral');
