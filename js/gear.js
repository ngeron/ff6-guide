// Inventory tracker: how many of each weapon, armor, relic and item you have, with shop prices
// and where to get each one. Counts in the bag are stored by name in the "gear" setting:
// { name: count }. What characters wear is in the "party" setting; the page shows both together
// as what you own, so an equipped item isn't counted twice.

import { GEAR as ALL } from "./gear-data.js";
import { getPref, setPref } from "./store.js";
import { esc } from "./render.js";
import { loadNames } from "./names.js";
import { CHARS, EQUIP } from "./party-data.js";
import { relicNote } from "./optimizer.js";

// GBA-only gear (from the GBA bonus dungeons) isn't in the Pixel Remaster, so it's left out.
const GEAR = ALL.filter((x) => !x.gba);
const MAX = 99; // FF6 stacks stop at 99
const CATS = [["all", "All kinds"], ["weapon", "Weapons"], ["shield", "Shields"], ["helmet", "Helmets"], ["armor", "Armor"], ["relic", "Relics"], ["item", "Items"]];
const SHOW = [["all", "All"], ["owned", "Have"], ["missing", "Don't have"]];

export function loadGear() {
  const g = getPref("gear", {});
  return g && typeof g === "object" && !Array.isArray(g) ? g : {};
}
export function saveGear(g) {
  const out = {};
  for (const [k, v] of Object.entries(g)) if (v > 0) out[k] = Math.min(MAX, v | 0);
  setPref("gear", Object.keys(out).length ? out : null);
}

// Who wears what: { item: [character, ...] }, benched characters first, so they're the first to
// give an item up when you lower its count.
function worn() {
  const p = getPref("party", null);
  const out = {};
  if (!p || !p.chars) return out;
  const party = p.party || [];
  const order = Object.keys(p.chars).sort((a, b) => party.includes(a) - party.includes(b));
  for (const c of order) for (const n of Object.values(p.chars[c].eq || {})) if (n) (out[n] ||= []).push(c);
  return out;
}
// Takes one of an item off a character (benched characters first).
function unequip(item) {
  const p = getPref("party", null);
  const c = worn()[item]?.[0];
  if (!c) return "";
  const eq = p.chars[c].eq;
  delete eq[Object.keys(eq).find((s) => eq[s] === item)];
  setPref("party", p);
  return c;
}

export function gearCounts() {
  const g = loadGear(), w = worn();
  return { kinds: GEAR.filter((x) => (g[x.name] || 0) + (w[x.name] || []).length > 0).length, total: GEAR.length };
}

const gil = (n) => n.toLocaleString() + " gil";
const findIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>`;

// Equipment stats (from the Party page's data). Thrown weapons and Edgar's tools have none.
const BONUS = [["vig", "Strength"], ["spd", "Agility"], ["sta", "Stamina"], ["mag", "Magic"]];
const signed = (n) => (n > 0 ? "+" : "−") + Math.abs(n);
function brief(x) {
  const e = EQUIP[x.name];
  if (!e) return "";
  if (e.slot === "weapon") return e.bp ? `Attack ${e.bp}` : "";
  if (e.slot === "relic") return "";
  return [e.def && `Def ${e.def}`, e.mdef && `M.Def ${e.mdef}`].filter(Boolean).join(", ");
}
function who(e, shown) {
  if (!e.who) return "";
  const codes = e.who === "all" ? CHARS.map((c) => c.code) : e.who.split(" ");
  const can = CHARS.filter((c) => codes.includes(c.code)).map((c) => shown(c.name));
  const cant = CHARS.filter((c) => !codes.includes(c.code)).map((c) => shown(c.name));
  if (!cant.length) return "Everyone";
  if (cant.length <= 2) return `Everyone but ${cant.join(" and ")}`;
  return can.join(", ");
}
function stats(x, shown) {
  const e = EQUIP[x.name];
  if (!e) return [];
  const rows = [];
  if (e.slot === "weapon") {
    if (e.bp) rows.push(["Attack", e.bp]);
    if (e.hit) rows.push(["Hit rate", e.hit]);
  }
  if (e.def) rows.push(["Defense", e.def]);
  if (e.mdef) rows.push(["Magic Def.", e.mdef]);
  if (e.ev) rows.push(["Evasion", signed(e.ev)]);
  if (e.mb) rows.push(["Magic Eva.", signed(e.mb)]);
  const bonus = BONUS.filter(([k]) => e[k]).map(([k, t]) => `${t} ${signed(e[k])}`);
  if (bonus.length) rows.push(["Stats", bonus.join(", ")]);
  if (e.special) rows.push(["Special", e.special]);
  if (e.slot === "weapon" && e.twoHand) rows.push(["Gauntlet", "Can be held in both hands"]);
  if (e.slot === "relic") { const n = relicNote(x.name); if (n) rows.push(["Effect", n]); }
  else {
    if (e.auto) rows.push(["Grants", e.auto.join(", ")]);
    if (e.prevent) rows.push(["Blocks", e.prevent.join(", ")]);
  }
  if (e.elem > 0) rows.push(["Elements", `Guards against ${e.elem === 1 ? "one element" : `${e.elem} elements`}`]);
  if (e.elem < 0) rows.push(["Elements", "Leaves you weak to an element"]);
  const w = who(e, shown);
  if (w) rows.push(["Equip", w]);
  return rows;
}

function details(x, shown) {
  const rows = [
    ...stats(x, shown),
    ["Buy", x.buy ? gil(x.buy) : "Not sold in shops"],
    ["Sell", x.sell != null ? gil(x.sell) + " each" : "Not known"],
    ...(x.get || []).map(([how, where]) => [how === "Buy" ? "Sold at" : how, where]),
  ];
  return `<table class="gr-tbl"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}
    ${x.sell ? `<tr class="gr-total"><th scope="row">Selling all</th><td></td></tr>` : ""}</tbody></table>
    ${x.note ? `<p class="gr-note">${esc(x.note)}</p>` : ""}`;
}

// ctx: { onFind(name), onChange(), toast(msg) }
export function renderGear(view, ctx) {
  const have = loadGear();
  let wearing = worn();
  const names = loadNames();
  const shown = (c) => names.find((x) => x.from.trim().toLowerCase() === c.toLowerCase() && x.to.trim())?.to.trim() || c;
  const owned = (name) => (have[name] || 0) + (wearing[name] || []).length;
  let cat = getPref("gearCat", "all");
  let show = getPref("gearShow", "all");
  if (!CATS.some(([v]) => v === cat)) cat = "all";
  if (!SHOW.some(([v]) => v === show)) show = "all";

  view.innerHTML = `
  <section class="rages gear">
    <p class="eyebrow">Tracker</p>
    <h1>Inventory</h1>
    <p class="rg-stat"><strong id="grKinds"></strong> of ${GEAR.length} kinds · <span id="grValue"></span></p>
    <p class="hint">Count everything you own, including what your characters are wearing (set on the Party page). The game's Items screen leaves out equipped items, so add those in. Check what you have and set how many. Tap a name for its stats, prices and where to get it. In FF6 every shop charges the same for an item and pays the same for it, so you can sell anywhere.</p>
    <div class="rg-tools">
      <input type="search" id="grQ" placeholder="Find an item" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Find an item">
      <select id="grCat" aria-label="Kind">${CATS.map(([v, t]) => `<option value="${v}"${v === cat ? " selected" : ""}>${t}</option>`).join("")}</select>
      <div class="seg" role="radiogroup" aria-label="Show" id="grSeg">${SHOW.map(([v, t]) => `<button type="button" role="radio" data-v="${v}">${t}</button>`).join("")}</div>
    </div>
    <p class="hint" id="grCount"></p>
    <ol class="rg-list gr-list" id="grList">${GEAR.map((x, i) => `
      <li class="rg gr" data-i="${i}">
        <div class="gr-row">
          <input type="checkbox" aria-label="Have ${esc(x.name)}">
          <button type="button" class="gr-open" aria-expanded="false" aria-controls="gr${i}">
            <span class="rg-name">${esc(x.name)}${x.alt ? ` <span class="rg-alt">${esc(x.alt)}</span>` : ""}</span>
            <span class="rg-ab">${esc(x.type)}${brief(x) ? ` · ${brief(x)}` : ""}${x.sell ? ` · sells for ${gil(x.sell)}` : ""}<span class="gr-worn"></span></span>
          </button>
          <span class="gr-step">
            <button type="button" class="gr-dec" aria-label="One fewer ${esc(x.name)}">−</button>
            <input type="text" class="gr-n" inputmode="numeric" pattern="[0-9]*" maxlength="2" aria-label="How many ${esc(x.name)}">
            <button type="button" class="gr-inc" aria-label="One more ${esc(x.name)}">+</button>
          </span>
        </div>
        <div class="gr-more" id="gr${i}" hidden>
          ${details(x, shown)}
          <button type="button" class="txt-btn gr-find">${findIcon}Find ${esc(x.name)} in the guide</button>
        </div>
      </li>`).join("")}
    </ol>
    <p class="hint small">The second, smaller name is the item's name in the original SNES release. Item list, prices and sources adapted from the <a href="https://finalfantasy.fandom.com/wiki/Final_Fantasy_VI_weapons" target="_blank" rel="noopener noreferrer">Final Fantasy Wiki</a> (CC BY-SA); sell values from <a href="https://gamercorner.net/ffvi/" target="_blank" rel="noopener noreferrer">Gamer Corner</a>.</p>
  </section>`;

  const list = view.querySelector("#grList");
  const rows = [...list.children];

  const paintRow = (li) => {
    const x = GEAR[+li.dataset.i];
    const n = owned(x.name);
    const w = wearing[x.name] || [];
    li.querySelector(".gr-worn").textContent = w.length ? ` · worn by ${w.map(shown).join(", ")}` : "";
    li.classList.toggle("on", n > 0);
    li.querySelector('input[type="checkbox"]').checked = n > 0;
    li.querySelector(".gr-n").value = n ? String(n) : "";
    li.querySelector(".gr-dec").disabled = n === 0;
    li.querySelector(".gr-inc").disabled = n >= MAX;
    const t = li.querySelector(".gr-total td");
    if (t) t.textContent = n ? `${gil(n * x.sell)} for ${n}` : "—";
  };
  const totals = () => {
    let kinds = 0, value = 0;
    for (const x of GEAR) { const n = owned(x.name); if (n) { kinds++; value += n * (x.sell || 0); } }
    view.querySelector("#grKinds").textContent = kinds;
    view.querySelector("#grValue").textContent = `worth ${gil(value)} if sold`;
  };
  const filter = () => {
    const q = view.querySelector("#grQ").value.trim().toLowerCase();
    let shown = 0;
    rows.forEach((li, i) => {
      const x = GEAR[i];
      const n = owned(x.name);
      const match = !q || [x.name, x.alt, x.type].some((s) => s && s.toLowerCase().includes(q));
      const pass = (cat === "all" || x.cat === cat) && (show === "all" || (show === "owned" ? n > 0 : n === 0));
      li.hidden = !(match && pass);
      if (!li.hidden) shown++;
    });
    view.querySelector("#grCount").textContent = shown === GEAR.length ? "" : `Showing ${shown} of ${GEAR.length}.`;
    for (const b of view.querySelectorAll("#grSeg button")) b.setAttribute("aria-checked", String(b.dataset.v === show));
  };
  const set = (li, n) => {
    const x = GEAR[+li.dataset.i];
    n = Math.max(0, Math.min(MAX, n | 0));
    // Lowering the count below what's worn takes the extra copies off characters.
    const off = [];
    while ((wearing[x.name] || []).length > n) { off.push(unequip(x.name)); wearing = worn(); }
    if (off.length) ctx.toast(`Took ${x.name} off ${off.map(shown).join(" and ")}`);
    const bag = n - (wearing[x.name] || []).length;
    if (bag) have[x.name] = bag; else delete have[x.name];
    saveGear(have);
    paintRow(li);
    totals();
    ctx.onChange();
  };

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const n = owned(GEAR[+li.dataset.i].name);
    if (e.target.closest(".gr-inc")) return set(li, n + 1);
    if (e.target.closest(".gr-dec")) return set(li, n - 1);
    if (e.target.closest(".gr-find")) return ctx.onFind(GEAR[+li.dataset.i].name);
    const open = e.target.closest(".gr-open");
    if (open) {
      const more = li.querySelector(".gr-more");
      more.hidden = !more.hidden;
      open.setAttribute("aria-expanded", String(!more.hidden));
    }
  });
  list.addEventListener("change", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    if (e.target.type === "checkbox") set(li, e.target.checked ? Math.max(1, owned(GEAR[+li.dataset.i].name)) : 0);
    else if (e.target.classList.contains("gr-n")) set(li, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0);
  });
  view.querySelector("#grQ").addEventListener("input", filter);
  view.querySelector("#grCat").addEventListener("change", (e) => { cat = e.target.value; setPref("gearCat", cat); filter(); });
  view.querySelector("#grSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    show = b.dataset.v;
    setPref("gearShow", show);
    filter();
  });

  rows.forEach(paintRow);
  totals();
  filter();
}
