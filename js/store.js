// On-device storage: settings and progress in localStorage. IndexedDB held an imported guide and
// map images in older versions; they're removed on start.

const DB = "ff6-guide";
const STORE = "kv";
const MAPS = "maps";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(MAPS)) db.createObjectStore(MAPS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn, store = STORE) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); resolve(req && req.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  });
}

export const idbGet = (key) => tx("readonly", (s) => s.get(key));
export const idbSet = (key, value) => tx("readwrite", (s) => s.put(value, key));
export const idbDel = (key) => tx("readwrite", (s) => s.delete(key));

// Versions before 0.22.0 kept map images and links you added; app.js deletes them on start.
export const removeMaps = async () => { await tx("readwrite", (s) => s.clear(), MAPS); await idbDel("mapLinks"); };

// Earlier versions stored an imported guide here; app.js deletes it on start.
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
