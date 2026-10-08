// On-device storage. The guide text lives in IndexedDB; small settings and progress in localStorage.

const DB = "ff6-guide";
const STORE = "kv";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req && req.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  });
}

export const idbGet = (key) => tx("readonly", (s) => s.get(key));
export const idbSet = (key, value) => tx("readwrite", (s) => s.put(value, key));
export const idbDel = (key) => tx("readwrite", (s) => s.delete(key));

// Guide source: { text, name, importedAt }
export const loadGuide = () => idbGet("guide");
export const saveGuide = (g) => idbSet("guide", g);
export const removeGuide = () => idbDel("guide");

// Asks the browser not to clear this site's data under storage pressure.
export async function askPersist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return true;
  } catch {
    return false;
  }
}

const PREFIX = "ff6g:";
export function getPref(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function setPref(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* storage unavailable */ }
}
