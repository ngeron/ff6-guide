// Character names: FF6 lets you rename characters, so the reader can swap the guide's default
// names for your own. Renames are applied to the parsed document when it's shown, never to the
// stored guide, so they can be changed at any time and the saved master copy stays as imported.
//
// A rename is { from, to }. Matching ignores case and only hits whole words ("Terra" and
// "TERRA'S", not "Terrato"). A name written in capitals in the guide is written in capitals.

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
  // Monospace lines: keep later columns lined up by taking the length change out of the
  // spaces after the name, when there's a column gap to absorb it.
  fn.pre = (s) => s.replace(new RegExp(re.source + "( {2,})?", "giu"), (m, gap) => {
    const name = gap ? m.slice(0, -gap.length) : m;
    const to = pick(name);
    return gap ? to + " ".repeat(Math.max(2, gap.length - (to.length - name.length))) : to;
  });
  // Sanitized HTML: rename text only, never tags or attributes.
  fn.html = (h) => (h ? h.split(/(<[^>]*>)/).map((part, i) => (i % 2 ? part : part.replace(re, (m) => escHtml(pick(m))))).join("") : h);
  return fn;
}

// A renamed copy of a parsed document (see importers/index.js). Section keys, ids and numbers
// are left alone so links, progress and maps keep working.
export function renameDoc(doc, names) {
  const r = renamer(names);
  if (!r) return doc;
  const out = structuredClone(doc);
  out.title = r(out.title);
  out.author = r(out.author);
  for (const s of out.sections) {
    s.title = r(s.title);
    if (s.subtitle) s.subtitle = s.subtitle.map(r);
    for (const b of s.blocks) {
      if (b.text !== undefined) b.text = r(b.text);
      if (b.html !== undefined) b.html = r.html(b.html);
      if (b.label !== undefined) b.label = r(b.label);
      if (b.alt !== undefined) b.alt = r(b.alt);
      if (b.caption !== undefined) b.caption = r(b.caption);
      if (b.type === "pre") b.lines = b.lines.map(r.pre);
      for (const it of b.items || []) { it.text = r(it.text); if (it.html !== undefined) it.html = r.html(it.html); }
      for (const e of b.entries || []) e.text = r(e.text);
      for (const row of b.rows || []) for (const c of row) { c.text = r(c.text); c.html = r.html(c.html); }
    }
  }
  return out;
}
