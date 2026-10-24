// Monster intel: type a monster's name to see its weaknesses, steals and more, or pick it from a
// grid of pictures. The selected monster is kept in the URL (#/monsters/<name>).

import { MONSTERS, IMG_BASE } from "./monsters-data.js";
import { RAGES } from "./rages-data.js";
import { loadRages, saveRages, gauNow, rageDamage, rageLabel } from "./rages.js";
import { esc } from "./render.js";

const byName = new Map(MONSTERS.map((m) => [m.name.toLowerCase(), m]));
const rageOf = new Map(RAGES.filter((r) => !r.never).map((r) => [r.name.toLowerCase(), r]));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export const imgUrl = (m) => (m.img ? IMG_BASE + m.img : "");
export const findMonster = (name) => byName.get(String(name).toLowerCase()) || null;

const ELEM_LABEL = { weak: "Weak to", absorb: "Absorbs", immune: "Unaffected by", resist: "Resists" };

// Statuses the party can inflict and how (Pixel Remaster spell names). The card lists the ways in
// for each status the monster isn't immune to.
const INFLICT = [
  ["Death", "Death, Banish"], ["Petrify", "Break"], ["Stop", "Stop"], ["Sleep", "Sleep"],
  ["Confuse", "Confuse"], ["Berserk", "Berserk"], ["Silence", "Silence"], ["Slow", "Slow, Slowga"],
  ["Imp", "Imp"], ["Poison", "Poison"], ["Control", "Relm's Control"],
];

function pic(m, cls) {
  return m.img
    ? `<img class="${cls}" src="${esc(imgUrl(m))}" alt="" loading="lazy" referrerpolicy="no-referrer" decoding="async">`
    : `<span class="${cls} mn-noimg" aria-hidden="true">${esc(m.name[0])}</span>`;
}

const drops = (list) => list.map(([item, odds]) => `${esc(item)} <span class="mn-odds">${odds}</span>`).join(" · ");

function formHtml(f) {
  const stat = (k, label) => (f[k] != null ? `<div><dt>${label}</dt><dd>${esc(f[k])}</dd></div>` : "");
  const rows = [];
  const row = (label, html) => { if (html) rows.push(`<tr><th scope="row">${label}</th><td>${html}</td></tr>`); };
  for (const k of ["weak", "absorb", "immune", "resist"]) {
    if (f.el && f.el[k]) row(ELEM_LABEL[k], f.el[k].map((e) => `<span class="chip-el el-${k}">${esc(e)}</span>`).join(" "));
  }
  if (f.imm) row("Immune to", esc(f.imm.join(", ")));
  const open = INFLICT.filter(([st]) => !(f.imm || []).includes(st));
  row("Susceptible to", open.map(([st, how]) => `<span class="mn-sus">${esc(how)}${how === st ? "" : ` <span class="mn-odds">${esc(st)}</span>`}</span>`).join(" · "));
  if (f.traits) row("Notes", esc(f.traits.join(" · ")));
  if (f.steal) row("Steal", drops(f.steal));
  if (f.drop) row("Drops", drops(f.drop));
  if (f.special) row("Special", esc(f.special));
  if (f.other) row("Also uses", esc(f.other));
  if (f.rage) row("Rage", esc(f.rage));
  if (f.sketch) row("Sketch", esc(f.sketch));
  if (f.control) row("Control", esc(f.control));
  if (f.where) row("Found in", esc(f.where));
  return `<dl class="mn-stats">${stat("level", "Level")}${stat("hp", "HP")}${stat("mp", "MP")}${stat("exp", "EXP")}${stat("gil", "Gil")}</dl>
    <table class="gr-tbl mn-tbl"><tbody>${rows.join("")}</tbody></table>${rageAdvice(f)}`;
}

// Gau's learned Rages ranked against this monster form, using its weaknesses.
function rageAdvice(f) {
  const learned = new Set(loadRages());
  if (!learned.size) return "";
  const gau = gauNow();
  const rated = RAGES.filter((r) => learned.has(r.name)).map((r) => ({ r, d: rageDamage(r, gau, f) }));
  const hitting = rated.filter(({ d }) => d.special != null && d.special > 0 && (d.kind === "magic" || d.kind === "phys" || d.kind === "frac"));
  const best = hitting.sort((a, b) => b.d.special - a.d.special).slice(0, 5);
  const avoid = rated.filter(({ d }) => d.factor <= 0);
  if (!best.length && !avoid.length) return "";
  const tag = (d) => (d.factor === 2 ? ` <span class="chip-el el-weak">weak ×2</span>` : d.factor === 0.5 ? ` <span class="chip-el el-resist">resists</span>` : "");
  return `<div class="mn-rages"><p class="mn-rh">Gau's best Rages here <span class="mn-odds">level ${gau.level}</span></p>
    <ol>${best.map(({ r, d }) => `<li><strong>${esc(r.name)}</strong> · ${esc(r.ability)}${tag(d)} <span class="mn-odds">${esc(rageLabel(r, d))}</span></li>`).join("")}</ol>
    ${avoid.length ? `<p class="mn-avoid">Avoid: ${avoid.map(({ r, d }) => `${esc(r.name)} (${esc(r.ability)}, ${d.factor < 0 ? "absorbed" : "no effect"})`).join(", ")}</p>` : ""}</div>`;
}

function cardHtml(m) {
  const forms = m.forms || [m];
  const rage = rageOf.get(m.name.toLowerCase());
  const learned = rage && loadRages().includes(rage.name);
  return `<article class="mn-card" aria-labelledby="mnName">
    <header class="mn-head">
      ${pic(m, "mn-big")}
      <div>
        <h2 id="mnName">${esc(m.name)}${m.alt ? ` <span class="rg-alt">${esc(m.alt)}</span>` : ""}</h2>
        <p class="mn-tags">${m.boss ? `<span class="badge boss">Boss</span>` : ""}${m.b ? `<span class="badge">Bestiary ${String(m.b).padStart(3, "0")}</span>` : ""}${rage && rage.lore ? `<span class="badge lore">Lore via Rage</span>` : ""}</p>
      </div>
    </header>
    ${forms.length > 1 ? `<div class="seg mn-forms" role="tablist" aria-label="Forms">${forms.map((f, i) => `<button type="button" role="tab" data-f="${i}" aria-selected="${i === 0}">${esc(f.name)}</button>`).join("")}</div>` : ""}
    <div class="mn-form">${formHtml(forms[0])}</div>
    <div class="mn-actions">
      ${rage ? `<label class="mn-rage"><input type="checkbox" id="mnRage"${learned ? " checked" : ""}> Gau has learned the ${esc(rage.name)} Rage</label>` : ""}
      <button type="button" class="txt-btn" id="mnFind">Find ${esc(m.name)} in the guide</button>
    </div>
  </article>`;
}

// ctx: { onFind(name), onRage(), toast(msg) }
export function renderMonsters(view, selected, ctx) {
  view.innerHTML = `
  <section class="rages monsters">
    <p class="eyebrow">Battle help</p>
    <h1>Monster intel</h1>
    <div class="mn-search">
      <input type="search" id="mnQ" placeholder="Type a monster's name" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="search" aria-label="Monster name">
    </div>
    <div id="mnCard"></div>
    <p class="hint" id="mnCount"></p>
    <ol class="mn-grid" id="mnGrid">${MONSTERS.map((m, i) => `<li><button type="button" class="mn-pick" data-i="${i}">${pic(m, "mn-pic")}<span class="mn-n">${esc(m.name)}</span></button></li>`).join("")}</ol>
    <p class="hint small">${MONSTERS.length} monsters and bosses, without the GBA-only ones. Stats, steals and pictures from the <a href="https://finalfantasy.fandom.com/wiki/Category:Enemies_in_Final_Fantasy_VI" target="_blank" rel="noopener noreferrer">Final Fantasy Wiki</a> (CC BY-SA); steal odds from <a href="https://gamercorner.net/ffvi/monsters/" target="_blank" rel="noopener noreferrer">Gamer Corner</a>. Pictures load from the wiki; ones you've seen are kept for offline use. <button type="button" class="txt-btn mn-save" id="mnSave">Save all pictures for offline</button></p>
  </section>`;

  const q = view.querySelector("#mnQ");
  const grid = view.querySelector("#mnGrid");
  const items = [...grid.children];
  const card = view.querySelector("#mnCard");
  let current = null;

  const show = (m, { scroll = true } = {}) => {
    current = m;
    card.innerHTML = m ? cardHtml(m) : "";
    history.replaceState(null, "", m ? "#/monsters/" + encodeURIComponent(m.name) : "#/monsters");
    for (const b of grid.querySelectorAll(".mn-pick")) b.setAttribute("aria-pressed", String(m && MONSTERS[+b.dataset.i] === m));
    if (m && scroll) card.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const filter = () => {
    const t = norm(q.value);
    let shown = 0, only = null;
    items.forEach((li, i) => {
      const m = MONSTERS[i];
      const hit = !t || norm(m.name).includes(t) || (m.alt && norm(m.alt).includes(t));
      li.hidden = !hit;
      if (hit) { shown++; only = m; }
    });
    view.querySelector("#mnCount").textContent = t ? (shown ? `${shown} match${shown === 1 ? "" : "es"}` : "No monster by that name. Try part of the name, or its SNES name.") : "";
    // An exact name, or a single match, opens straight away.
    const exact = t && MONSTERS.find((m) => norm(m.name) === t || (m.alt && norm(m.alt) === t));
    if (exact || (t && shown === 1)) { if (current !== (exact || only)) show(exact || only, { scroll: false }); }
  };

  q.addEventListener("input", filter);
  q.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = items.find((li) => !li.hidden);
    if (first) { show(MONSTERS[+first.firstElementChild.dataset.i]); q.blur(); }
  });
  grid.addEventListener("click", (e) => {
    const b = e.target.closest(".mn-pick");
    if (b) show(MONSTERS[+b.dataset.i]);
  });
  card.addEventListener("click", (e) => {
    const tab = e.target.closest(".mn-forms button");
    if (tab && current) {
      for (const b of card.querySelectorAll(".mn-forms button")) b.setAttribute("aria-selected", String(b === tab));
      card.querySelector(".mn-form").innerHTML = formHtml(current.forms[+tab.dataset.f]);
    }
    if (e.target.closest("#mnFind") && current) ctx.onFind(current.name);
  });
  card.addEventListener("change", (e) => {
    if (e.target.id !== "mnRage" || !current) return;
    const name = rageOf.get(current.name.toLowerCase()).name;
    const have = new Set(loadRages());
    if (e.target.checked) have.add(name); else have.delete(name);
    saveRages(RAGES.filter((r) => have.has(r.name)).map((r) => r.name));
    ctx.onRage();
  });
  view.querySelector("#mnSave").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const urls = MONSTERS.filter((m) => m.img).map(imgUrl);
    let done = 0, failed = 0;
    for (let i = 0; i < urls.length; i += 8) {
      await Promise.all(urls.slice(i, i + 8).map((u) => fetch(u, { mode: "no-cors", referrerPolicy: "no-referrer" }).then(() => done++, () => failed++)));
      btn.textContent = `Saving pictures… ${done + failed} of ${urls.length}`;
    }
    btn.textContent = failed ? `Saved ${done} pictures; ${failed} couldn't be fetched` : `Saved all ${done} pictures for offline`;
    ctx.toast(failed ? "Some pictures couldn't be saved. Try again online." : "Monster pictures saved for offline");
  });

  if (selected) show(selected, { scroll: false });
  filter();
  if (!selected) q.focus();
}
