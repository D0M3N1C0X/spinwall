// On-device storage: one IndexedDB object store used as a key → value map.
// If IndexedDB is unavailable (private browsing, blocked storage) the app
// keeps working from memory for the session.

const DB_NAME = 'spinwall';
const STORE = 'kv';
const memory = new Map();
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function get(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const db = await openDB();
    const value = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    memory.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

export async function set(key, value) {
  memory.set(key, value);
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

// Small per-device preferences (hint already seen, Last.fm username…).
export function pref(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(`spinwall.${key}`);
    localStorage.setItem(`spinwall.${key}`, value);
  } catch { /* storage blocked: preferences simply aren't remembered */ }
  return value;
}
