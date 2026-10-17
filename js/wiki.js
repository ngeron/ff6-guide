// Wiki: short articles on the characters, people, places, espers and items the walkthrough
// mentions (#/wiki, #/wiki/<kind>/<id>), the links that colored names in the walkthrough get,
// and the summary that pops up over them (hover with a mouse, tap on a touch screen).
//
// Characters, people and places are written for this app (wiki-data.js). Espers come from
// espers-data.js and items from gear-data.js and party-data.js, with a note on what they do
// (ITEM_NOTES). Monsters stay in Monster intel; their links get a summary too.
//
// Article text can hold a block { after: "<chapter slug>", text }: it's about something that
// happens later, so it stays folded until you've reached that chapter (marked it done, or opened
// it or a later one).

import { ARTICLES, ITEM_NOTES } from "./wiki-data.js";
import { ESPERS } from "./espers-data.js";
import { GEAR as ALL_GEAR } from "./gear-data.js";
import { EQUIP, CHARS } from "./party-data.js";
import { MONSTERS } from "./monsters-data.js";
import { findMonster } from "./monsters.js";
import { inline, chapterText } from "./walkthrough.js";
import { esc } from "./render.js";

const GEAR = ALL_GEAR.filter((g) => !g.gba);
const slug = (s) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const GROUPS = [
  ["party", "Characters"], ["npc", "People"], ["place", "Places"], ["esper", "Espers"],
  ["weapon", "Weapons"], ["shield", "Shields"], ["helmet", "Helmets"], ["armor", "Armor"], ["relic", "Relics"], ["item", "Items"],
];
const GROUP_LABEL = Object.fromEntries(GROUPS);
// The color each kind of article gets in the walkthrough (tags.js kinds).
const COLOR = { party: "party", npc: "npc", place: "place", esper: "item", item: "item" };

const STAT_NAME = { str: "Strength", agi: "Agility", sta: "Stamina", mag: "Magic", hp: "HP", mp: "MP" };
const bonusText = (b) => (b ? `${STAT_NAME[b.stat] || b.stat} +${b.amt}${b.pct ? "%" : ""} at each level-up` : "");
const CODE_NAME = Object.fromEntries(CHARS.map((c) => [c.code, c.name]));

// Every entry: { kind, id, name, aka, sum, href, ... }. kind is party, npc, place, esper or item.
const ENTRIES = [];
for (const a of ARTICLES) ENTRIES.push({ ...a, aka: a.aka || [], href: `#/wiki/${a.kind}/${a.id}` });
for (const e of ESPERS) {
  ENTRIES.push({ kind: "esper", id: slug(e.name), name: e.name, aka: e.alt ? [e.alt] : [], esper: e, href: `#/wiki/esper/${slug(e.name)}`,
    sum: `Esper. Teaches ${e.spells.map(([s]) => s).join(", ")}${e.bonus ? `; ${bonusText(e.bonus)}` : ""}.` });
}
for (const g of GEAR) {
  ENTRIES.push({ kind: "item", id: slug(g.name), name: g.name, aka: [], gear: g, href: `#/wiki/item/${slug(g.name)}`,
    sum: ITEM_NOTES[g.name] || `${g.type}.` });
}
const byPath = new Map(ENTRIES.map((e) => [`${e.kind}/${e.id}`, e]));
// Name (lowercase) -> entries, in order of preference: articles, espers, items.
const byName = new Map();
for (const e of ENTRIES) for (const n of [e.name, ...e.aka]) {
  const k = n.toLowerCase();
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(e);
}

export const getEntry = (kind, id) => byPath.get(`${kind}/${id}`) || null;

// Names to color, by color kind: { party: [...], npc: [...], place: [...], item: [...] }.
export function wikiTerms() {
  const out = { party: [], npc: [], place: [], item: [] };
  for (const e of ENTRIES) out[COLOR[e.kind]].push(e.name, ...e.aka);
  return out;
}

// The entries a name in the text could mean ("Mog", "MOG", "Ribbons").
function candidates(text) {
  const t = text.toLowerCase();
  return byName.get(t) || byName.get(t.replace(/e?s$/, "")) || byName.get(t.replace(/s$/, "")) || [];
}

// Where a colored name links: the wiki entry of that color, a monster's card, or null.
// name is the name as written in the guide (renames already undone by the caller).
export function linkFor(name, kind) {
  if (kind === "boss" || kind === "enemy") {
    const m = findMonster(name) || findMonster(name.replace(/e?s$/, "")) || findMonster(name.replace(/s$/, ""));
    if (m) return "#/monsters/" + encodeURIComponent(m.name);
  }
  const c = candidates(name);
  const e = c.find((x) => COLOR[x.kind] === kind) || c[0];
  if (e) return e.href;
  const m = findMonster(name);
  return m ? "#/monsters/" + encodeURIComponent(m.name) : null;
}

/* ---------------- summaries ---------------- */

const num = (v) => (v == null || v === "" ? "" : Number(v).toLocaleString("en-US"));

function monsterSum(m) {
  const f = (m.forms && m.forms[0]) || m;
  const bits = [];
  if (f.level) bits.push(`Level ${f.level}`);
  if (f.hp) bits.push(`${num(f.hp)} HP`);
  if (f.el && f.el.weak) bits.push(`weak to ${f.el.weak.join(", ")}`);
  let s = bits.join(" · ");
  if (f.where) s += (s ? ". " : "") + `Found in ${f.where}.`;
  return s;
}

// What the popup shows for a link: { label, name, sum, href } or null.
export function peekFor(href) {
  let m = href.match(/^#\/wiki\/([a-z]+)\/(.+)$/);
  if (m) {
    const e = getEntry(m[1], decodeURIComponent(m[2]));
    if (e) return { label: kindLabel(e), name: e.name, sum: e.sum, href: e.href, color: COLOR[e.kind] };
  }
  m = href.match(/^#\/monsters\/(.+)$/);
  if (m) {
    const mon = findMonster(decodeURIComponent(m[1]));
    if (mon) return { label: mon.boss ? "Boss" : "Monster", name: mon.name, sum: monsterSum(mon), href, color: mon.boss ? "boss" : "enemy", more: "Monster intel" };
  }
  return null;
}

const kindLabel = (e) => (e.kind === "npc" ? "Person" : GROUP_LABEL[e.kind === "item" ? e.gear.cat : e.kind].replace(/s$/, ""));

// Entries whose name matches a search (lowercase), best first: [{ name, label, sum, href, color }].
// rename: the character renamer (names.js), or null.
export function searchWiki(ql, rename) {
  const out = [];
  for (const e of ENTRIES) {
    const shown = rename ? rename(e.name) : e.name;
    if ([shown, e.name, ...e.aka].some((n) => n.toLowerCase().includes(ql))) out.push({ name: e.name, label: kindLabel(e), sum: e.sum, href: e.href, color: COLOR[e.kind], starts: shown.toLowerCase().startsWith(ql) });
  }
  return out.sort((a, b) => b.starts - a.starts);
}

/* ---------------- pages ---------------- */

const groupOf = (e) => (e.kind === "item" ? e.gear.cat : e.kind);

// ctx: { rename(html) -> html, decorate(el, selfHref), reached() -> chapter number reached,
//        chapters() -> walkthrough chapters, back: { n, title } | null }
export function renderWiki(view, kind, id, ctx) {
  if (kind) {
    const e = getEntry(kind, id);
    if (e) return renderArticle(view, e, ctx);
  }
  renderIndex(view, ctx);
  return null;
}

function renderIndex(view, ctx) {
  const groups = GROUPS.map(([g, label]) => {
    const list = ENTRIES.filter((e) => groupOf(e) === g).sort((a, b) => a.name.localeCompare(b.name));
    const open = ["party", "npc", "place"].includes(g);
    return `<details class="wk-group" data-g="${g}"${open ? " open" : ""}><summary><span class="sum-in"><span class="t">${label}</span><span class="cnt">${list.length}</span></span></summary>
      <ul class="wk-list">${list.map((e) => `<li data-k="${esc([e.name, ...e.aka].join(" ").toLowerCase())}" data-n="${esc([e.name, ...e.aka].join("|").toLowerCase())}"><a href="${e.href}"><span class="ent ent-${COLOR[e.kind]}">${esc(e.name)}</span><span class="wk-s">${esc(e.sum)}</span></a></li>`).join("")}</ul></details>`;
  }).join("");
  view.innerHTML = ctx.rename(`
  <section class="wk">
    <p class="eyebrow">Who, where and what</p>
    <h1>Wiki</h1>
    <p class="hint">The characters, people, places, espers and items the walkthrough mentions. In the walkthrough, colored names link here; hover over one (or tap it on a touch screen) for a short summary. Later story stays folded until you reach that chapter.</p>
    <div class="mn-search"><input type="search" id="wkQ" placeholder="Type a name" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="search" aria-label="Name to look up"></div>
    <p class="hint" id="wkCount"></p>
    ${groups}
  </section>`);
  const q = view.querySelector("#wkQ");
  const dets = [...view.querySelectorAll(".wk-group")];
  const initial = dets.map((d) => d.open);
  q.addEventListener("input", () => {
    const t = q.value.trim().toLowerCase();
    let shown = 0;
    dets.forEach((d, i) => {
      let n = 0;
      for (const li of d.querySelectorAll("li")) { const hit = !t || li.dataset.k.includes(t); li.hidden = !hit; if (hit) n++; }
      d.hidden = !n;
      d.open = t ? n > 0 : initial[i];
      shown += n;
    });
    view.querySelector("#wkCount").textContent = t ? (shown ? `${shown} match${shown === 1 ? "" : "es"}` : "Nothing by that name.") : "";
  });
  q.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    // The best match: a name that is the search, then one that starts with it, then any.
    const t = q.value.trim().toLowerCase();
    const shown = [...view.querySelectorAll(".wk-group:not([hidden]) li:not([hidden])")];
    const names = (li) => li.dataset.n.split("|");
    const li = shown.find((x) => names(x).includes(t)) || shown.find((x) => names(x).some((n) => n.startsWith(t))) || shown[0];
    if (li) location.hash = li.firstElementChild.getAttribute("href");
  });
}

// Chapters that mention the entry: [{ c, n }].
function mentions(e, chapters) {
  const names = [e.name, ...e.aka].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.join("|")})(?:e?s)?(?![\\p{L}\\p{N}])`, "gu");
  const out = [];
  for (const c of chapters) {
    const n = (chapterText(c).match(re) || []).length;
    if (n) out.push({ c, n });
  }
  return out;
}

function bodyHtml(e, ctx) {
  const reached = ctx.reached();
  const chapters = ctx.chapters();
  return (e.body || []).map((b) => {
    if (typeof b === "string") return `<p>${inline(b)}</p>`;
    const c = chapters.find((x) => x.slug === b.after);
    if (!c || c.n <= reached) return `<p>${inline(b.text)}</p>`;
    return `<details class="wk-later"><summary>Later in the story: from chapter ${c.n}, ${esc(c.title)}</summary><p>${inline(b.text)}</p></details>`;
  }).join("");
}

function factsHtml(rows) {
  rows = rows.filter(([, v]) => v);
  return rows.length ? `<table class="gr-tbl wk-facts"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join("")}</tbody></table>` : "";
}

function esperFacts(x) {
  return [
    ["Teaches", x.spells.map(([s, r]) => `${esc(s)} <span class="mn-odds">×${r}</span>`).join(" · ")],
    ["Level-up", esc(bonusText(x.bonus) || "No bonus")],
    ["Summon", esc(x.summon || "")],
    ["Found", esc(x.found || "")],
  ];
}

function gearStats(q) {
  if (!q) return "";
  const bits = [];
  if (q.bp) bits.push(`Attack ${q.bp}`);
  if (q.def) bits.push(`Defense ${q.def}`);
  if (q.mdef) bits.push(`Magic defense ${q.mdef}`);
  if (q.ev) bits.push(`Evasion ${q.ev}`);
  if (q.mb) bits.push(`Magic evasion ${q.mb}`);
  for (const [k, l] of [["vig", "Strength"], ["spd", "Agility"], ["sta", "Stamina"], ["mag", "Magic"]]) if (q[k]) bits.push(`${l} ${q[k] > 0 ? "+" : ""}${q[k]}`);
  return bits.join(" · ");
}

function itemFacts(g) {
  const q = EQUIP[g.name];
  const who = q && q.who && (q.who === "all" ? "Everyone" : q.who.split(" ").map((c) => CODE_NAME[c] || c).join(", "));
  return [
    ["Type", esc(g.type)],
    ["Stats", esc(gearStats(q))],
    ["Special", esc(q && q.special || "")],
    ["Blocks", esc(q && q.prevent ? q.prevent.join(", ") : "")],
    ["Grants", esc(q && q.auto ? q.auto.join(", ") : "")],
    ["Equips", esc(who || "")],
    ["Price", g.buy ? `${num(g.buy)} gil` : "Not sold"],
    ["Sells for", g.sell ? `${num(g.sell)} gil` : ""],
    ...(g.get || []).map(([how, where]) => [how, esc(where)]),
    ["Note", esc(g.note || "")],
  ];
}

function renderArticle(view, e, ctx) {
  const facts = e.kind === "esper" ? esperFacts(e.esper) : e.kind === "item" ? itemFacts(e.gear) : (e.facts || []).map(([k, v]) => [k, inline(v)]);
  const refs = mentions(e, ctx.chapters());
  const mon = findMonster(e.name);
  const links = [];
  if (mon && e.kind !== "party") links.push(`<a class="chip" href="#/monsters/${encodeURIComponent(mon.name)}">${mon.boss ? "Boss" : "Monster"} intel: ${esc(mon.name)}</a>`);
  if (e.kind === "party" && CHARS.some((c) => c.name === e.name)) links.push(`<a class="chip" href="#/party">Party page</a>`);
  if (e.kind === "esper") links.push(`<a class="chip" href="#/party">Espers on the Party page</a>`);
  if (e.kind === "item") links.push(`<a class="chip" href="#/gear">Inventory</a>`);
  const alt = e.kind === "item" && e.gear.alt ? [e.gear.alt] : e.aka;
  view.innerHTML = ctx.rename(`
  <article class="sec wk-art">
    ${ctx.back ? `<a class="wk-back" href="#/walk/${ctx.back.n}">‹ Back to chapter ${ctx.back.n}, ${esc(ctx.back.title)}</a>` : ""}
    <p class="eyebrow"><a href="#/wiki">Wiki</a> · ${esc(kindLabel(e))}</p>
    <h1 class="wk-h"><span class="ent ent-${COLOR[e.kind]}">${esc(e.name)}</span></h1>
    ${alt.length ? `<p class="wk-aka">Also called ${alt.map(esc).join(", ")}${e.kind === "item" || e.kind === "esper" ? " (SNES)" : ""}</p>` : ""}
    <p class="wk-lead">${inline(e.sum)}</p>
    ${factsHtml(facts)}
    <div class="body wk-body">${bodyHtml(e, ctx)}</div>
    ${links.length ? `<div class="sec-maps wk-links">${links.join("")}</div>` : ""}
    <section class="wk-refs">
      <h2 class="sheet-sub">In the walkthrough</h2>
      ${refs.length ? `<ol class="chapters wt-list">${refs.map(({ c, n }) => `<li><a href="#/walk/${c.n}" data-q="${esc(e.name)}"><span class="n">${c.n}</span><span class="t">${esc(c.title)}</span>${n > 1 ? `<span class="cnt">${n}×</span>` : ""}</a></li>`).join("")}</ol>` : `<p class="hint">Not mentioned by name.</p>`}
    </section>
  </article>`);
  ctx.decorate(view.querySelector(".wk-body"), e.href);
  ctx.decorate(view.querySelector(".wk-facts"), e.href);
  return e;
}

/* ---------------- summary popup ---------------- */

// Shows a summary over links to wiki articles and monster cards inside container.
// With a mouse it appears on hover and a click follows the link; on a touch screen the first
// tap shows it and its button (or a second tap) follows the link.
// ctx: { el: popup element, rename(html) -> html }
export function bindPeek(container, ctx) {
  const pop = ctx.el;
  let target = null, showTimer = 0, hideTimer = 0, touch = false;
  const linkOf = (el) => el && el.closest && el.closest('a[href^="#/wiki/"], a[href^="#/monsters/"]');

  const hide = () => { clearTimeout(showTimer); clearTimeout(hideTimer); pop.hidden = true; target = null; };
  const show = (a) => {
    const p = peekFor(a.getAttribute("href"));
    if (!p) return;
    target = a;
    pop.innerHTML = ctx.rename(`<p class="eyebrow">${esc(p.label)}</p><p class="pk-name ent ent-${p.color}">${esc(p.name)}</p>${p.sum ? `<p class="pk-sum">${inline(p.sum)}</p>` : ""}<a class="pk-open" href="${esc(p.href)}">${p.more ? `Open ${esc(p.more)}` : "Read more"} ›</a>`);
    pop.hidden = false;
    const r = a.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8 + h < innerHeight - 8 || r.top - 8 - h < 60;
    pop.style.left = left + "px";
    pop.style.top = (below ? r.bottom + 8 : r.top - 8 - h) + "px";
  };

  container.addEventListener("pointerdown", (e) => { touch = e.pointerType === "touch"; }, true);
  container.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const a = linkOf(e.target);
    if (!a || a === target) { if (a) clearTimeout(hideTimer); return; }
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(a), target ? 60 : 280);
  });
  container.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch" || !linkOf(e.target)) return;
    if (linkOf(e.relatedTarget) === linkOf(e.target)) return;
    clearTimeout(showTimer);
    hideTimer = setTimeout(hide, 250);
  });
  pop.addEventListener("pointerover", () => clearTimeout(hideTimer));
  pop.addEventListener("pointerout", (e) => { if (!pop.contains(e.relatedTarget) && e.relatedTarget !== target) hideTimer = setTimeout(hide, 250); });
  container.addEventListener("click", (e) => {
    const a = linkOf(e.target);
    if (!a) return;
    if (touch && a !== target && peekFor(a.getAttribute("href"))) { e.preventDefault(); show(a); return; }
    hide();
  });
  pop.addEventListener("click", (e) => { if (e.target.closest("a")) hide(); });
  container.addEventListener("focusin", (e) => { const a = linkOf(e.target); if (a && a.matches(":focus-visible")) show(a); });
  container.addEventListener("focusout", (e) => { if (!pop.contains(e.relatedTarget)) hide(); });
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !pop.contains(e.target) && !linkOf(e.target)) hide(); });
  addEventListener("scroll", () => { if (!pop.hidden) hide(); }, { passive: true });
  addEventListener("hashchange", hide);
  addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
}
