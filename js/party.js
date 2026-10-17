// Party page: the characters you've met, their levels and equipment, and the load-out optimizer.
// Stored in the "party" setting: { party: [name, ...], espers: [name, ...] (acquired), esperMode,
//   chars: { name: { met, level, goal, eq, lock, esper, spells: [learned spell names] } } }.
// Equipping here moves items out of the Inventory bag (the "gear" setting), as the game does.

import { CHARS, EQUIP } from "./party-data.js";
import { SLOTS, SLOT_LABEL, GOALS, evaluate, canEquip, slotFits, optimizeParty, canEquipEsper, assignEspers } from "./optimizer.js";
import { ESPERS } from "./espers-data.js";
import { loadGear, saveGear } from "./gear.js";
import { loadNames } from "./names.js";
import { getPref, setPref } from "./store.js";
import { esc } from "./render.js";

const MAX_PARTY = 4;
const blank = () => ({ met: false, level: 1, goal: "balanced", eq: {}, lock: {}, esper: "", spells: [] });
const ESPER = new Map(ESPERS.map((e) => [e.name, e]));
const STAT_NAME = { str: "Strength", agi: "Agility", sta: "Stamina", mag: "Magic", hp: "HP", mp: "MP" };
const bonusText = (b) => (b ? `${STAT_NAME[b.stat]} +${b.amt}${b.pct ? "%" : ""}` : "No level-up bonus");

export function loadParty() {
  const p = getPref("party", null);
  const out = { party: [], chars: {}, espers: [], esperMode: "spells" };
  if (p && typeof p === "object") {
    out.espers = Array.isArray(p.espers) ? p.espers.filter((n) => ESPER.has(n)) : [];
    if (p.esperMode === "bonus") out.esperMode = "bonus";
    out.party = Array.isArray(p.party) ? p.party.filter((n) => CHARS.some((c) => c.name === n)).slice(0, MAX_PARTY) : [];
    for (const c of CHARS) if (p.chars && p.chars[c.name]) out.chars[c.name] = { ...blank(), ...p.chars[c.name] };
  }
  return out;
}
export function saveParty(p) {
  const chars = {};
  for (const [n, c] of Object.entries(p.chars)) if (c.met || Object.values(c.eq || {}).some(Boolean) || c.esper || (c.spells || []).length) chars[n] = c;
  const any = p.party.length || Object.keys(chars).length || p.espers.length;
  setPref("party", any ? { party: p.party, chars, espers: p.espers, esperMode: p.esperMode } : null);
}
export function partyCount() {
  const p = loadParty();
  return { met: Object.values(p.chars).filter((c) => c.met).length, party: p.party.length };
}

function hint(name) {
  const e = EQUIP[name];
  if (e.slot === "weapon") return `Attack ${e.bp}`;
  if (e.slot === "relic") return "";
  return `Defense ${e.def || 0}${e.mdef ? `, M.Def ${e.mdef}` : ""}`;
}

const RELIC_NOTE = {
  phys25: "+25% Fight damage", mag25: "+25% magic damage", vig50: "Strength +50%", hp50: "HP +50%", mp50: "MP +50%",
  genji: "two weapons", gauntlet: "two-handed grip", scroll: "four hits at half power", beads: "dodges half of physical attacks",
  counter: "counterattacks", lowprotect: "Protect when HP is low", lowshell: "Shell when HP is low", cover: "covers allies low on HP",
  sure: "attacks always hit", cursed: "Doom", undead: "makes the wearer undead",
};
function relicNote(name) {
  const e = name && EQUIP[name];
  if (!e || e.slot !== "relic") return "";
  const parts = [...(e.fx || []).map((f) => RELIC_NOTE[f]).filter(Boolean)];
  if (name === "Earring") parts.push("stacks");
  if (e.auto) parts.push(e.auto.join(", "));
  if (e.prevent) parts.push("blocks " + e.prevent.join(", "));
  return parts.join(" · ");
}

// ctx: { toast(msg), onChange() }
export function renderParty(outer, ctx) {
  outer.innerHTML = `<div class="pt-root"></div>`;
  const view = outer.firstElementChild; // listeners live on this, so they go when the page does
  const st = loadParty();
  const rec = (name) => (st.chars[name] ||= blank());
  const names = loadNames();
  const shown = (c) => {
    const n = names.find((x) => x.from.trim().toLowerCase() === c.name.toLowerCase() && x.to.trim());
    return n ? n.to.trim() : c.name;
  };
  let pending = null; // optimizer result waiting for Apply
  let clearArmed = false; // Clear all gear asks for a second tap
  const unlockedGear = () => CHARS.some((c) => { const r = rec(c.name); return SLOTS.some((s) => r.eq[s] && !r.lock[s]); });

  const options = (c, slot, cur, bag) => {
    const fit = Object.keys(EQUIP).filter((n) => canEquip(c, n) && slotFits(slot, n));
    const inBag = fit.filter((n) => (bag[n] || 0) > 0 || n === cur);
    const other = fit.filter((n) => !inBag.includes(n));
    const opt = (n) => `<option value="${esc(n)}"${n === cur ? " selected" : ""}>${esc(n)}${hint(n) ? ` · ${hint(n)}` : ""}${bag[n] ? ` · ${bag[n]} in bag` : ""}</option>`;
    return `<option value="">— Empty —</option>${inBag.length ? `<optgroup label="In your bag">${inBag.map(opt).join("")}</optgroup>` : ""}${other.length ? `<optgroup label="Not in your bag">${other.map(opt).join("")}</optgroup>` : ""}`;
  };

  const holder = (esper) => CHARS.find((c) => rec(c.name).esper === esper);
  const esperRow = (c, r) => {
    if (!canEquipEsper(c)) return `<tr><th scope="row">Esper</th><td colspan="2"><span class="hint">${esc(c.name)} can't equip magicite.</span></td></tr>`;
    const opts = st.espers.map((n) => { const h = holder(n); const e = ESPER.get(n); return `<option value="${esc(n)}"${n === r.esper ? " selected" : ""}>${esc(n)} · ${esc(bonusText(e.bonus))}${h && h.name !== c.name ? ` · now on ${esc(shown(h))}` : ""}</option>`; }).join("");
    return `<tr data-slot="esper"><th scope="row">Esper</th>
      <td><select class="pc-esper" aria-label="${esc(c.name)}: Esper"><option value="">— None —</option>${opts}</select>${st.espers.length ? "" : `<span class="pc-fx">Tick the espers you have under Espers below.</span>`}</td>
      <td><button type="button" class="pc-lock" aria-pressed="${!!r.lock.esper}" aria-label="Keep the esper when optimizing" title="Keep when optimizing">${r.lock.esper ? "🔒" : "🔓"}</button></td></tr>`;
  };
  const esperSpells = (c, r) => {
    const e = r.esper && ESPER.get(r.esper);
    if (!e || !canEquipEsper(c)) return "";
    const known = new Set(r.spells);
    const left = e.spells.filter(([sp]) => !known.has(sp)).length;
    return `<div class="pc-spells"><p class="pc-fx">${esc(e.name)} teaches ${left ? `${left} spell${left === 1 ? "" : "s"} ${esc(shown(c))} doesn't know yet` : "nothing new"} · level-up bonus: ${esc(bonusText(e.bonus))}</p>
      <ul>${e.spells.map(([sp, rate]) => `<li><label><input type="checkbox" class="pc-spell" data-s="${esc(sp)}"${known.has(sp) ? " checked" : ""}> ${esc(sp)} <span class="mn-odds">×${rate}</span></label></li>`).join("")}</ul></div>`;
  };

  const card = (c, inParty) => {
    const r = rec(c.name);
    const bag = loadGear();
    const ev = evaluate(c, r.level, r.eq);
    const s = ev.stats;
    const stat = (label, v) => `<div><dt>${label}</dt><dd>${v}</dd></div>`;
    const nameHtml = `<span class="pc-n">${esc(shown(c))}</span>${shown(c) !== c.name ? ` <span class="rg-alt">${esc(c.name)}</span>` : ""}`;
    const body = `
      <div class="pc-row">
        <span class="pc-lv">Level
          <span class="gr-step">
            <button type="button" class="gr-dec pc-lvdn" aria-label="Lower ${esc(c.name)}'s level"${r.level <= 1 ? " disabled" : ""}>−</button>
            <input type="text" class="gr-n pc-lvn" inputmode="numeric" maxlength="2" value="${r.level}" aria-label="${esc(c.name)}'s level">
            <button type="button" class="gr-inc pc-lvup" aria-label="Raise ${esc(c.name)}'s level"${r.level >= 99 ? " disabled" : ""}>+</button>
          </span>
        </span>
        <label class="pc-goal">Optimize for <select class="pc-goalsel">${GOALS.map(([v, t]) => `<option value="${v}"${v === r.goal ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
      <table class="gr-tbl pc-eq"><tbody>${SLOTS.map((slot) => `<tr data-slot="${slot}">
        <th scope="row">${SLOT_LABEL[slot]}</th>
        <td><select class="pc-sel" aria-label="${esc(c.name)}: ${SLOT_LABEL[slot]}">${options(c, slot, r.eq[slot] || "", bag)}</select>${slot[0] === "r" && r.eq[slot] ? `<span class="pc-fx">${esc(relicNote(r.eq[slot]))}</span>` : ""}</td>
        <td><button type="button" class="pc-lock" aria-pressed="${!!r.lock[slot]}" aria-label="Keep ${SLOT_LABEL[slot]} when optimizing" title="Keep when optimizing">${r.lock[slot] ? "🔒" : "🔓"}</button></td>
      </tr>`).join("")}${esperRow(c, r)}</tbody></table>
      ${esperSpells(c, r)}
      <dl class="mn-stats pc-stats">${stat("HP", s.hp)}${stat("MP", s.mp)}${stat("Strength", s.vig)}${stat("Agility", s.spd)}${stat("Stamina", s.sta)}${stat("Magic", s.mag)}${stat("Attack", s.attack)}${stat("Defense", s.def)}${stat("Evasion", s.ev)}${stat("Magic Def.", s.mdef)}${stat("Magic Eva.", s.mb)}</dl>
      <p class="pc-est">Estimates at level ${r.level}: Fight ≈ <strong>${ev.fight}</strong> · Magic ≈ <strong>${ev.magic}</strong> · Toughness <strong>${ev.tough}</strong></p>`;
    if (inParty) {
      return `<article class="pc" data-c="${esc(c.name)}">
        <header class="pc-head"><h3>${nameHtml}</h3><label class="pc-in"><input type="checkbox" class="pc-party" checked> In party</label></header>${body}</article>`;
    }
    return `<details class="pc pc-other" data-c="${esc(c.name)}"><summary class="pc-head"><h3>${nameHtml} <span class="mn-odds">Level ${r.level}</span></h3>
        <label class="pc-in"><input type="checkbox" class="pc-party"> In party</label></summary>${body}
        <button type="button" class="txt-btn pc-unmet">Mark ${esc(shown(c))} as not met</button></details>`;
  };

  const render = () => {
    const met = CHARS.filter((c) => rec(c.name).met);
    const party = st.party.map((n) => CHARS.find((c) => c.name === n)).filter(Boolean);
    const others = met.filter((c) => !st.party.includes(c.name));
    const unmet = CHARS.filter((c) => !rec(c.name).met);
    clearArmed = false;
    view.innerHTML = `
    <section class="rages party">
      <p class="eyebrow">Characters</p>
      <h1>Party</h1>
      <p class="hint">Tick the characters you've met and put up to four in your party. Set their levels and what they're wearing: equipping here takes the item out of your Inventory, as the game does. <strong>Optimize</strong> picks the best weapons, armor and relics you own for each party member at their level. Lock a slot to keep it. <strong>Clear all gear</strong> puts everyone's unlocked equipment back in your bag, so Optimize can hand it out again.</p>
      <div class="pt-actions"><button type="button" class="btn solid" id="ptOpt"${party.length ? "" : " disabled"}>Optimize party</button>
        <label class="pc-goal">Espers for <select id="ptEsperMode"><option value="spells"${st.esperMode === "spells" ? " selected" : ""}>learning spells</option><option value="bonus"${st.esperMode === "bonus" ? " selected" : ""}>level-up bonuses</option></select></label>
        <button type="button" class="btn" id="ptClear"${unlockedGear() ? "" : " disabled"}>Clear all gear</button>
        <span class="hint" id="ptNote">${party.length ? "" : "Put someone in your party first."}</span></div>
      <div id="ptResult"></div>
      ${party.length ? `<h2 class="sheet-sub">In your party</h2>${party.map((c) => card(c, true)).join("")}` : ""}
      ${others.length ? `<h2 class="sheet-sub">Others you've met</h2>${others.map((c) => card(c, false)).join("")}` : ""}
      <h2 class="sheet-sub">Espers</h2>
      <details class="pt-howto"><summary>How espers work</summary>
        <ul>
          <li><strong>Equip one per character</strong> (Skills, then Espers, in the game). Each esper can be on only one character at a time. Gogo and Umaro can't equip them.</li>
          <li><strong>They teach magic.</strong> After every battle, each equipped esper gives 1–10 AP times each spell's learn rate (the ×number). A spell is learned at 100. Every character learns separately, so a spell Prns Donut knows still has to be learned by the others.</li>
          <li><strong>Level-up bonuses</strong> are the only way to raise Strength, Agility, Stamina and Magic, and they add to HP and MP growth. A character gets the bonus of the esper they're holding when they level up. Swap to a bonus esper before a fight you expect to level up in.</li>
          <li><strong>Summon</strong> an equipped esper once per battle from the Magic menu.</li>
          <li><strong>A common plan:</strong> early on, spread healing (Kirin, Seraph, Lakshmi) and Haste (Carbuncle, Quetzalli) across the party; later, level up with Bismarck or Alexander for Strength, Zona Seeker or Valigarmanda for Magic, and Bahamut or Midgardsormr for HP.</li>
        </ul>
      </details>
      <p class="hint">Tick each esper you have. Then pick one for each character above, and tick the spells they've already learned (the game's Magic screen shows them), so the optimizer knows what's left.</p>
      <ul class="pt-espers">${ESPERS.map((e) => { const h = holder(e.name); const have = st.espers.includes(e.name); return `<li class="${have ? "on" : ""}"><label><input type="checkbox" class="pt-esper" data-e="${esc(e.name)}"${have ? " checked" : ""}> <span><strong>${esc(e.name)}</strong>${e.alt ? ` <span class="rg-alt">${esc(e.alt)}</span>` : ""}${have && h ? ` <span class="badge">${esc(shown(h))}</span>` : ""}<span class="pc-fx">${esc(bonusText(e.bonus))} · ${e.spells.map(([sp, r]) => `${esc(sp)} ×${r}`).join(", ")}</span><span class="pc-fx">${have ? esc(e.summon) : "Where: " + esc(e.found)}</span></span></label></li>`; }).join("")}</ul>
      ${unmet.length ? `<h2 class="sheet-sub">Not met yet</h2><p class="hint">Tick a character when they join you.</p><ul class="pt-unmet">${unmet.map((c) => `<li><label><input type="checkbox" class="pc-met" data-c="${esc(c.name)}"> ${esc(shown(c))}${shown(c) !== c.name ? ` <span class="rg-alt">${esc(c.name)}</span>` : ""}</label></li>`).join("")}</ul>` : ""}
      <p class="hint small">Base stats, HP and MP per level, and equipment stats from <a href="https://gamercorner.net/ffvi/" target="_blank" rel="noopener noreferrer">Gamer Corner</a>; relic effects from the <a href="https://finalfantasy.fandom.com/wiki/Relic_(Final_Fantasy_VI)" target="_blank" rel="noopener noreferrer">Final Fantasy Wiki</a>. Stat boosts from espers at level-up aren't included, so HP, MP and stats in the game may be higher. Estimates are for comparing load-outs, not exact damage.</p>
    </section>`;
  };
  const save = () => { saveParty(st); ctx.onChange(); };
  const keepScroll = (fn) => { const y = window.scrollY; fn(); render(); window.scrollTo(0, y); };
  const nameOf = (el) => el.closest("[data-c]")?.dataset.c;

  const setLevel = (name, lv) => keepScroll(() => { rec(name).level = Math.max(1, Math.min(99, lv | 0 || 1)); save(); });

  view.addEventListener("click", (e) => {
    const name = nameOf(e.target);
    if (e.target.closest(".pc-lvup")) return setLevel(name, rec(name).level + 1);
    if (e.target.closest(".pc-lvdn")) return setLevel(name, rec(name).level - 1);
    const lock = e.target.closest(".pc-lock");
    if (lock) {
      const slot = lock.closest("tr").dataset.slot;
      return keepScroll(() => { rec(name).lock[slot] = !rec(name).lock[slot]; if (!rec(name).lock[slot]) delete rec(name).lock[slot]; save(); });
    }
    if (e.target.closest(".pc-unmet")) {
      return keepScroll(() => { rec(name).met = false; st.party = st.party.filter((n) => n !== name); save(); });
    }
    if (e.target.closest("#ptOpt")) return runOptimizer();
    const clear = e.target.closest("#ptClear");
    if (clear) {
      if (!clearArmed) { clearArmed = true; clear.textContent = "Tap again to clear"; clear.classList.add("danger"); return; }
      return clearGear();
    }
    if (e.target.closest("#ptApply")) return applyResult();
    if (e.target.closest("#ptDiscard")) { pending = null; view.querySelector("#ptResult").innerHTML = ""; }
  });

  view.addEventListener("change", (e) => {
    const t = e.target;
    const name = nameOf(t);
    if (t.id === "ptEsperMode") { st.esperMode = t.value; return save(); }
    if (t.classList.contains("pt-esper")) {
      const n = t.dataset.e;
      return keepScroll(() => {
        if (t.checked) st.espers.push(n);
        else { st.espers = st.espers.filter((x) => x !== n); for (const c of CHARS) if (rec(c.name).esper === n) rec(c.name).esper = ""; }
        save();
      });
    }
    if (t.classList.contains("pc-esper")) {
      const h = t.value && holder(t.value);
      if (h && h.name !== name) ctx.toast(`${t.value} moved from ${shown(h)}`);
      return keepScroll(() => { if (h) rec(h.name).esper = ""; rec(name).esper = t.value; save(); });
    }
    if (t.classList.contains("pc-spell")) {
      const sp = t.dataset.s, r = rec(name);
      return keepScroll(() => { r.spells = t.checked ? [...new Set([...r.spells, sp])] : r.spells.filter((x) => x !== sp); save(); });
    }
    if (t.classList.contains("pc-met")) {
      return keepScroll(() => { rec(name).met = true; save(); });
    }
    if (t.classList.contains("pc-party")) {
      if (t.checked && st.party.length >= MAX_PARTY) { t.checked = false; ctx.toast("A party has four members. Take someone out first."); return; }
      return keepScroll(() => { st.party = t.checked ? [...st.party, name] : st.party.filter((n) => n !== name); save(); });
    }
    if (t.classList.contains("pc-lvn")) return setLevel(name, parseInt(t.value, 10));
    if (t.classList.contains("pc-goalsel")) return keepScroll(() => { rec(name).goal = t.value; save(); });
    if (t.classList.contains("pc-sel")) {
      const slot = t.closest("tr").dataset.slot;
      const r = rec(name);
      const next = t.value, prev = r.eq[slot] || "";
      const other = r.eq[slot === "rh" ? "lh" : slot === "lh" ? "rh" : ""] || "";
      const genji = [r.eq.r1, r.eq.r2].some((n) => n && (EQUIP[n].fx || []).includes("genji"));
      if ((slot === "rh" || slot === "lh") && next && other) {
        if (EQUIP[next].slot === "weapon" && EQUIP[other].slot === "weapon" && !genji) { t.value = prev; ctx.toast("Two weapons need the Genji Glove."); return; }
        if (EQUIP[next].slot === "shield" && EQUIP[other].slot === "shield") { t.value = prev; ctx.toast("Only one shield at a time."); return; }
      }
      const bag = loadGear();
      if (prev) bag[prev] = (bag[prev] || 0) + 1;
      if (next && bag[next] > 0) bag[next]--;
      saveGear(bag);
      return keepScroll(() => { if (next) r.eq[slot] = next; else delete r.eq[slot]; save(); });
    }
  });

  function runOptimizer() {
    const btn = view.querySelector("#ptOpt");
    btn.disabled = true;
    btn.textContent = "Optimizing…";
    setTimeout(() => {
      const members = st.party.map((n) => ({ char: CHARS.find((c) => c.name === n), level: rec(n).level, goal: rec(n).goal, eq: { ...rec(n).eq }, locked: { ...rec(n).lock } }));
      const res = optimizeParty(members, loadGear());
      const esperPicks = assignEspers(st.party.map((n) => ({ char: CHARS.find((c) => c.name === n), goal: rec(n).goal, learned: new Set(rec(n).spells), esper: rec(n).esper, locked: !!rec(n).lock.esper })),
        st.espers.map((n) => ESPER.get(n)), st.esperMode);
      pending = { members, res, esperPicks };
      const rows = members.map((m, i) => {
        const after = res.loadouts[i];
        const changes = SLOTS.filter((s) => (m.eq[s] || "") !== (after[s] || ""));
        const oldE = rec(m.char.name).esper || "", newE = esperPicks[i] || "";
        const taken = newE && holder(newE) && holder(newE).name !== m.char.name ? ` (from ${esc(shown(holder(newE)))})` : "";
        const eRow = canEquipEsper(m.char) && oldE !== newE ? `<tr><th scope="row">Esper</th><td>${esc(oldE || "None")} → <strong>${esc(newE || "None")}</strong>${taken}<span class="pc-fx">${newE ? esc(bonusText(ESPER.get(newE).bonus)) + ` · ${ESPER.get(newE).spells.filter(([sp]) => !rec(m.char.name).spells.includes(sp)).length} spells to learn` : ""}</span></td></tr>` : "";
        const a = evaluate(m.char, m.level, m.eq), b = evaluate(m.char, m.level, after);
        const delta = (x, y) => (y === x ? `${y}` : `${x} → <strong>${y}</strong>`);
        return `<div class="pt-res">
          <h3>${esc(shown(m.char))}</h3>
          ${changes.length || eRow ? `<table class="gr-tbl"><tbody>${changes.map((s) => `<tr><th scope="row">${SLOT_LABEL[s]}</th><td>${esc(m.eq[s] || "Empty")} → <strong>${esc(after[s] || "Empty")}</strong></td></tr>`).join("")}${eRow}</tbody></table>` : `<p class="hint">Already the best of what you own.</p>`}
          <p class="pc-est">Fight ${delta(a.fight, b.fight)} · Magic ${delta(a.magic, b.magic)} · Toughness ${delta(a.tough, b.tough)}</p>
        </div>`;
      });
      view.querySelector("#ptResult").innerHTML = `<div class="pt-panel"><p><strong>Suggested load-outs.</strong> Make these changes in the game, then tap Apply so the app matches.</p>${rows.join("")}
        <div class="row2"><button type="button" class="btn" id="ptDiscard">Discard</button><button type="button" class="btn solid" id="ptApply">Apply</button></div></div>`;
      btn.disabled = false;
      btn.textContent = "Optimize party";
      view.querySelector("#ptResult").scrollIntoView({ block: "start" });
    }, 30);
  }

  // Unequip every unlocked slot on every character and put the items back in the bag. Espers stay.
  function clearGear() {
    const bag = loadGear();
    let n = 0;
    for (const c of CHARS) {
      const r = rec(c.name);
      for (const s of SLOTS) if (r.eq[s] && !r.lock[s]) { bag[r.eq[s]] = (bag[r.eq[s]] || 0) + 1; delete r.eq[s]; n++; }
    }
    saveGear(bag);
    pending = null;
    save();
    keepScroll(() => {});
    ctx.toast(`${n} item${n === 1 ? "" : "s"} back in your bag`);
  }

  function applyResult() {
    if (!pending) return;
    pending.members.forEach((m, i) => { rec(m.char.name).eq = Object.fromEntries(Object.entries(pending.res.loadouts[i]).filter(([, v]) => v)); });
    pending.members.forEach((m, i) => {
      const e = pending.esperPicks[i] || "";
      if (!canEquipEsper(m.char)) return;
      const h = e && holder(e);
      if (h && h.name !== m.char.name) rec(h.name).esper = "";
      rec(m.char.name).esper = e;
    });
    saveGear(pending.res.bag);
    pending = null;
    save();
    render();
    window.scrollTo(0, 0);
    ctx.toast("Load-outs applied");
  }

  render();
}
