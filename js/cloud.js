// Google Drive sync: keeps one backup file ("FF6 Guide sync.zip", the same .zip as Save a backup)
// in your Google Drive, so another browser or device can pick up where you left off.
//
// Sign-in uses Google's OAuth 2.0 token flow for browser apps as a full-page redirect (no pop-up,
// so it works in a Home Screen app): we send you to Google, Google sends you back here with a
// short-lived access token in the URL fragment, and we finish what you asked for. The scope is
// drive.file, which only reaches files this app created. Tokens last about an hour and are kept
// in sessionStorage only.
//
// Needs an OAuth client ID ("Web application") from the owner's Google Cloud project, with this
// page's address as an authorized JavaScript origin and redirect URI. It's entered in Settings
// on each browser and kept only in that browser's storage, never in the code.

import { getPref, setPref } from "./store.js";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FILE_NAME = "FF6 Guide sync.zip";
const TOKEN_KEY = "ff6g:gdriveToken";
const PENDING_KEY = "ff6g:gdrivePending";

export const clientId = () => getPref("gdriveClient", "").trim();
export const setClientId = (id) => setPref("gdriveClient", id.trim() || null);
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, "");

function token() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null");
    return t && t.exp > Date.now() + 60000 ? t.value : null;
  } catch { return null; }
}

// Sends you to Google to sign in; `action` ("save" or "restore") runs when you come back.
function signIn(action) {
  const id = clientId();
  if (!id) throw new Error("noclient");
  const state = Math.random().toString(36).slice(2);
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ action, state, hash: location.hash })); } catch { /* private mode */ }
  const q = new URLSearchParams({ client_id: id, redirect_uri: redirectUri(), response_type: "token", scope: SCOPE, include_granted_scopes: "true", state });
  location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + q);
}

// Call before routing. If we've just come back from Google, stores the token, puts the old
// address back and returns the action to run ("save" | "restore"), or { error }.
export function finishSignIn() {
  const h = location.hash;
  if (!/(^#|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h.slice(1));
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  history.replaceState(null, "", location.pathname + ((pending && pending.hash) || ""));
  if (!pending || p.get("state") !== pending.state) return { error: "Google sign-in didn't match a request from this page. Try again." };
  if (p.get("error")) return { error: p.get("error") === "access_denied" ? "Google Drive access wasn't allowed." : `Google sign-in failed (${p.get("error")}).` };
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ value: p.get("access_token"), exp: Date.now() + (+p.get("expires_in") || 3600) * 1000 })); } catch { /* ignore */ }
  return { action: pending.action };
}

async function api(url, opts = {}) {
  const t = token();
  if (!t) throw new Error("signin");
  const res = await fetch(url, { ...opts, headers: { Authorization: "Bearer " + t, ...(opts.headers || {}) } });
  if (res.status === 401) { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } throw new Error("signin"); }
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}`);
  return res;
}

export async function findFile() {
  const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,modifiedTime,size,appProperties)`);
  const { files } = await r.json();
  return files && files[0] ? files[0] : null;
}

function deviceName() {
  const ua = navigator.userAgent;
  const dev = /iPad/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "a browser";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? `${br} on ${dev}` : dev;
}

// Uploads a backup File, replacing the existing sync file if there is one (resumable upload, so
// large backups with maps work). Returns the file's metadata.
export async function upload(file, existingId) {
  const meta = { name: FILE_NAME, mimeType: "application/zip", appProperties: { device: deviceName() } };
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=resumable&fields=id,modifiedTime,size,appProperties`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,modifiedTime,size,appProperties";
  const init = await api(url, {
    method: existingId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/zip", "X-Upload-Content-Length": String(file.size) },
    body: JSON.stringify(existingId ? { appProperties: meta.appProperties } : meta),
  });
  const session = init.headers.get("Location");
  if (!session) throw new Error("Google Drive didn't start the upload");
  const res = await fetch(session, { method: "PUT", headers: { "Content-Type": "application/zip" }, body: file });
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}`);
  return res.json();
}

export async function download(id) {
  const r = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return new File([await r.blob()], FILE_NAME, { type: "application/zip" });
}

// What this device last saved or restored, to spot a newer copy saved from somewhere else.
export const lastSync = () => getPref("gdriveSync", null);
export const markSynced = (meta) => setPref("gdriveSync", { modifiedTime: meta.modifiedTime, at: Date.now() });

// Runs fn() with a valid token, signing in first (and resuming `action` afterwards) if needed.
export async function withDrive(action, fn) {
  if (!token()) { signIn(action); return new Promise(() => {}); }
  try { return await fn(); }
  catch (e) {
    if (e.message === "signin") { signIn(action); return new Promise(() => {}); }
    throw e;
  }
}
