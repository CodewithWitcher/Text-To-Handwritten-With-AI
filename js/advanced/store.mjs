/**
 * Local persistence for Advanced mode.
 *
 * - Small JSON settings (profile, AI settings, templates, draft) live in
 *   localStorage under a single prefix.
 * - Binary blobs (uploaded fonts, front-page images) live in IndexedDB.
 *
 * Everything stays on this device. Storage can be unavailable (private
 * windows, blocked site data), so every access falls back gracefully.
 */

const PREFIX = 'tth-ai:';
const memoryFallback = new Map();

export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) {
      return memoryFallback.has(key) ? memoryFallback.get(key) : fallback;
    }
    return JSON.parse(raw);
  } catch (e) {
    return memoryFallback.has(key) ? memoryFallback.get(key) : fallback;
  }
}

export function save(key, value) {
  memoryFallback.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Could not persist', key, e);
    return false;
  }
}

export function remove(key) {
  memoryFallback.delete(key);
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch (e) {
    /* ignore */
  }
}

export function listKeys() {
  const keys = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
    }
  } catch (e) {
    /* ignore */
  }
  return keys;
}

/* ---------------------------- IndexedDB blobs ---------------------------- */

const DB_NAME = 'tth-ai';
const STORE = 'blobs';
let dbPromise = null;
const blobFallback = new Map();

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && result.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function putBlob(key, value) {
  blobFallback.set(key, value);
  const db = await openDB();
  if (!db) return false;
  try {
    await tx(db, 'readwrite', (s) => s.put(value, key));
    return true;
  } catch (e) {
    console.warn('IndexedDB write failed', e);
    return false;
  }
}

export async function getBlob(key) {
  const db = await openDB();
  if (!db) return blobFallback.get(key);
  try {
    const value = await tx(db, 'readonly', (s) => s.get(key));
    return value === undefined ? blobFallback.get(key) : value;
  } catch (e) {
    return blobFallback.get(key);
  }
}

export async function deleteBlob(key) {
  blobFallback.delete(key);
  const db = await openDB();
  if (!db) return;
  try {
    await tx(db, 'readwrite', (s) => s.delete(key));
  } catch (e) {
    /* ignore */
  }
}

export async function clearAllData() {
  for (const k of listKeys()) remove(k);
  blobFallback.clear();
  const db = await openDB();
  if (db) {
    try {
      await tx(db, 'readwrite', (s) => s.clear());
    } catch (e) {
      /* ignore */
    }
  }
}
