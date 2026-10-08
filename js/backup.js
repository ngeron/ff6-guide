// Backups: everything you've added to the app, in one .zip you can move to another device.
//
//   backup.json          the manifest (below)
//   guide/<name>         the guide's master copy, in its stored format (.txt, .html or .md)
//   maps/<id>.<ext>      map images
//
// backup.json:
//   {
//     "format": "ff6-guide-backup", "version": 1, "app": "0.6.0", "createdAt": "2026-10-08T…",
//     "guide":    { "file": "guide/guide.txt", "format": "text", "name": "…", "source": "pdf", "importedAt": 0 } | null,
//     "names":    [{ "from": "Terra", "to": "Prns Donut" }],
//     "progress": { "done": ["3.1.1"], "last": "3.1.2", "pos": { "3.1.2": 0.25 }, "savedText": true },
//     "maps":     [{ "id", "file": "maps/<id>.png", "title", "section", "type", "width", "height", "order", "addedAt" }],
//     "links":    [{ "id", "title", "url", "section", "note" }]
//   }
//
// Reading settings (text size, theme) are left out: they belong to each device.
// When a feature stores something new that you'd want on another device, add it here as a new
// key. Readers ignore keys they don't know, so older backups keep working; bump VERSION only
// for changes an older app would misread.

import { loadGuide, saveGuide, removeGuide, listMaps, putMap, clearMaps, loadLinks, saveLinks, getPref, setPref } from "./store.js";
import { loadNames, saveNames } from "./names.js";
import { zip, unzip } from "./zip.js";

const FORMAT = "ff6-guide-backup";
const VERSION = 1;
const PROGRESS = ["done", "last", "pos", "savedText"];
const IMG_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const GUIDE_EXT = { html: "html", markdown: "md" };
const GUIDE_FORMATS = ["text", "html", "markdown"];

export async function makeBackup(appVersion) {
  const files = [];
  const guide = await loadGuide();
  let g = null;
  if (guide && guide.text) {
    const file = "guide/guide." + (GUIDE_EXT[guide.format] || "txt");
    files.push({ name: file, data: guide.text });
    g = { file, format: guide.format || "text", name: guide.name, source: guide.source, importedAt: guide.importedAt };
  }
  const maps = [];
  for (const m of await listMaps()) {
    const file = `maps/${m.id}.${IMG_EXT[m.type] || "png"}`;
    files.push({ name: file, data: new Uint8Array(m.data) });
    const { data, ...rest } = m;
    maps.push({ ...rest, file });
  }
  const progress = {};
  for (const k of PROGRESS) { const v = getPref(k, null); if (v !== null) progress[k] = v; }
  const manifest = {
    format: FORMAT, version: VERSION, app: appVersion, createdAt: new Date().toISOString(),
    guide: g, names: loadNames(), progress, maps, links: await loadLinks(),
  };
  files.unshift({ name: "backup.json", data: JSON.stringify(manifest, null, 2) });
  const day = new Date().toISOString().slice(0, 10);
  return new File([zip(files)], `FF6 Guide backup ${day}.zip`, { type: "application/zip" });
}

export const isBackupEntries = (entries) => entries.some((e) => e.name === "backup.json");

// Reads and checks a backup file. Throws an Error with a readable message if it isn't one.
export async function readBackup(file) {
  const entries = await unzip(await file.arrayBuffer());
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  if (!byName.has("backup.json")) throw new Error("notbackup");
  let m;
  try { m = JSON.parse(new TextDecoder().decode(byName.get("backup.json"))); } catch { throw new Error("That backup is damaged (its backup.json can't be read)."); }
  if (!m || m.format !== FORMAT) throw new Error("notbackup");
  if (!(m.version <= VERSION)) throw new Error("That backup was made by a newer version of the app. Reload the app to update it, then try again.");
  let guide = null;
  if (m.guide && m.guide.file) {
    const data = byName.get(m.guide.file);
    if (!data) throw new Error("That backup is damaged (the guide file is missing).");
    guide = {
      format: GUIDE_FORMATS.includes(m.guide.format) ? m.guide.format : "text",
      text: new TextDecoder().decode(data),
      name: String(m.guide.name || "guide"),
      source: m.guide.source || "text",
      importedAt: +m.guide.importedAt || Date.now(),
    };
  }
  const maps = [];
  for (const rec of Array.isArray(m.maps) ? m.maps : []) {
    const data = rec && byName.get(rec.file);
    if (!data) continue;
    const { file, ...rest } = rec;
    maps.push({ ...rest, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
  }
  return {
    createdAt: m.createdAt,
    guide,
    names: Array.isArray(m.names) ? m.names.filter((n) => n && typeof n.from === "string" && typeof n.to === "string") : [],
    progress: m.progress && typeof m.progress === "object" ? m.progress : {},
    maps,
    links: Array.isArray(m.links) ? m.links.filter((l) => l && typeof l.url === "string") : [],
  };
}

// A short description of what a backup holds.
export function describeBackup(b) {
  const parts = [];
  if (b.guide) parts.push(b.guide.name);
  const done = (b.progress.done || []).length;
  if (done) parts.push(`${done} section${done === 1 ? "" : "s"} done`);
  if (b.names.length) parts.push(`${b.names.length} character name${b.names.length === 1 ? "" : "s"}`);
  if (b.maps.length) parts.push(`${b.maps.length} map${b.maps.length === 1 ? "" : "s"}`);
  if (b.links.length) parts.push(`${b.links.length} map link${b.links.length === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Nothing";
}

// Replaces what's on this device with the backup. Reload the app afterwards.
export async function restoreBackup(b) {
  if (b.guide) await saveGuide(b.guide);
  else await removeGuide();
  for (const k of PROGRESS) setPref(k, b.progress[k] ?? null);
  setPref("lastQuery", null);
  saveNames(b.names);
  await clearMaps();
  for (const m of b.maps) await putMap(m);
  await saveLinks(b.links);
}
