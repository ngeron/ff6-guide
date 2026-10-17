// Color coding: marks playable characters, monsters, bosses and places in the walkthrough so a
// chapter is easier to scan.
//
// Names come from four places, most trusted first:
//   1. Your own corrections ("tags" setting): [{ text, kind }], where kind is one of KINDS or
//      "none" to stop a word being colored.
//   2. Your character names (names.js): the names you chose count as playable characters.
//   3. The app's own data: monsters and bosses from monsters-data.js, places from the
//      walkthrough's @where lines (passed in by app.js).
//   4. Built-in lists of FF6 names below.
// When a name lands in more than one group, the first match in PRIORITY wins.
// Only capitalized words match (or all capitals), so "shadow" and "mog" in ordinary text don't.

import { getPref, setPref } from "./store.js";

export const KINDS = ["party", "boss", "enemy", "place"];
export const KIND_LABEL = { party: "Characters", boss: "Bosses", enemy: "Monsters", place: "Places" };
const PRIORITY = ["boss", "party", "enemy", "place"];

const BUILTIN = {
  party: ["Terra", "Locke", "Edgar", "Sabin", "Celes", "Cyan", "Shadow", "Gau", "Setzer", "Mog", "Strago", "Relm",
    "Gogo", "Umaro", "Banon", "Leo", "Biggs", "Wedge"],
  boss: ["Kefka", "Ultros", "Ymir", "Whelk", "Vargas", "Tunnel Armor", "Dadaluma", "Number 024", "Number 128",
    "Phantom Train", "Typhon", "Air Force", "Flame Eater", "Chadarnook", "Wrexsoul", "Hidon", "Deathgaze",
    "Humbaba", "Phunbaba", "Dullahan", "Kaiser Dragon", "Omega Weapon", "Gilgamesh"],
  place: ["Narshe", "Figaro", "Figaro Castle", "Figaro Cave", "South Figaro", "Sabin's Hut", "Mt. Koltz", "Mt. Kolts",
    "Returners' Hideout", "Lethe River", "Lete River", "Imperial Camp", "Doma", "Doma Castle", "Phantom Forest",
    "Baren Falls", "Veldt", "Mobliz", "Crescent Mountain", "Serpent Trench", "Nikeah", "Kohlingen", "Zozo",
    "Mt. Zozo", "Jidoor", "Opera House", "Vector", "Magitek Research Facility", "Albrook", "Tzen", "Maranda",
    "Thamasa", "Sealed Gate", "Esper World", "Floating Continent", "Solitary Island", "Phoenix Cave",
    "Kefka's Tower", "Ancient Castle", "Owzer's Mansion", "Darill's Tomb", "Daryl's Tomb", "Ebot's Rock",
    "Umaro's Cave", "Cultists' Tower", "Fanatics' Tower"],
};

export const loadTags = () => getPref("tags", []);
export const saveTags = (tags) => setPref("tags", tags.length ? tags : null);

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (s) => s.replace(/\s+/g, " ").replace(/^(?:the|a|an)\s+/i, "").replace(/(?:\s*\([^)]*\))+\s*$/, "").replace(/[\s.,;:!?]+$/, "").trim();
const plausible = (s) => s.length >= 3 && s.length <= 40 && /^\p{Lu}/u.test(s) && s.split(" ").length <= 5;

// Every name to color, with its group: Map(term -> kind).
// found: { boss: [...], enemy: [...], place: [...] } from the app's data.
export function buildTerms(found = {}, names = [], tags = []) {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, new Set()]));
  for (const k of KINDS) for (const t of found[k] || []) { const c = clean(t); if (plausible(c)) byKind[k].add(c); }
  for (const k of KINDS) for (const t of BUILTIN[k] || []) byKind[k].add(t);
  for (const n of names) { const to = (n.to || "").trim(); if (to) byKind.party.add(to); }
  const terms = new Map();
  for (const k of PRIORITY) for (const t of byKind[k]) if (!terms.has(t)) terms.set(t, k);
  for (const t of tags) {
    const text = (t.text || "").trim();
    if (!text) continue;
    if (t.kind === "none") { terms.delete(text); for (const k of [...terms.keys()]) if (k.toLowerCase() === text.toLowerCase()) terms.delete(k); }
    else if (KINDS.includes(t.kind)) terms.set(text, t.kind);
  }
  return terms;
}

// A matcher for a set of terms: { re, kindOf(match) }.
export function matcher(terms) {
  if (!terms.size) return null;
  const lookup = new Map();
  for (const [t, k] of terms) { lookup.set(t, k); lookup.set(t.toUpperCase(), k); }
  const alts = [...lookup.keys()].sort((a, b) => b.length - a.length).map(reEsc).join("|");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?:e?s)?(?![\\p{L}\\p{N}])`, "gu");
  const kindOf = (m) => lookup.get(m) || lookup.get(m.replace(/e?s$/, "")) || lookup.get(m.replace(/s$/, ""));
  return { re, kindOf };
}

const SKIP = "a, button, .toc, .num, .sec-maps, .pager, mark, .ent, script, style";

// Wraps names in the container's text with <span class="ent ent-<kind>">.
export function markNames(container, m) {
  if (!container || !m) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const t = node.nodeValue;
    m.re.lastIndex = 0;
    let hit = m.re.exec(t);
    if (!hit) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    while (hit) {
      const kind = m.kindOf(hit[0]);
      if (kind) {
        frag.appendChild(document.createTextNode(t.slice(pos, hit.index)));
        const span = document.createElement("span");
        span.className = "ent ent-" + kind;
        span.textContent = hit[0];
        frag.appendChild(span);
        pos = hit.index + hit[0].length;
      }
      hit = m.re.exec(t);
    }
    frag.appendChild(document.createTextNode(t.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }
}
