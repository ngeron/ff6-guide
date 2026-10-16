// Gau's Rages tracker: a checklist of every Rage, saved on this device and in backups.
// Learned Rages are stored by name in the "rages" setting.

import { RAGES } from "./rages-data.js";
import { CHARS } from "./party-data.js";
import { evaluate } from "./optimizer.js";
import { getPref, setPref } from "./store.js";
import { esc } from "./render.js";

const LEARNABLE = RAGES.filter((r) => !r.never);

export const loadRages = () => getPref("rages", []);
export const saveRages = (names) => setPref("rages", names.length ? names : null);

export function rageCounts() {
  const have = new Set(loadRages());
  return { have: LEARNABLE.filter((r) => have.has(r.name)).length, total: LEARNABLE.length };
}

const FILTERS = [["all", "All"], ["missing", "Missing"], ["learned", "Learned"], ["lore", "Lores"]];
export const ELEMENTS = ["Fire", "Ice", "Lightning", "Water", "Wind", "Earth", "Poison", "Holy"];
const ELEM_FILTERS = [["any", "Any attack"], ...ELEMENTS.map((e) => [e, e]), ["none", "No element"], ["status", "Status or support"]];

// ---------------- strength ----------------
// A Rage turn is either Gau's plain attack or the Rage's ability, about half the time each.
// Estimates use Gau's level and equipment from the Party page (level 20 with no gear if unset):
//   plain attack and physical abilities: his Fight estimate (× the ability's multiplier);
//   spell-style abilities: power × his magic estimate for a 60-power spell / 60, halved when it
//   splits across all enemies; HP-fraction abilities (Demi, Cyclonic): that share of the target's HP.
export function gauNow() {
  const p = getPref("party", null);
  const g = p && p.chars && p.chars.Gau;
  const level = (g && g.level) || 20;
  const ev = evaluate(CHARS.find((c) => c.name === "Gau"), level, (g && g.eq) || {});
  return { level, fight: ev.fight, mag60: ev.magic, set: !!(g && g.met) };
}

export const rageKind = (r) => (r.tgt === "ally" ? "support" : r.mult ? "phys" : r.pow ? "magic" : r.frac ? "frac" : "status");

// Element multiplier against a monster's elemental profile { weak, absorb, immune, resist }.
export function elementFactor(els, prof) {
  if (!els || !els.length || !prof) return 1;
  const has = (k) => els.some((e) => (prof[k] || []).includes(e));
  if (has("absorb")) return -1;
  if (has("immune")) return 0;
  if (has("weak")) return 2;
  if (has("resist")) return 0.5;
  return 1;
}

// { special, perTurn, factor } for a Rage, optionally against a monster form { el, hp }.
export function rageDamage(r, gau, target) {
  const kind = rageKind(r);
  let special = null;
  if (kind === "phys") special = gau.fight * r.mult;
  else if (kind === "magic") special = (gau.mag60 * r.pow) / 60 * (r.tgt === "all" ? 0.5 : 1);
  else if (kind === "frac" && target && +target.hp) { const [a, b] = r.frac.split("/").map(Number); special = (+target.hp * a) / b; }
  const factor = target ? elementFactor(r.el, target.el) : 1;
  if (special != null) special = Math.round(special * factor);
  const perTurn = Math.round(0.5 * gau.fight + 0.5 * Math.max(0, special || 0));
  return { special, perTurn, factor, kind };
}

export function rageLabel(r, d) {
  const el = r.el ? r.el.join("/") : "";
  if (d.kind === "support") return `helps an ally${r.st ? ` (${r.st.join(", ")})` : ""}`;
  if (d.kind === "status") return r.st ? `causes ${r.st.join(", ")}` : "no damage";
  if (d.kind === "frac" && d.special == null) return `takes ${r.frac} of the target's HP`;
  const tgt = r.tgt === "all" ? ", all enemies (split)" : r.tgt === "allfull" ? ", all enemies" : r.tgt === "both" ? ", hits your party too" : "";
  return `≈ ${d.special.toLocaleString()} damage${el ? ` · ${el}` : ""}${tgt}`;
}
const findIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>`;

// ctx: { onFind(name), onChange(), toast(msg) }
export function renderRages(view, ctx) {
  let have = new Set(loadRages());
  let filter = getPref("rageFilter", "all");
  let elFilter = getPref("rageEl", "any");
  let sort = getPref("rageSort", "menu");
  const gau = gauNow();
  const dmg = RAGES.map((r) => rageDamage(r, gau));
  if (!FILTERS.some(([v]) => v === filter)) filter = "all";

  view.innerHTML = `
  <section class="rages">
    <p class="eyebrow">Tracker</p>
    <h1>Gau's Rages</h1>
    <p class="rg-stat"><strong id="rgHave"></strong> of ${LEARNABLE.length} learned</p>
    <div class="meter"><i id="rgFill"></i></div>
    <p class="hint">Gau learns a Rage when he uses Leap on the Veldt after your party has fought that monster somewhere else. Rages marked <span class="badge lore">Lore</span> also teach Strago a Lore when he's in the party and sees Gau use them.</p>
    <p class="hint" id="rgGau"></p>
    <div class="rg-tools">
      <input type="search" id="rgQ" placeholder="Find a Rage, ability or bestiary number" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Find a Rage or ability">
      <div class="seg" role="radiogroup" aria-label="Show" id="rgSeg">${FILTERS.map(([v, t]) => `<button type="button" role="radio" data-v="${v}">${t}</button>`).join("")}</div>
      <select id="rgEl" aria-label="Attack type">${ELEM_FILTERS.map(([v, t]) => `<option value="${v}"${v === elFilter ? " selected" : ""}>${t}</option>`).join("")}</select>
      <select id="rgSort" aria-label="Order"><option value="menu"${sort === "menu" ? " selected" : ""}>Menu order</option><option value="strong"${sort === "strong" ? " selected" : ""}>Strongest first</option></select>
    </div>
    <button type="button" class="txt-btn rg-start" id="rgStart" hidden>Mark the Rages Gau starts with</button>
    <p class="hint" id="rgCount"></p>
    <ol class="rg-list" id="rgList">${RAGES.map((r, i) => `
      <li class="rg${r.never ? " never" : ""}" data-i="${i}">
        <label>
          <input type="checkbox"${r.never ? " disabled" : ""}>
          <span class="rg-main">
            <span class="rg-name">${esc(r.name)}${r.alt ? ` <span class="rg-alt">${esc(r.alt)}</span>` : ""}</span>
            <span class="rg-ab">${esc(r.ability)} <span class="rg-pow" data-k="${rageKind(r)}"></span>${r.b ? ` · Bestiary ${String(r.b).padStart(3, "0")}` : ""}${r.lore ? ` <span class="badge lore">Lore</span>` : ""}${r.start ? ` <span class="badge">Starting</span>` : ""}</span>
            ${r.note ? `<span class="rg-note">${esc(r.note)}</span>` : ""}
          </span>
        </label>
        <button type="button" class="rg-find" aria-label="Find ${esc(r.name)} in the guide">${findIcon}</button>
      </li>`).join("")}
    </ol>
    <p class="hint small">The second, smaller name is the monster's name in the original SNES release. Rage list from Felipe Chalreo's <a href="https://felipechalreo.github.io/ff6-gau-rage-checklist/" target="_blank" rel="noopener noreferrer">FF6 Gau Rage Checklist</a> (MIT license) and the <a href="https://finalfantasy.fandom.com/wiki/Rage_(Final_Fantasy_VI_command)" target="_blank" rel="noopener noreferrer">Final Fantasy Wiki</a>.</p>
  </section>`;

  const list = view.querySelector("#rgList");
  const rows = [...list.children];

  view.querySelector("#rgGau").innerHTML = `Damage estimates are for Gau at level ${gau.level}${gau.set ? " with his Party page equipment" : ' (set his level on the <a href="#/party">Party page</a>)'}. A Rage uses its ability about half the time and attacks the rest.`;
  rows.forEach((li, i) => {
    const r = RAGES[i], d = dmg[i];
    const pow = li.querySelector(".rg-pow");
    pow.textContent = rageLabel(r, d);
    if (r.el) pow.dataset.el = r.el[0];
  });
  const order = () => {
    const sorted = sort === "strong" ? [...rows].sort((a, b) => (dmg[+b.dataset.i].special ?? -1) - (dmg[+a.dataset.i].special ?? -1)) : [...rows].sort((a, b) => a.dataset.i - b.dataset.i);
    for (const li of sorted) list.appendChild(li);
  };
  const update = () => {
    const n = LEARNABLE.filter((r) => have.has(r.name)).length;
    view.querySelector("#rgHave").textContent = n;
    view.querySelector("#rgFill").style.width = Math.round((n / LEARNABLE.length) * 100) + "%";
    view.querySelector("#rgStart").hidden = RAGES.every((r) => !r.start || have.has(r.name));
    const q = view.querySelector("#rgQ").value.trim().toLowerCase();
    let shown = 0;
    rows.forEach((li, i) => {
      const r = RAGES[i];
      const on = have.has(r.name);
      li.classList.toggle("on", on);
      li.querySelector("input").checked = on;
      const match = !q || [r.name, r.alt, r.ability, r.b && String(r.b).padStart(3, "0")].some((s) => s && s.toLowerCase().includes(q));
      const kind = dmg[i].kind;
      const elOk = elFilter === "any" ? true : elFilter === "none" ? !r.el && (kind === "phys" || kind === "magic" || kind === "frac") : elFilter === "status" ? kind === "status" || kind === "support" : (r.el || []).includes(elFilter);
      const pass = (filter === "all" ? true : filter === "learned" ? on : filter === "missing" ? !on && !r.never : !!r.lore) && elOk;
      li.hidden = !(match && pass);
      if (!li.hidden) shown++;
    });
    view.querySelector("#rgCount").textContent = shown === RAGES.length ? "" : `Showing ${shown} of ${RAGES.length}.`;
    for (const b of view.querySelectorAll("#rgSeg button")) b.setAttribute("aria-checked", String(b.dataset.v === filter));
  };
  const save = () => { saveRages(RAGES.filter((r) => have.has(r.name)).map((r) => r.name)); ctx.onChange(); };

  list.addEventListener("change", (e) => {
    const li = e.target.closest("li");
    if (!li || e.target.type !== "checkbox") return;
    const r = RAGES[+li.dataset.i];
    if (e.target.checked) have.add(r.name); else have.delete(r.name);
    save();
    update();
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".rg-find");
    if (b) ctx.onFind(RAGES[+b.closest("li").dataset.i].name);
  });
  view.querySelector("#rgSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filter = b.dataset.v;
    setPref("rageFilter", filter);
    update();
  });
  view.querySelector("#rgQ").addEventListener("input", update);
  view.querySelector("#rgEl").addEventListener("change", (e) => { elFilter = e.target.value; setPref("rageEl", elFilter); update(); });
  view.querySelector("#rgSort").addEventListener("change", (e) => { sort = e.target.value; setPref("rageSort", sort); order(); });
  view.querySelector("#rgStart").addEventListener("click", () => {
    const start = RAGES.filter((r) => r.start && !have.has(r.name));
    for (const r of start) have.add(r.name);
    save();
    update();
    ctx.toast(`Marked ${start.length} starting Rage${start.length === 1 ? "" : "s"}`);
  });
  order();
  update();
}
