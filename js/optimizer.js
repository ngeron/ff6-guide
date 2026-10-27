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
//   Skills: physical command abilities (Rage attacks, Raging Fist, Bushido, Tools, Throw) use the
//           Fight formula with the ability's own power in place of the weapon's, so Level, Vigor
//           and Gigas Glove or Hero's Ring count and the weapon doesn't. Estimated for power 120.
//   Steal:  success doubles with the Thief's Bracer; the Brigand's Glove turns Steal into Mug
//           (steal and attack in one turn).
// A goal sets how much each part counts; a character's command goal (CMD_GOALS) weighs the parts
// their command uses. Scores add logarithms, so a 10 % gain counts the same
// wherever it comes from.
//
// Against one monster (a "foe", built by foe.js), Fight counts each hand's element against the
// monster (weak ×2, resisted ×½, immune 0, absorbed heals it), and Toughness becomes HP over the
// damage expected from one of its turns: each of its moves weighted by how often it's likely to
// come, reduced by Defense and Evade (physical) or Magic Defense and Magic Evade (magic), and by
// the gear's elements (absorb, nullify, halve, or a weakness ×2); a status the gear doesn't
// block counts against it by how bad that status is (STATUS_HARM).

import { CHARS, EQUIP, HP_UP, MP_UP } from "./party-data.js";

export const SLOTS = ["rh", "lh", "head", "body", "r1", "r2"];
export const SLOT_LABEL = { rh: "Right hand", lh: "Left hand", head: "Head", body: "Body", r1: "Relic", r2: "Relic" };
export const GOALS = [["balanced", "Balanced"], ["attack", "Attack"], ["defense", "Defense"], ["magic", "Magic"]];
// Commands whose damage or success depends on gear differently from Fight. Weights for fight (f),
// skills (k), magic (m) and steal (st). Sources: Final Fantasy Wiki command pages, citing the
// FF6 Algorithms FAQ. Rage: physical specials and regular attacks use Gau's Vigor (he has no
// weapons), Rage spells his Magic. Blitz: Raging Fist and Meteor Strike are physical skills, the
// other four use Magic. Bushido and Tools: mostly physical skills, a few magic; a weapon is still
// needed for Bushido, so Fight keeps a little weight. Throw: the thrown item's power with Vigor.
// Dance and Lore: Magic.
export const CMD_GOALS = {
  Gau: { label: "Rage", k: 0.8, m: 0.8 },
  Sabin: { label: "Blitz", k: 0.6, m: 1.1 },
  Cyan: { label: "Bushido", f: 0.15, k: 1.3, m: 0.4 },
  Edgar: { label: "Tools", f: 0.15, k: 1.3, m: 0.2 },
  Shadow: { label: "Throw", f: 0.15, k: 1.3, m: 0.2 },
  Locke: { label: "Steal", f: 0.8, st: 1.5 },
  Mog: { label: "Dance", m: 1.6 },
  Strago: { label: "Lore", m: 1.6 },
};
export const goalsFor = (char) => (CMD_GOALS[char.name] ? [...GOALS, ["cmd", CMD_GOALS[char.name].label]] : GOALS);

export const charByName = new Map(CHARS.map((c) => [c.name, c]));
const MAXLV = 99;

export function canEquip(char, name) {
  const e = EQUIP[name];
  return !!e && !!e.who && (e.who === "all" || e.who.split(" ").includes(char.code));
}
const RELIC_NOTE = {
  phys25: "+25% Fight damage", mag25: "+25% magic damage", vig50: "Strength +50%", hp50: "HP +50%", mp50: "MP +50%",
  genji: "two weapons", gauntlet: "two-handed grip", scroll: "four hits at half power", beads: "dodges half of physical attacks",
  counter: "counterattacks", lowprotect: "Protect when HP is low", lowshell: "Shell when HP is low", cover: "covers allies low on HP",
  sure: "attacks always hit", cursed: "Doom", undead: "makes the wearer undead",
};
// What a relic does, in a few words (for the Party and Inventory pages).
export function relicNote(name) {
  const e = name && EQUIP[name];
  if (!e || e.slot !== "relic") return "";
  const parts = [...(e.fx || []).map((f) => RELIC_NOTE[f]).filter(Boolean)];
  if (name === "Earring") parts.push("stacks");
  if (e.auto) parts.push(e.auto.join(", "));
  if (e.prevent) parts.push("blocks " + e.prevent.join(", "));
  return parts.join(" · ");
}

// Statuses as the monster data names them, for the names equipment uses (SNES names).
export const STATUS_AS = { Dark: "Blind", Mute: "Silence", Muddled: "Confuse", Psyche: "Sleep", Wound: "Death" };
// How much a status the gear doesn't block hurts a grinding party, roughly: 1 takes a character
// out of the fight.
export const STATUS_HARM = { Death: 1, Petrify: 1, Zombie: 1, Stop: 0.6, Freeze: 0.5, Doom: 0.5, Confuse: 0.5, Imp: 0.4, Sleep: 0.35, Berserk: 0.3,
  Silence: 0.2, Slow: 0.2, Blind: 0.15, Seizure: 0.15, Poison: 0.1, Sap: 0.1 };
// What an element does to the wearer of `el` ({ absorb, null, half, weak } lists): -1 heals.
export function takenFactor(element, el, float) {
  if (!element) return 1;
  if (element === "Earth" && float) return 0;
  if (el.absorb.has(element)) return -1;
  if (el.null.has(element)) return 0;
  const f = el.half.has(element) ? 0.5 : 1;
  return el.weak.has(element) ? f * 2 : f;
}
// What a weapon's elements do to the monster: weak ×2, resisted ×½, immune 0, absorbed -1.
export function hitFactor(els, foe) {
  if (!foe || !els || !els.length) return 1;
  if (els.some((e) => foe.absorb.has(e))) return -1;
  if (els.some((e) => foe.immune.has(e))) return 0;
  if (els.some((e) => foe.weak.has(e))) return 2;
  if (els.some((e) => foe.resist.has(e))) return 0.5;
  return 1;
}

export function slotFits(slot, name) {
  const e = EQUIP[name];
  if (!e) return false;
  if (slot === "rh" || slot === "lh") return e.slot === "weapon" || e.slot === "shield";
  if (slot === "r1" || slot === "r2") return e.slot === "relic";
  return e.slot === slot;
}

// Everything about a character with a load-out: displayed stats plus the estimates; with a foe,
// also the damage they'd take from one of its turns ("taken") and what still gets through
// ("risks": [[move, status]] not blocked).
export function evaluate(char, level, eq, foe = null) {
  const L = Math.max(1, Math.min(MAXLV, level | 0));
  const items = SLOTS.map((s) => eq[s]).filter((n) => n && EQUIP[n]).map((n) => EQUIP[n]);
  const fx = new Set(), prevent = new Set(), auto = new Set();
  let earrings = 0, elem = 0;
  const el = { absorb: new Set(), null: new Set(), half: new Set(), weak: new Set() };
  const s = { vig: char.vig, spd: char.spd, sta: char.sta, mag: char.mag, def: char.def, mdef: char.mdef, ev: char.ev, mb: char.mb };
  for (const e of items) {
    for (const k of ["vig", "spd", "sta", "mag", "def", "mdef", "ev", "mb"]) s[k] += e[k] || 0;
    for (const f of e.fx || []) fx.add(f);
    for (const p of e.prevent || []) prevent.add(p);
    // The Mythril Glove, Barrier Ring and Princess Ring cast Protect or Shell only at low HP.
    for (const a of e.auto || []) if (!(a === "Safe" && e.fx?.includes("lowprotect")) && !(a === "Shell" && e.fx?.includes("lowshell"))) auto.add(a);
    elem += e.elem || 0;
    for (const k of ["absorb", "null", "half", "weak"]) for (const x of e.el?.[k] || []) el[k].add(x);
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
  const vs = (n) => hitFactor(EQUIP[n].el?.atk, foe);
  let fight;
  if (!weapons.length) fight = hit(char.bp);
  else if (weapons.length === 2) fight = hit(EQUIP[weapons[0]].bp) * vs(weapons[0]) + hit(EQUIP[weapons[1]].bp) * vs(weapons[1]);
  else {
    const w = EQUIP[weapons[0]];
    const twoHanded = fx.has("gauntlet") && w.twoHand && !shields.length;
    fight = hit(twoHanded ? Math.floor(w.bp * 1.75) : w.bp) * vs(weapons[0]);
    if (fx.has("genji") && !twoHanded) fight *= 0.75; // the Genji Glove with one weapon lowers damage
  }
  fight = Math.max(0, fight);
  if (fx.has("phys25")) fight *= 1.25;
  if (fx.has("scroll")) fight *= 2;
  if (fx.has("counter")) fight *= 1.15;
  if (fx.has("sure")) fight *= 1.03;
  s.attack = weapons.reduce((a, n) => a + EQUIP[n].bp, 0) || char.bp;
  const skill = hit(120) * (fx.has("phys25") ? 1.25 : 1);
  const steal = (items.includes(EQUIP["Thief's Bracer"]) ? 2 : 1) * (items.includes(EQUIP["Brigand's Glove"]) ? 1.5 : 1);

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
  let tough, taken = 0;
  const risks = [];
  if (foe) {
    // Damage from one of the monster's turns (its moves weighted), and the share of turns a
    // status that gets through costs.
    const blocked = new Set([...prevent].map((p) => STATUS_AS[p] || p));
    let harm = 0;
    for (const m of foe.moves) {
      const share = m.w * (m.all ? 1 : 0.4); // a single-target move hits this character about 2 turns in 5
      const cut = m.k === "phys" ? phys : m.k === "mag" || m.k === "drain" ? mag : 1;
      const dmg = m.k === "frac" ? s.hp * (m.frac || 0.5) : m.hp || 0;
      taken += share * dmg * cut * (m.k === "frac" ? 1 : takenFactor(m.el, el, auto.has("Float")));
      for (const st of m.st || []) if (!blocked.has(st) && !(st === "Slow" && auto.has("Haste"))) { harm += share * (STATUS_HARM[st] ?? 0.2); risks.push([m.name, st]); }
    }
    taken = Math.max(s.hp * 0.01, taken);
    tough = (100 * s.hp / taken) * Math.max(0.2, 1 - 1.5 * harm);
  } else {
    tough = s.hp / (0.6 * phys + 0.4 * mag);
    tough *= 1 + 0.015 * prevent.size + 0.01 * elem;
  }
  if (auto.has("Regen")) tough *= 1.05;
  if (auto.has("Float")) tough *= 1.02;
  if (fx.has("cursed")) tough *= 0.3;
  if (fx.has("undead")) tough *= 0.7;

  const speed = (s.spd + 20) * (auto.has("Haste") ? 1.5 : 1);
  return { stats: s, fight: Math.round(fight), magic: Math.round(magic), tough: Math.round(tough), skill: Math.round(skill), steal, speed, fx, prevent, auto, taken: Math.round(taken), risks };
}

function weights(char, goal) {
  const c = goal === "cmd" && CMD_GOALS[char.name];
  if (c) return { p: c.f || 0, m: c.m || 0, k: c.k || 0, st: c.st || 0, d: 0.6, sp: 0.5 };
  const base = { phys: [1, 0], mixed: [0.6, 0.6], magic: [0.1, 1] }[char.role] || [1, 0];
  let [p, m] = base, d = 1, sp = 0.5;
  if (goal === "attack") { p *= 1.6; m *= 1.6; d = 0.5; }
  else if (goal === "defense") { p *= 0.5; m *= 0.5; d = 1.8; }
  else if (goal === "magic") { p = 0.1; m = 1.6; }
  return { p, m, k: 0, st: 0, d, sp };
}

export function score(char, level, eq, goal, foe = null) {
  const r = evaluate(char, level, eq, foe);
  const w = weights(char, goal);
  return w.p * Math.log(r.fight + 1) + w.m * Math.log(r.magic + 1) + w.d * Math.log(r.tough + 1) + w.sp * Math.log(r.speed) + w.k * Math.log(r.skill + 1) + w.st * Math.log(r.steal);
}

// Two weapons need the Genji Glove, and there's only one shield at a time.
export function handsOk(eq) {
  const a = EQUIP[eq.rh]?.slot, b = EQUIP[eq.lh]?.slot;
  if (a === "weapon" && b === "weapon") return [eq.r1, eq.r2].some((n) => (EQUIP[n]?.fx || []).includes("genji"));
  return !(a === "shield" && b === "shield");
}

// Best load-out for one character. pool: { name: count } of items they may use (including what
// they wear now); locked: { slot: true } slots to keep as they are in `current`; foe: a monster
// to optimize against (foe.js), or null.
export function optimizeOne(char, level, goal, pool, current = {}, locked = {}, foe = null) {
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
            if (!fits(trial) || (n && !handsOk(trial))) continue;
            const v = score(char, level, trial, goal, foe);
            if (v > top + 1e-9) { top = v; pick = n; }
          }
          if (pick !== eq[s]) { eq[s] = pick; changed = true; }
        }
        if (!changed) break;
      }
      const v = score(char, level, eq, goal, foe);
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
// bag: { name: count } of unequipped items; foe as for optimizeOne. Returns { loadouts: [eq], bag }.
export function optimizeParty(members, bag, foe = null) {
  const pool = { ...bag };
  for (const m of members) for (const s of SLOTS) if (m.eq[s] && !m.locked[s]) pool[m.eq[s]] = (pool[m.eq[s]] || 0) + 1;
  const take = (eq, locked, sign) => { for (const s of SLOTS) if (eq[s] && !locked[s]) pool[eq[s]] = (pool[eq[s]] || 0) + sign; };
  const result = members.map(() => null);
  for (let round = 0; round < 3; round++) {
    members.forEach((m, i) => {
      if (result[i]) take(result[i], m.locked, +1);
      result[i] = optimizeOne(m.char, m.level, m.goal, pool, m.eq, m.locked, foe);
      take(result[i], m.locked, -1);
    });
  }
  const left = {};
  for (const [n, k] of Object.entries(pool)) if (k > 0) left[n] = k;
  return { loadouts: result, bag: left };
}

// ---------------- espers ----------------
// Espers don't change stats directly: they teach spells after each battle (AP × learn rate,
// learned at 100) and give their bonus at each level-up. So the choice is between learning the
// most spells still missing and earning the level-up bonus that suits the character.

const CANT_EQUIP_ESPERS = new Set(["Gogo", "Umaro"]);
export const canEquipEsper = (char) => !CANT_EQUIP_ESPERS.has(char.name);

export function bonusValue(char, goal, b) {
  if (!b) return 0;
  const role = { phys: [1, 0.1], mixed: [0.6, 0.6], magic: [0.1, 1] }[char.role] || [1, 0.1];
  let v = 0;
  if (b.stat === "str") v = role[0] * b.amt;
  else if (b.stat === "mag") v = role[1] * b.amt;
  else if (b.stat === "agi") v = 0.8 * b.amt;
  else if (b.stat === "sta") v = 0.3 * b.amt;
  else if (b.stat === "hp") v = 0.08 * b.amt;
  else if (b.stat === "mp") v = (role[1] * 0.5 + 0.05) * (b.amt / 10);
  if (goal === "attack" && (b.stat === "str" || b.stat === "mag")) v *= 1.5;
  if (goal === "defense" && (b.stat === "hp" || b.stat === "sta")) v *= 1.5;
  if (goal === "magic" && (b.stat === "mag" || b.stat === "mp")) v *= 1.5;
  const c = goal === "cmd" && CMD_GOALS[char.name];
  if (c && b.stat === "str" && (c.k || 0) + (c.f || 0) >= (c.m || 0)) v *= 1.5;
  if (c && b.stat === "mag" && (c.m || 0) > (c.k || 0) + (c.f || 0)) v *= 1.5;
  return v;
}

// How much is left to learn: the sum of learn rates of spells this character doesn't know yet.
export const learning = (esper, learned) => esper.spells.reduce((a, [s, r]) => a + (learned.has(s) ? 0 : r), 0);

export function esperValue(char, goal, esper, learned, mode) {
  const spells = learning(esper, learned), bonus = bonusValue(char, goal, esper.bonus);
  return mode === "bonus" ? bonus + spells / 100 : spells / 20 + bonus * 0.3;
}

// members: [{ char, goal, learned: Set, esper, mode ("spells" or "bonus"), locked }]; espers:
// available esper objects.
// Returns the best esper name (or "") for each member, each esper used once.
export function assignEspers(members, espers) {
  const taken = new Set(members.filter((m) => m.locked && m.esper).map((m) => m.esper));
  const free = espers.filter((e) => !taken.has(e.name));
  const choices = members.map((m) => {
    if (m.locked || !canEquipEsper(m.char)) return [{ name: m.locked ? m.esper || "" : "", v: 0 }];
    const ranked = free.map((e) => ({ name: e.name, v: esperValue(m.char, m.goal, e, m.learned, m.mode) })).sort((a, b) => b.v - a.v).slice(0, 8);
    return [...ranked, { name: "", v: 0 }];
  });
  let best = null, bestV = -Infinity;
  const pick = (i, used, acc, v) => {
    if (i === members.length) { if (v > bestV) { bestV = v; best = [...acc]; } return; }
    for (const c of choices[i]) {
      if (c.name && used.has(c.name) && !members[i].locked) continue;
      if (c.name) used.add(c.name);
      acc.push(c.name);
      pick(i + 1, used, acc, v + c.v);
      acc.pop();
      if (c.name && !members[i].locked) used.delete(c.name);
    }
  };
  pick(0, new Set(taken), [], 0);
  return best || members.map((m) => m.esper || "");
}
