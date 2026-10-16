// Inventory tracker: how many of each weapon, armor, relic and item you have, with shop prices
// and where to get each one. Counts are stored by name in the "gear" setting: { name: count }.

import { GEAR as ALL } from "./gear-data.js";
import { getPref, setPref } from "./store.js";
import { esc } from "./render.js";

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

export function gearCounts() {
  const g = loadGear();
  return { kinds: GEAR.filter((x) => g[x.name] > 0).length, total: GEAR.length };
}

const gil = (n) => n.toLocaleString() + " gil";
const findIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>`;

function details(x) {
  const rows = [
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
  let cat = getPref("gearCat", "all");
  let show = getPref("gearShow", "all");
  if (!CATS.some(([v]) => v === cat)) cat = "all";
  if (!SHOW.some(([v]) => v === show)) show = "all";

  view.innerHTML = `
  <section class="rages gear">
    <p class="eyebrow">Tracker</p>
    <h1>Inventory</h1>
    <p class="rg-stat"><strong id="grKinds"></strong> of ${GEAR.length} kinds · <span id="grValue"></span></p>
    <p class="hint">Check what you have and set how many. Tap a name for its prices and where to get it. In FF6 every shop charges the same for an item and pays the same for it, so you can sell anywhere.</p>
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
            <span class="rg-ab">${esc(x.type)}${x.sell ? ` · sells for ${gil(x.sell)}` : ""}</span>
          </button>
          <span class="gr-step">
            <button type="button" class="gr-dec" aria-label="One fewer ${esc(x.name)}">−</button>
            <input type="text" class="gr-n" inputmode="numeric" pattern="[0-9]*" maxlength="2" aria-label="How many ${esc(x.name)}">
            <button type="button" class="gr-inc" aria-label="One more ${esc(x.name)}">+</button>
          </span>
        </div>
        <div class="gr-more" id="gr${i}" hidden>
          ${details(x)}
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
    const n = have[x.name] || 0;
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
    for (const x of GEAR) { const n = have[x.name] || 0; if (n) { kinds++; value += n * (x.sell || 0); } }
    view.querySelector("#grKinds").textContent = kinds;
    view.querySelector("#grValue").textContent = `worth ${gil(value)} if sold`;
  };
  const filter = () => {
    const q = view.querySelector("#grQ").value.trim().toLowerCase();
    let shown = 0;
    rows.forEach((li, i) => {
      const x = GEAR[i];
      const n = have[x.name] || 0;
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
    if (n) have[x.name] = n; else delete have[x.name];
    saveGear(have);
    paintRow(li);
    totals();
    ctx.onChange();
  };

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const n = have[GEAR[+li.dataset.i].name] || 0;
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
    if (e.target.type === "checkbox") set(li, e.target.checked ? Math.max(1, have[GEAR[+li.dataset.i].name] || 0) : 0);
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
