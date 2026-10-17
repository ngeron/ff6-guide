// Backups: everything you've added to the app, in one .zip you can move to another device.
//
//   backup.json          the manifest (below)
//
// backup.json:
//   {
//     "format": "ff6-guide-backup", "version": 1, "app": "0.6.0", "createdAt": "2026-10-08T…",
//     "names":    [{ "from": "Terra", "to": "Prns Donut" }],
//     "tags":     [{ "text": "Hell's Rider", "kind": "none" }],   color-coding corrections
//     "rages":    ["Stray Cat", "Leaf Bunny"],                     Gau's Rages learned
//     "gear":     { "Dagger": 2, "Potion": 14 },                   inventory counts (the bag)
//     "party":    { "party": ["Terra"], "chars": { "Terra": { "met": true, "level": 12,
//                   "goal": "balanced", "eq": { "rh": "Icebrand" }, "lock": {} } } }
//     "progress": { "walkDone": ["the-raid-on-narshe"], "walkLast": "figaro-castle" }
//   }
//
// Backups from before 0.20.0 also hold the imported guide ("guide" and guide/<name>) and its
// progress ("done", "last", "pos"), and ones from before 0.22.0 map images ("maps" and
// maps/<id>.<ext>) and map links ("links"); restoring ignores them.
//
// Reading settings (text size, theme) are left out: they belong to each device.
// When a feature stores something new that you'd want on another device, add it here as a new
// key. Readers ignore keys they don't know, so older backups keep working; bump VERSION only
// for changes an older app would misread.

import { getPref, setPref } from "./store.js";
import { loadNames, saveNames } from "./names.js";
import { loadTags, saveTags } from "./tags.js";
import { loadRages, saveRages } from "./rages.js";
import { loadGear, saveGear } from "./gear.js";
import { loadParty, saveParty } from "./party.js";
import { zip, unzip } from "./zip.js";

const FORMAT = "ff6-guide-backup";
const VERSION = 1;
const PROGRESS = ["walkDone", "walkLast"];

export async function makeBackup(appVersion) {
  const progress = {};
  for (const k of PROGRESS) { const v = getPref(k, null); if (v !== null) progress[k] = v; }
  const manifest = {
    format: FORMAT, version: VERSION, app: appVersion, createdAt: new Date().toISOString(),
    names: loadNames(), tags: loadTags(), rages: loadRages(), gear: loadGear(), party: getPref("party", null), progress,
  };
  const files = [{ name: "backup.json", data: JSON.stringify(manifest, null, 2) }];
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
  return {
    createdAt: m.createdAt,
    names: Array.isArray(m.names) ? m.names.filter((n) => n && typeof n.from === "string" && typeof n.to === "string") : [],
    tags: Array.isArray(m.tags) ? m.tags.filter((t) => t && typeof t.text === "string" && typeof t.kind === "string") : [],
    gear: m.gear && typeof m.gear === "object" && !Array.isArray(m.gear) ? Object.fromEntries(Object.entries(m.gear).filter(([k, v]) => typeof v === "number" && v > 0)) : {},
    party: m.party && typeof m.party === "object" ? m.party : null,
    rages: Array.isArray(m.rages) ? m.rages.filter((r) => typeof r === "string") : [],
    progress: m.progress && typeof m.progress === "object" ? m.progress : {},
  };
}

// A short description of what a backup holds.
export function describeBackup(b) {
  const parts = [];
  const done = (b.progress.walkDone || []).length;
  if (done) parts.push(`${done} chapter${done === 1 ? "" : "s"} done`);
  if (b.tags.length) parts.push(`${b.tags.length} color-coding fix${b.tags.length === 1 ? "" : "es"}`);
  const met = b.party && b.party.chars ? Object.values(b.party.chars).filter((c) => c && c.met).length : 0;
  if (met) parts.push(`${met} character${met === 1 ? "" : "s"}`);
  const kinds = Object.keys(b.gear).length;
  if (kinds) parts.push(`${kinds} kind${kinds === 1 ? "" : "s"} of items`);
  if (b.rages.length) parts.push(`${b.rages.length} Rage${b.rages.length === 1 ? "" : "s"}`);
  if (b.names.length) parts.push(`${b.names.length} character name${b.names.length === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Nothing";
}

// Replaces what's on this device with the backup. Reload the app afterwards.
export async function restoreBackup(b) {
  for (const k of PROGRESS) setPref(k, b.progress[k] ?? null);
  setPref("lastQuery", null);
  saveNames(b.names);
  saveTags(b.tags);
  saveRages(b.rages);
  saveGear(b.gear);
  setPref("party", b.party);
  saveParty(loadParty()); // drop anything this version doesn't recognise
}
