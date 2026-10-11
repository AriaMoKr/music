// "Reset stored data" (public/js/reset.js): the parts chosen are cleared, the others kept, under
// fake-indexeddb and a fake localStorage, with the page's own stores holding their databases open.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { RESET_PARTS, defaultResetParts, resetStoredData } from '../public/js/reset.js';
import { idbStore } from '../public/js/local/idb-store.js';
import { handleStore } from '../public/js/local/handles.js';
import { freezeStorage, load, save } from '../public/js/util/storage.js';

/** localStorage's interface over a Map. */
function fakeStorage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()].sort(),
  };
}

/** A database as block-cache.js keeps one, with one block, its connection closed. */
function makeBlocks(factory) {
  return new Promise((resolve, reject) => {
    const req = factory.open('vrlbry-blocks', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blocks');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('blocks', 'readwrite');
      tx.objectStore('blocks').put(new Uint8Array([1, 2, 3]), 'k');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
    req.onerror = () => reject(req.error);
  });
}

const names = async (factory) => (await factory.databases()).map((d) => d.name).sort();

/** Every kind of thing the page keeps, as it keeps them. */
async function filled() {
  const factory = new IDBFactory();
  const storage = fakeStorage({
    'vrlbry:settings': '{"place":"demo"}', 'vrlbry:pos:lib:book': '{"c":1,"b":2}', 'vrlbry:recent': '[]',
    'vrlbry:scene': '{}', 'vrlbry:card': '"collapsed"', 'vrlbry:zimUrls': '[{"url":"https://x/a.zim"}]',
    'someone-else': 'kept',
  });
  const indexes = idbStore('vrlbry-local', { indexedDB: factory });
  await indexes.writeText('wikipedia-abc.v4.json', '{"articles":1}');
  const handles = handleStore({ indexedDB: factory });
  await handles.remember([{ name: 'a.zim' }]);
  await makeBlocks(factory);
  return { factory, storage, indexes, handles };
}

describe('reset stored data', () => {
  it('lists its parts, the indexes kept unless chosen', () => {
    assert.deepEqual(RESET_PARTS.map((p) => p.id), ['settings', 'remembered', 'indexes', 'cache']);
    assert.deepEqual(defaultResetParts(), { settings: true, remembered: true, indexes: false, cache: true });
  });

  it('clears the parts chosen and keeps the others, the page\'s open stores letting go', async () => {
    const { factory, storage, indexes, handles } = await filled();
    assert.deepEqual(await names(factory), ['vrlbry-blocks', 'vrlbry-files', 'vrlbry-local']);
    const r = await resetStoredData(defaultResetParts(), { storage, indexedDB: factory, blockedMs: 500 });
    assert.equal(r.keys, 6);
    assert.deepEqual(r.databases, { 'vrlbry-files': 'deleted', 'vrlbry-blocks': 'deleted' });
    assert.deepEqual(storage.keys(), ['someone-else'], 'only our keys go');
    assert.deepEqual(await names(factory), ['vrlbry-local']);
    assert.equal(await indexes.readText('wikipedia-abc.v4.json'), '{"articles":1}', 'indexes kept');
    assert.deepEqual(await handles.list(), [], 'the handles\' store reopens empty');
    indexes.close();
  });

  it('can keep the settings and clear only what was opened, or clear everything', async () => {
    const a = await filled();
    const r = await resetStoredData({ settings: false, remembered: true }, { storage: a.storage, indexedDB: a.factory });
    assert.equal(r.keys, 1);
    assert.deepEqual(a.storage.keys(), ['someone-else', 'vrlbry:card', 'vrlbry:pos:lib:book', 'vrlbry:recent', 'vrlbry:scene', 'vrlbry:settings']);
    assert.deepEqual(await names(a.factory), ['vrlbry-blocks', 'vrlbry-local']);
    a.indexes.close();

    const b = await filled();
    const all = Object.fromEntries(RESET_PARTS.map((p) => [p.id, true]));
    const rb = await resetStoredData(all, { storage: b.storage, indexedDB: b.factory });
    assert.deepEqual(Object.values(rb.databases), ['deleted', 'deleted', 'deleted']);
    assert.deepEqual(await names(b.factory), []);
    assert.equal(await b.indexes.readText('wikipedia-abc.v4.json'), null, 'the index store reopens empty');
    b.indexes.close();
  });

  it('goes on when another tab keeps a database open, and says so', async () => {
    const { factory, storage, indexes } = await filled();
    // Another tab running an older version: a connection that does not close when asked.
    const other = await new Promise((resolve) => {
      const req = factory.open('vrlbry-blocks');
      req.onsuccess = () => resolve(req.result);
    });
    const r = await resetStoredData({ cache: true }, { storage, indexedDB: factory, blockedMs: 50 });
    assert.deepEqual(r.databases, { 'vrlbry-blocks': 'blocked' });
    other.close(); // that tab closes: the deletion goes ahead
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(await names(factory), ['vrlbry-files', 'vrlbry-local']);
    indexes.close();
  });

  it('needs neither storage nor IndexedDB', async () => {
    const broken = { get length() { throw new Error('denied'); } };
    assert.deepEqual(await resetStoredData(defaultResetParts(), { storage: broken, indexedDB: null }), { keys: 0, databases: {} });
  });

  it('stores nothing more once frozen (the page is about to reload)', () => {
    const storage = fakeStorage({});
    globalThis.localStorage = storage;
    try {
      assert.equal(save('settings', { a: 1 }), true);
      freezeStorage();
      assert.equal(save('settings', { a: 2 }), false);
      assert.equal(save('recent', []), false);
      assert.deepEqual(load('settings'), { a: 1 }, 'still read');
      assert.deepEqual(storage.keys(), ['vrlbry:settings']);
    } finally {
      delete globalThis.localStorage;
    }
  });
});
