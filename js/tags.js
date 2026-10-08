// Color coding: marks playable characters, monsters, bosses and places in the text so a long
// section is easier to scan.
//
// Names come from four places, most trusted first:
//   1. Your own corrections ("tags" setting): [{ text, kind }], where kind is one of KINDS or
//      "none" to stop a word being colored.
//   2. Your character names (names.js): the names you chose count as playable characters.
//   3. The guide itself: "The battle with X" headings (bosses), place-name headings and
//      "Traveling to X" headings (places), "Opponents:" boxes, monster formation lines and stat
//      blocks (monsters, or bosses in a boss section).
//   4. Built-in lists of FF6 Advance names below.
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

// Heading words that aren't places.
const NOT_PLACES = new Set(["Introduction", "Contents", "Version History", "History", "Foreword", "Credits", "Index",
  "Appendix", "Walkthrough", "The Walkthrough", "Overworld", "Overworld Map", "Shops", "Items", "Equipment",
  "Weapons", "Armor", "Relics", "Bestiary", "Espers", "Magic", "Lores", "Rages", "Blitzes", "Tools", "Dances",
  "Legal", "Contact", "Thanks", "Copyright", "Conclusion", "Notes", "Glossary", "FAQ", "Secrets", "Side Quests"]);
const SMALL = new Set(["of", "the", "and", "on", "in", "to", "at"]);

export const loadTags = () => getPref("tags", []);
export const saveTags = (tags) => setPref("tags", tags.length ? tags : null);

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (s) => s.replace(/\s+/g, " ").replace(/^(?:the|a|an)\s+/i, "").replace(/(?:\s*\([^)]*\))+\s*$/, "").replace(/[\s.,;:!?]+$/, "").trim();
const plausible = (s) => s.length >= 3 && s.length <= 40 && /^\p{Lu}/u.test(s) && s.split(" ").length <= 5;
const titleCase = (s) => s.split(" ").every((w) => SMALL.has(w) || /^[\p{Lu}\d]/u.test(w));
// Capitalized phrases in a string: "Veldt to Mobliz" -> ["Veldt", "Mobliz"].
const capPhrases = (s) => (s.match(/\p{Lu}[\p{L}\d'.-]*(?:\s+(?:of\s+(?:the\s+)?)?\p{Lu}[\p{L}\d'.-]*)*/gu) || []);

const BATTLE = /^(?:the\s+)?(?:(?:first|second|third|final|last|rematch)\s+)?(?:battle|fight|rematch|showdown|duel)\s+(?:with|against|versus|vs\.?)\s+(.+)$/i;
const TRAVEL = /^(?:traveling|travelling|escaping|returning|heading|going|journeying|crossing|sailing|flying)\s+(?:back\s+)?(?:to|through|over|across|into|from|around|in|out of)\s+(.+)$/i;
const FORMATION = /^\p{Lu}[^,()]*(?:,\s*\p{Lu}[^,()]*)*\s*\(\d+\/\d+\)$/u;
const ENEMY_BOX = /^(?:opponents|enemies|monsters|bosses?)$/i;

// What the guide itself says about names: { term: kind }.
function fromGuide(doc) {
  const found = { party: new Set(), boss: new Set(), enemy: new Set(), place: new Set() };
  const add = (kind, s) => { s = clean(s); if (plausible(s)) found[kind].add(s); };
  for (const s of doc.sections) {
    const title = s.title.replace(/^[^:]{1,40}:\s+/, "").replace(/\s+(?:continued|revisited|again|\(.*\))$/i, "").trim();
    const battle = title.match(BATTLE);
    if (battle) for (const p of battle[1].split(/\s+and\s+/)) add("boss", p);
    if (s.level === 3 && !battle) {
      const travel = title.match(TRAVEL);
      if (travel) for (const p of capPhrases(travel[1])) add("place", p);
      else for (const p of clean(title).split(/\s+and\s+(?:the\s+)?/)) if (titleCase(p) && !NOT_PLACES.has(clean(p))) add("place", p);
    }
    const foe = battle ? "boss" : "enemy";
    for (const b of s.blocks) {
      if (b.type === "meta" && ENEMY_BOX.test(b.label)) {
        for (const p of b.text.split(/,|\band\b/)) add(foe, p.replace(/\([^)]*\)/g, "").replace(/\s+x\s*\d+$/i, ""));
      } else if (b.type === "lines") {
        b.items.forEach((it, i) => {
          const next = b.items[i + 1];
          if (next && /^Level:/.test(next.text) && !it.text.includes(":")) add(foe, it.text);
          if (FORMATION.test(it.text)) for (const p of it.text.replace(/\s*\(\d+\/\d+\)$/, "").split(",")) add("enemy", p.replace(/\s+x\s*\d+$/i, ""));
        });
      }
    }
  }
  for (const n of NOT_PLACES) found.place.delete(n);
  return found;
}

// Every name to color, with its group: Map(term -> kind).
export function buildTerms(doc, names = [], tags = []) {
  const byKind = fromGuide(doc);
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
