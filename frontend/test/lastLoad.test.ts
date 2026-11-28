// The last workspace load and this tab's saves on top (CD-519): `npm test` in frontend.
// A new CEO must not switch back to the old one when a live update re-reads other lists, also when
// the save lands while that refresh is still fetching.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lastLoadStore } from '../src/store/lastLoad.ts';

type Raw = { workspace: { ceo: string }; products: string[] };
type Store = ReturnType<typeof lastLoadStore<Raw>>;

/** A load as loadWorkspace does it: `fetch` reads some lists, the others come from `prev`. */
const load = (store: Store, fetch: () => Promise<Partial<Raw>>, partial = false) =>
  store.load(partial, fetch, (fetched, prev) => ({ ...prev, ...fetched }) as Raw);

/** A fetch that resolves when the test says so, so a save can land while it is in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('the last workspace load', () => {
  it('keeps a saved CEO when a later refresh re-reads only the products', async () => {
    const store = lastLoadStore<Raw>();
    await load(store, async () => ({ workspace: { ceo: 'A' }, products: ['p1'] }));
    store.remember('workspace', { ceo: 'B' });
    const next = await load(store, async () => ({ products: ['p1', 'p2'] }), true);
    assert.deepEqual(next, { workspace: { ceo: 'B' }, products: ['p1', 'p2'] });
  });

  it('keeps a CEO saved while a partial refresh is fetching, and the retry builds on it', async () => {
    const store = lastLoadStore<Raw>();
    await load(store, async () => ({ workspace: { ceo: 'A' }, products: ['p1'] }));
    const products = deferred<Partial<Raw>>();
    const refresh = load(store, () => products.promise, true);
    store.remember('workspace', { ceo: 'B' }); // the save answers during the fetch
    products.resolve({ products: ['p1', 'p2'] });
    assert.deepEqual((await refresh).workspace, { ceo: 'B' });
    // The store throws that result away (an edit happened meanwhile) and retries: still B.
    const retry = await load(store, async () => ({ products: ['p1', 'p2'] }), true);
    assert.deepEqual(retry.workspace, { ceo: 'B' });
    assert.deepEqual(store.current()?.workspace, { ceo: 'B' });
  });

  it('merges a partial refresh onto the lists as they are after its fetch', async () => {
    const store = lastLoadStore<Raw>();
    await load(store, async () => ({ workspace: { ceo: 'A' }, products: ['p1'] }));
    const products = deferred<Partial<Raw>>();
    let prevSeen: Raw | null = null;
    const refresh = store.load(true, () => products.promise, (fetched, prev) => ((prevSeen = prev), { ...prev, ...fetched }) as Raw);
    store.remember('workspace', { ceo: 'B' });
    products.resolve({ products: ['p1', 'p2'] });
    await refresh;
    assert.deepEqual(prevSeen, { workspace: { ceo: 'B' }, products: ['p1'] });
  });

  it('keeps a CEO saved while a full load is fetching the workspace from before the save', async () => {
    const store = lastLoadStore<Raw>();
    await load(store, async () => ({ workspace: { ceo: 'A' }, products: [] }));
    const all = deferred<Partial<Raw>>();
    const reload = load(store, () => all.promise);
    store.remember('workspace', { ceo: 'B' });
    all.resolve({ workspace: { ceo: 'A' }, products: ['p1'] }); // read before the save committed
    assert.deepEqual(await reload, { workspace: { ceo: 'B' }, products: ['p1'] });
  });

  it('takes what a load read when the save came before it started', async () => {
    const store = lastLoadStore<Raw>();
    await load(store, async () => ({ workspace: { ceo: 'A' }, products: [] }));
    store.remember('workspace', { ceo: 'B' });
    // Someone else then made C the CEO; a full load started after the save reads that.
    const next = await load(store, async () => ({ workspace: { ceo: 'C' }, products: [] }));
    assert.deepEqual(next.workspace, { ceo: 'C' });
  });

  it('ignores a save before the first load', async () => {
    const store = lastLoadStore<Raw>();
    store.remember('workspace', { ceo: 'B' });
    assert.equal(store.current(), null);
    const first = await load(store, async () => ({ workspace: { ceo: 'A' }, products: [] }));
    assert.deepEqual(first.workspace, { ceo: 'A' }); // read after the save: the API has it
  });
});

// CD-534 staging QA (case 7): an opportunity whose MB was cleared showed as a lead, then went back to
// Opportunity, automatic as soon as a colleague's change re-read another list (the last load still
// had the company as it was). A saved row is kept like a saved list, also against a load in flight.
type Co = { id: string; status: string; mb: string | null; ownerName?: string };
type Rows = { companies: Co[]; contacts: string[] };
const loadRows = (store: ReturnType<typeof lastLoadStore<Rows>>, fetch: () => Promise<Partial<Rows>>, partial = false) =>
  store.load(partial, fetch, (fetched, prev) => ({ ...prev, ...fetched }) as Rows);
/** As rememberCompanyRows does it: the saved row over the listed one, by id. */
const saved = (row: Co) => (list: Co[]) => list.map((c) => (c.id === row.id ? { ...c, ...row } : c));

describe('a saved row in the last workspace load', () => {
  const opportunity: Co = { id: 'c1', status: 'opportunity', mb: '20084693', ownerName: 'Stella' };
  const cleared: Co = { id: 'c1', status: 'lead', mb: null };

  it('keeps a company saved as a lead when a later refresh re-reads only the contacts', async () => {
    const store = lastLoadStore<Rows>();
    await loadRows(store, async () => ({ companies: [opportunity, { id: 'c2', status: 'lead', mb: null }], contacts: [] }));
    store.update('companies', saved(cleared));
    const next = await loadRows(store, async () => ({ contacts: ['someone else'] }), true);
    assert.deepEqual(next.companies, [{ ...cleared, ownerName: 'Stella' }, { id: 'c2', status: 'lead', mb: null }]);
  });

  it('puts the saved row back over a load that read the companies before the save', async () => {
    const store = lastLoadStore<Rows>();
    await loadRows(store, async () => ({ companies: [opportunity], contacts: [] }));
    const all = deferred<Partial<Rows>>();
    const reload = loadRows(store, () => all.promise);
    store.update('companies', saved(cleared)); // the save answers during the fetch
    all.resolve({ companies: [opportunity, { id: 'c3', status: 'lead', mb: null }], contacts: ['new'] });
    const next = await reload;
    assert.deepEqual(next.companies, [{ ...cleared, ownerName: 'Stella' }, { id: 'c3', status: 'lead', mb: null }], 'the new company from the load stays');
    assert.deepEqual(next.contacts, ['new']);
  });

  it('takes what a load read when the save came before it started', async () => {
    const store = lastLoadStore<Rows>();
    await loadRows(store, async () => ({ companies: [opportunity], contacts: [] }));
    store.update('companies', saved(cleared));
    // Someone filled MB in again since; a full load started after the save reads that.
    const next = await loadRows(store, async () => ({ companies: [opportunity], contacts: [] }));
    assert.deepEqual(next.companies, [opportunity]);
  });

  it('a whole list saved during the same load wins over a row change made before it', async () => {
    const store = lastLoadStore<Rows>();
    await loadRows(store, async () => ({ companies: [opportunity], contacts: [] }));
    const all = deferred<Partial<Rows>>();
    const reload = loadRows(store, () => all.promise);
    store.update('companies', saved(cleared));
    store.remember('companies', [{ id: 'c9', status: 'client', mb: null }]);
    all.resolve({ companies: [opportunity], contacts: [] });
    assert.deepEqual((await reload).companies, [{ id: 'c9', status: 'client', mb: null }]);
  });

  it('forgets a row change once no load that started before it is running, and survives a failed load', async () => {
    const store = lastLoadStore<Rows>();
    await loadRows(store, async () => ({ companies: [opportunity], contacts: [] }));
    const failing = loadRows(store, async () => Promise.reject(new Error('400')), true);
    store.update('companies', saved(cleared));
    await assert.rejects(failing);
    assert.deepEqual(store.current()?.companies, [{ ...cleared, ownerName: 'Stella' }]);
    // A later load read after the save: what it read stands, the change is not applied again.
    const next = await loadRows(store, async () => ({ companies: [opportunity], contacts: [] }));
    assert.deepEqual(next.companies, [opportunity]);
  });
});
