// Load-out math: a character's stats with their equipment, and an optimizer that picks
// weapons, shields, armor and relics from what you own, for the level they're at.
//
// The optimizer scores a load-out from estimates built on FF6's own formulas:
//   Fight:  per hit, BattlePower + (Level² × (BattlePower + 2 × Vigor) / 256) × 3/2, summed over
//           both hands with a Genji Glove, × 1.75 battle power with a Gauntlet two-handed grip,
//           × 2 with the Master's Scroll (four hits at half power), × 1.25 for Gigas Glove or
//           Hero's Ring (they don't stack), and a little extra for Black Belt and Sniper Eye.
//   Magic:  for a 60-power spell, 4 × 60 + Level × Magic × 60 / 32, + 25 % per Earring and for
//           Hero's Ring (these stack).
//   Toughness: HP divided by the share of physical and magic damage that gets through
//           Defense, Magic Defense, Evade and Magic Evade (Evade works in the Pixel Remaster),
//           Protect and Shell, with small bonuses for status protection, Regen and elements.
//   Speed: turns come at (Speed + 20), × 1.5 with Haste.
// A goal sets how much each part counts. Scores add logarithms, so a 10 % gain counts the same
// wherever it comes from.

import { CHARS, EQUIP, HP_UP, MP_UP } from "./party-data.js";

export const SLOTS = ["rh", "lh", "head", "body", "r1", "r2"];
export const SLOT_LABEL = { rh: "Right hand", lh: "Left hand", head: "Head", body: "Body", r1: "Relic", r2: "Relic" };
export const GOALS = [["balanced", "Balanced"], ["attack", "Attack"], ["defense", "Defense"], ["magic", "Magic"]];

export const charByName = new Map(CHARS.map((c) => [c.name, c]));
const MAXLV = 99;

export function canEquip(char, name) {
  const e = EQUIP[name];
  return !!e && !!e.who && (e.who === "all" || e.who.split(" ").includes(char.code));
}
export function slotFits(slot, name) {
  const e = EQUIP[name];
  if (!e) return false;
  if (slot === "rh" || slot === "lh") return e.slot === "weapon" || e.slot === "shield";
  if (slot === "r1" || slot === "r2") return e.slot === "relic";
  return e.slot === slot;
}

// Everything about a character with a load-out: displayed stats plus the estimates.
export function evaluate(char, level, eq) {
  const L = Math.max(1, Math.min(MAXLV, level | 0));
  const items = SLOTS.map((s) => eq[s]).filter((n) => n && EQUIP[n]).map((n) => EQUIP[n]);
  const fx = new Set(), prevent = new Set(), auto = new Set();
  let earrings = 0, elem = 0;
  const s = { vig: char.vig, spd: char.spd, sta: char.sta, mag: char.mag, def: char.def, mdef: char.mdef, ev: char.ev, mb: char.mb };
  for (const e of items) {
    for (const k of ["vig", "spd", "sta", "mag", "def", "mdef", "ev", "mb"]) s[k] += e[k] || 0;
    for (const f of e.fx || []) fx.add(f);
    for (const p of e.prevent || []) prevent.add(p);
    for (const a of e.auto || []) auto.add(a);
    elem += e.elem || 0;
  }
  earrings = [eq.r1, eq.r2].filter((n) => n === "Earring").length;
  if (fx.has("vig50")) s.vig = Math.floor(s.vig * 1.5);
  for (const k of ["vig", "spd", "sta", "mag"]) s[k] = Math.min(128, s[k]);
  s.hp = Math.min(9999, Math.floor((char.hp + HP_UP[L]) * (fx.has("hp50") ? 1.5 : 1)));
  s.mp = char.mp ? Math.min(999, Math.floor((char.mp + MP_UP[L]) * (fx.has("mp50") ? 1.5 : 1))) : 0;

  // Fight
  const weapons = ["rh", "lh"].map((h) => eq[h]).filter((n) => n && EQUIP[n] && EQUIP[n].slot === "weapon");
  const shields = ["rh", "lh"].map((h) => eq[h]).filter((n) => n && EQUIP[n] && EQUIP[n].slot === "shield");
  const hit = (bp) => bp + Math.floor((L * L * (bp + Math.min(255, s.vig * 2))) / 256) * 1.5;
  let fight;
  if (!weapons.length) fight = hit(char.bp);
  else if (weapons.length === 2) fight = hit(EQUIP[weapons[0]].bp) + hit(EQUIP[weapons[1]].bp);
  else {
    const w = EQUIP[weapons[0]];
    const twoHanded = fx.has("gauntlet") && w.twoHand && !shields.length;
    fight = hit(twoHanded ? Math.floor(w.bp * 1.75) : w.bp);
    if (fx.has("genji") && !twoHanded) fight *= 0.75; // the Genji Glove with one weapon lowers damage
  }
  if (fx.has("phys25")) fight *= 1.25;
  if (fx.has("scroll")) fight *= 2;
  if (fx.has("counter")) fight *= 1.15;
  if (fx.has("sure")) fight *= 1.03;
  s.attack = weapons.reduce((a, n) => a + EQUIP[n].bp, 0) || char.bp;

  // Magic
  let magic = 240 + (L * s.mag * 60) / 32;
  magic *= 1 + 0.25 * earrings + (fx.has("mag25") ? 0.25 : 0);

  // Toughness
  const evade = Math.min(0.9, Math.max(0, s.ev) / 128);
  const mblock = Math.min(0.9, Math.max(0, s.mb) / 128);
  let phys = ((255 - Math.min(254, s.def)) / 256) * (1 - evade) * (fx.has("beads") ? 0.5 : 1);
  let mag = ((255 - Math.min(254, s.mdef)) / 256) * (1 - 0.5 * mblock);
  if (auto.has("Safe") || auto.has("Protect")) phys *= 170 / 256; else if (fx.has("lowprotect")) phys *= 0.9;
  if (auto.has("Shell")) mag *= 170 / 256; else if (fx.has("lowshell")) mag *= 0.9;
  let tough = s.hp / (0.6 * phys + 0.4 * mag);
  tough *= 1 + 0.015 * prevent.size + 0.01 * elem;
  if (auto.has("Regen")) tough *= 1.05;
  if (auto.has("Float")) tough *= 1.02;
  if (fx.has("cursed")) tough *= 0.3;
  if (fx.has("undead")) tough *= 0.7;

  const speed = (s.spd + 20) * (auto.has("Haste") ? 1.5 : 1);
  return { stats: s, fight: Math.round(fight), magic: Math.round(magic), tough: Math.round(tough), speed, fx, prevent, auto };
}

function weights(char, goal) {
  const base = { phys: [1, 0], mixed: [0.6, 0.6], magic: [0.1, 1] }[char.role] || [1, 0];
  let [p, m] = base, d = 1, sp = 0.5;
  if (goal === "attack") { p *= 1.6; m *= 1.6; d = 0.5; }
  else if (goal === "defense") { p *= 0.5; m *= 0.5; d = 1.8; }
  else if (goal === "magic") { p = 0.1; m = 1.6; }
  return { p, m, d, sp };
}

export function score(char, level, eq, goal) {
  const r = evaluate(char, level, eq);
  const w = weights(char, goal);
  return w.p * Math.log(r.fight + 1) + w.m * Math.log(r.magic + 1) + w.d * Math.log(r.tough + 1) + w.sp * Math.log(r.speed);
}

// Best load-out for one character. pool: { name: count } of items they may use (including what
// they wear now); locked: { slot: true } slots to keep as they are in `current`.
export function optimizeOne(char, level, goal, pool, current = {}, locked = {}) {
  const have = (n) => (pool[n] || 0) > 0;
  const options = (slot) => {
    if (locked[slot]) return [current[slot] || ""];
    return ["", ...Object.keys(pool).filter((n) => have(n) && canEquip(char, n) && slotFits(slot, n))];
  };
  const fits = (eq) => {
    const used = {};
    for (const s of SLOTS) if (eq[s] && !locked[s]) used[eq[s]] = (used[eq[s]] || 0) + 1;
    return Object.entries(used).every(([n, k]) => (pool[n] || 0) >= k);
  };
  const opt = Object.fromEntries(SLOTS.map((s) => [s, options(s)]));
  const relics = opt.r1;
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < relics.length; i++) {
    for (let j = locked.r2 ? 0 : i; j < (locked.r2 ? 1 : relics.length); j++) {
      const eq = { rh: "", lh: "", head: "", body: "", r1: relics[i], r2: locked.r2 ? current.r2 || "" : relics[j] };
      for (const s of ["rh", "lh", "head", "body"]) if (locked[s]) eq[s] = current[s] || "";
      if (!fits(eq)) continue;
      // Coordinate ascent over hands and armor for this pair of relics.
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (const s of ["rh", "lh", "head", "body"]) {
          if (locked[s]) continue;
          let pick = eq[s], top = -Infinity;
          for (const n of opt[s]) {
            const trial = { ...eq, [s]: n };
            if (!fits(trial)) continue;
            if (n && EQUIP[n].slot === "weapon" && s === "lh" && trial.rh && EQUIP[trial.rh].slot === "weapon" && !(EQUIP[trial.r1]?.fx || []).concat(EQUIP[trial.r2]?.fx || []).includes("genji")) continue;
            if (n && EQUIP[n].slot === "weapon" && s === "rh" && trial.lh && EQUIP[trial.lh].slot === "weapon" && !(EQUIP[trial.r1]?.fx || []).concat(EQUIP[trial.r2]?.fx || []).includes("genji")) continue;
            if (n && EQUIP[n].slot === "shield" && (s === "lh" ? trial.rh : trial.lh) && EQUIP[s === "lh" ? trial.rh : trial.lh].slot === "shield") continue;
            const v = score(char, level, trial, goal);
            if (v > top + 1e-9) { top = v; pick = n; }
          }
          if (pick !== eq[s]) { eq[s] = pick; changed = true; }
        }
        if (!changed) break;
      }
      const v = score(char, level, eq, goal);
      if (v > bestScore) { bestScore = v; best = eq; }
    }
  }
  if (!best) return { ...current };
  // Don't swap hands for nothing: keep the current arrangement if the same items stay in hand,
  // and otherwise put a weapon in the right hand.
  const pair = (eq) => [eq.rh || "", eq.lh || ""].sort().join("|");
  if (!locked.rh && !locked.lh) {
    if (pair(best) === pair(current)) { best.rh = current.rh || ""; best.lh = current.lh || ""; }
    else if (best.lh && EQUIP[best.lh].slot === "weapon" && !(best.rh && EQUIP[best.rh].slot === "weapon")) [best.rh, best.lh] = [best.lh, best.rh];
  }
  return best;
}

// Optimizes the whole party, sharing items. members: [{ char, level, goal, eq, locked }].
// bag: { name: count } of unequipped items. Returns { loadouts: [eq], bag }.
export function optimizeParty(members, bag) {
  const pool = { ...bag };
  for (const m of members) for (const s of SLOTS) if (m.eq[s] && !m.locked[s]) pool[m.eq[s]] = (pool[m.eq[s]] || 0) + 1;
  const take = (eq, locked, sign) => { for (const s of SLOTS) if (eq[s] && !locked[s]) pool[eq[s]] = (pool[eq[s]] || 0) + sign; };
  const result = members.map(() => null);
  for (let round = 0; round < 3; round++) {
    members.forEach((m, i) => {
      if (result[i]) take(result[i], m.locked, +1);
      result[i] = optimizeOne(m.char, m.level, m.goal, pool, m.eq, m.locked);
      take(result[i], m.locked, -1);
    });
  }
  const left = {};
  for (const [n, k] of Object.entries(pool)) if (k > 0) left[n] = k;
  return { loadouts: result, bag: left };
}
