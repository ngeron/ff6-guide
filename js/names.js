// Character names: FF6 lets you rename characters, so the app can swap the default names for your
// own. Renames are applied when the walkthrough is shown, so they can be changed at any time.
//
// A rename is { from, to }. Matching ignores case and only hits whole words ("Terra" and
// "TERRA'S", not "Terrato"). A name written in capitals is written in capitals.

import { getPref, setPref } from "./store.js";

// The default names of the playable characters, offered as suggestions.
export const DEFAULT_NAMES = ["Terra", "Locke", "Edgar", "Sabin", "Celes", "Cyan", "Shadow", "Gau",
  "Setzer", "Mog", "Strago", "Relm", "Gogo", "Umaro"];

export const loadNames = () => getPref("names", []);
export const saveNames = (names) => setPref("names", names.length ? names : null);

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Returns a function that renames within a plain string, or null if there's nothing to rename.
// All names are matched in one pass, so swaps (Terra -> Celes, Celes -> Terra) work.
export function renamer(names) {
  const map = new Map();
  for (const n of names) {
    const from = (n.from || "").trim(), to = (n.to || "").trim();
    if (from && to && from.toLowerCase() !== to.toLowerCase()) map.set(from.toLowerCase(), to);
  }
  if (!map.size) return null;
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(reEsc).join("|");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, "giu");
  const pick = (m) => {
    const to = map.get(m.toLowerCase());
    return m.length > 1 && m === m.toUpperCase() && m !== m.toLowerCase() ? to.toUpperCase() : to;
  };
  const fn = (s) => (s ? s.replace(re, pick) : s);
  // Sanitized HTML: rename text only, never tags or attributes.
  fn.html = (h) => (h ? h.split(/(<[^>]*>)/).map((part, i) => (i % 2 ? part : part.replace(re, (m) => escHtml(pick(m))))).join("") : h);
  return fn;
}
