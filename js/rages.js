// Gau's Rages tracker: a checklist of every Rage, saved on this device and in backups.
// Learned Rages are stored by name in the "rages" setting.

import { RAGES } from "./rages-data.js";
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
const findIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>`;

// ctx: { onFind(name), onChange(), toast(msg) }
export function renderRages(view, ctx) {
  let have = new Set(loadRages());
  let filter = getPref("rageFilter", "all");
  if (!FILTERS.some(([v]) => v === filter)) filter = "all";

  view.innerHTML = `
  <section class="rages">
    <p class="eyebrow">Tracker</p>
    <h1>Gau's Rages</h1>
    <p class="rg-stat"><strong id="rgHave"></strong> of ${LEARNABLE.length} learned</p>
    <div class="meter"><i id="rgFill"></i></div>
    <p class="hint">Gau learns a Rage when he uses Leap on the Veldt after your party has fought that monster somewhere else. Rages marked <span class="badge lore">Lore</span> also teach Strago a Lore when he's in the party and sees Gau use them.</p>
    <div class="rg-tools">
      <input type="search" id="rgQ" placeholder="Find a Rage, ability or bestiary number" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Find a Rage or ability">
      <div class="seg" role="radiogroup" aria-label="Show" id="rgSeg">${FILTERS.map(([v, t]) => `<button type="button" role="radio" data-v="${v}">${t}</button>`).join("")}</div>
    </div>
    <button type="button" class="txt-btn rg-start" id="rgStart" hidden>Mark the Rages Gau starts with</button>
    <p class="hint" id="rgCount"></p>
    <ol class="rg-list" id="rgList">${RAGES.map((r, i) => `
      <li class="rg${r.never ? " never" : ""}" data-i="${i}">
        <label>
          <input type="checkbox"${r.never ? " disabled" : ""}>
          <span class="rg-main">
            <span class="rg-name">${esc(r.name)}${r.alt ? ` <span class="rg-alt">${esc(r.alt)}</span>` : ""}</span>
            <span class="rg-ab">${esc(r.ability)}${r.b ? ` · Bestiary ${String(r.b).padStart(3, "0")}` : ""}${r.lore ? ` <span class="badge lore">Lore</span>` : ""}${r.start ? ` <span class="badge">Starting</span>` : ""}</span>
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
      const pass = filter === "all" ? true : filter === "learned" ? on : filter === "missing" ? !on && !r.never : !!r.lore;
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
  view.querySelector("#rgStart").addEventListener("click", () => {
    const start = RAGES.filter((r) => r.start && !have.has(r.name));
    for (const r of start) have.add(r.name);
    save();
    update();
    ctx.toast(`Marked ${start.length} starting Rage${start.length === 1 ? "" : "s"}`);
  });
  update();
}
