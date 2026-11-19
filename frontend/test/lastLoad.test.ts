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
