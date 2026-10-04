/* Storage: zugmatch's own IndexedDB (ZugMatchDB), zm-prefixed localStorage, and the
   read-only "Copy my data from PeerMatch". Never touches PeerMatch's own storage except to
   read it for that one copy. */

import { repairShareHistoryOnce } from './history.js';

const DB_NAME = 'ZugMatchDB';
const DB_VERSION = 2;
const PM_DB_NAME = 'PeerMatchDB';
const LS_PREFIX = 'zm';

export const state = { shadchanim: [], guys: [], girls: [] };

let dbPromise = null;
function openZugMatchDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('inbox')) d.createObjectStore('inbox');
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        dbPromise = null;
      };
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

function idbGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const r = t.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbPut(db, store, key, val) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).put(val, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
function idbDel(db, store, key) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).delete(key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function load() {
  const db = await openZugMatchDb();
  const s = await idbGet(db, 'kv', 'state');
  if (s && typeof s === 'object') Object.assign(state, s);
  for (const k of ['shadchanim', 'guys', 'girls']) {
    if (!Array.isArray(state[k])) state[k] = [];
    for (const x of state[k]) if (!Array.isArray(x.activities)) x.activities = [];
  }
  return state;
}

export async function save() {
  const db = await openZugMatchDb();
  return idbPut(db, 'kv', 'state', state);
}

/* For backup.js's generic store enumeration (ZIP export/import) — the only other module
   that needs the raw database handle. */
export function openRawDb() {
  return openZugMatchDb();
}

export async function getPendingShare() {
  const db = await openZugMatchDb();
  return idbGet(db, 'inbox', 'pending');
}
export async function setPendingShare(value) {
  const db = await openZugMatchDb();
  return idbPut(db, 'inbox', 'pending', value);
}
export async function clearPendingShare() {
  const db = await openZugMatchDb();
  return idbDel(db, 'inbox', 'pending');
}

/* ---------- zm-prefixed localStorage ---------- */

export function lsGet(name) {
  try { return localStorage.getItem(LS_PREFIX + name); } catch { return null; }
}
export function lsSet(name, value) {
  try { localStorage.setItem(LS_PREFIX + name, value); } catch { /* ignore */ }
}
export function lsRemove(name) {
  try { localStorage.removeItem(LS_PREFIX + name); } catch { /* ignore */ }
}
export function lsGetJSON(name, fallback) {
  try { const v = localStorage.getItem(LS_PREFIX + name); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
export function lsSetJSON(name, value) {
  try { localStorage.setItem(LS_PREFIX + name, JSON.stringify(value)); } catch { /* ignore */ }
}

/* ---------- Read-only copy from PeerMatch ---------- */

/* Opened WITHOUT a version number, so it is never upgraded or created. Only attempted after
   confirming the database exists — an unversioned open of a database that doesn't exist yet
   would create it, which must never happen to PeerMatch's storage. */
export async function copyFromPeerMatch() {
  if (typeof indexedDB.databases !== 'function') return { ok: false, reason: 'cannot-verify' };
  const dbs = await indexedDB.databases();
  if (!dbs.some((d) => d.name === PM_DB_NAME)) return { ok: false, reason: 'not-found' };

  let pmDb;
  try {
    pmDb = await new Promise((resolve, reject) => {
      const r = indexedDB.open(PM_DB_NAME);
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch { /* ignore */ } reject(new Error('unexpected upgrade')); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return { ok: false, reason: 'open-failed' };
  }

  let pmState;
  try {
    pmState = await idbGet(pmDb, 'kv', 'state');
  } finally {
    pmDb.close();
  }
  if (!pmState || typeof pmState !== 'object') return { ok: false, reason: 'empty' };

  state.shadchanim = Array.isArray(pmState.shadchanim) ? pmState.shadchanim : [];
  state.guys = Array.isArray(pmState.guys) ? pmState.guys : [];
  state.girls = Array.isArray(pmState.girls) ? pmState.girls : [];
  for (const k of ['shadchanim', 'guys', 'girls']) for (const x of state[k]) if (!Array.isArray(x.activities)) x.activities = [];

  repairShareHistoryOnce(state);
  await save();

  return {
    ok: true,
    counts: { shadchanim: state.shadchanim.length, guys: state.guys.length, girls: state.girls.length }
  };
}
