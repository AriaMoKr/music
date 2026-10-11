// "Reset stored data" (the help dialog, the kiosk): what this site keeps in the browser, in four
// parts that can each be cleared or kept, so a person can start afresh without the browser's own
// settings. localStorage holds the settings and reading state (util/storage.js, `vrlbry:` keys)
// and the web addresses opened here (`zimUrls`); IndexedDB the file handles (local/handles.js),
// the indexes (local/idb-store.js) and what was read from the web (local/block-cache.js). Every
// flavour of the app on this origin shares them (TODO, "Shared storage"), so a reset clears
// theirs too. The page reloads afterwards: what it holds in memory would otherwise be saved again.

import { STORAGE_PREFIX } from './config.js';

/** The parts, in the order shown; `clear`: chosen to be cleared unless changed. */
export const RESET_PARTS = Object.freeze([
  { id: 'settings', label: 'Settings, reading positions, recently read, saved scene', clear: true },
  { id: 'remembered', label: 'ZIM files and web addresses opened here', clear: true },
  { id: 'indexes', label: 'Indexes of Wikipedia and Wikisource files (slow to rebuild)', clear: false },
  { id: 'cache', label: 'Parts of web ZIMs kept for faster reading', clear: true },
]);

/** The choice before anything is changed: { settings: true, … }. */
export const defaultResetParts = () => Object.fromEntries(RESET_PARTS.map((p) => [p.id, p.clear]));

/** localStorage keys (without the prefix) of the "remembered" part; every other key is a setting. */
const REMEMBERED_KEYS = new Set(['zimUrls']);
/** The IndexedDB databases of each part. */
const DATABASES = { remembered: ['vrlbry-files'], indexes: ['vrlbry-local'], cache: ['vrlbry-blocks'] };
/** How long a deletion may wait for another tab to close the database before the reset goes on. */
const BLOCKED_MS = 3000;

/**
 * Deletes a database. Connections to it close when asked (each store lets go on `versionchange`);
 * one that does not (another tab running an older version) leaves it 'blocked' for now: the
 * deletion then happens when that tab closes it.
 * @returns {Promise<'deleted'|'blocked'|'failed'>}
 */
function deleteDatabase(factory, name, blockedMs) {
  return new Promise((resolve) => {
    let timer = null;
    const done = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    let req;
    try {
      req = factory.deleteDatabase(name);
    } catch {
      return resolve('failed');
    }
    req.onsuccess = () => done('deleted');
    req.onerror = () => done('failed');
    req.onblocked = () => { timer = setTimeout(() => resolve('blocked'), blockedMs); };
  });
}

/**
 * Clears the chosen parts.
 * @param {{ settings?: boolean, remembered?: boolean, indexes?: boolean, cache?: boolean }} parts
 * @param {{ storage?: Storage, indexedDB?: IDBFactory, blockedMs?: number }} [o] (tests pass fakes)
 * @returns {Promise<{ keys: number, databases: Record<string, 'deleted'|'blocked'|'failed'> }>}
 *   how many localStorage keys were removed, and what became of each database
 */
export async function resetStoredData(parts, { storage = globalThis.localStorage, indexedDB: factory = globalThis.indexedDB, blockedMs = BLOCKED_MS } = {}) {
  let keys = 0;
  try {
    const ours = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) ours.push(key);
    }
    for (const key of ours) {
      const part = REMEMBERED_KEYS.has(key.slice(STORAGE_PREFIX.length)) ? 'remembered' : 'settings';
      if (!parts[part]) continue;
      storage.removeItem(key);
      keys++;
    }
  } catch { /* storage unavailable: nothing kept there */ }
  const databases = {};
  if (factory) {
    const names = Object.entries(DATABASES).filter(([part]) => parts[part]).flatMap(([, list]) => list);
    const results = await Promise.all(names.map((name) => deleteDatabase(factory, name, blockedMs)));
    names.forEach((name, i) => { databases[name] = results[i]; });
  }
  return { keys, databases };
}
