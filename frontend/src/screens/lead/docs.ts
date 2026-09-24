import { type DealDoc, docBusy } from '../../store/documents';

/** A generated document's state as its badge says it (CD-13). */
export const docState = (d: DealDoc) => (docBusy(d) ? 'generating' : d.status === 'failed' ? 'failed' : 'ready');
export const docStateClass = (state: string) => (state === 'ready' ? 'badge-brand' : state === 'failed' ? 'badge-danger' : 'badge-warn');
