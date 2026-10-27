// Grinding against one monster, for the Party page's optimizer: what the monster does to the
// party, what hurts it, and what a quick trip to a shop would add.
//
// A foe is built from the monster's entry in monsters-data.js: its elements, and its moves. Its
// special attack ("Bite (Level 12 = Attack x 7)") is physical, with the multiplier or status in
// the text; other moves are looked up in moves-data.js. The data doesn't say how often a monster
// uses each move, so Attack and the special count double, moves only Gau's Rage lists count half,
// and the rest count once. Damage is a rough guess from the monster's level (FF6's formulas,
// with typical monster stats), good for weighing one move against another, not for exact numbers.
//
// Shopping: for each item sold in the foe's world, try it in every party member's optimized
// load-out; for the items that help, optimize the party again with enough extra copies to see how
// many are worth buying. Shops are listed nearest first, from where the monster lives.

import { MONSTERS } from "./monsters-data.js";
import { MOVES } from "./moves-data.js";
import { GEAR } from "./gear-data.js";
import { ARTICLES } from "./wiki-data.js";
import { EQUIP } from "./party-data.js";
import { MARKERS, SAME, SIZE } from "./worldmap-data.js";
import { SLOTS, STATUS_AS, canEquip, slotFits, handsOk, score, evaluate, optimizeParty } from "./optimizer.js";

const ALL = MONSTERS.flatMap((m) => (m.forms ? [{ ...m, ...m.forms[0], forms: m.forms }] : [m]));
const byName = new Map();
for (const m of ALL) { byName.set(m.name.toLowerCase(), m); if (m.alt) byName.set(m.alt.toLowerCase(), m); }
export const FOE_NAMES = ALL.map((m) => m.name).sort();
export const findFoe = (name) => byName.get(String(name || "").trim().toLowerCase()) || null;

const PLACES = ARTICLES.filter((a) => a.kind === "place");
const placeId = new Map(PLACES.map((p) => [p.name.toLowerCase(), p.id]));
const pin = (world, id) => MARKERS[world][SAME[id] || id];
const KIND = { phys: "physical", mag: "magic", drain: "drains HP", pierce: "ignores defense", fixed: "fixed damage", frac: "a share of HP", status: "status" };

// A move from a monster's special attack text.
function special(text) {
  const [, name, what = ""] = text.match(/^(.*?)\s*(?:\((.*)\))?\s*$/);
  const x = what.match(/Attack x\s*([\d.]+)/i);
  const st = what.match(/^(?:Inflicts )?(Sap|Poison|Confuse|Zombie|Blind|Sleep|Stop|Petrify|Imp|Death|Silence|Slow|Doom|Berserk)$/i);
  return { name, k: "phys", mult: x ? +x[1] : st ? 1 : 1.5, st: st ? [st[1][0].toUpperCase() + st[1].slice(1).toLowerCase()] : [] };
}
const list = (s) => (s ? s.split(/,\s*(?![^()]*\))/).map((x) => x.trim()).filter(Boolean) : []);

// Where a monster lives: { world: "wob" | "wor" | null (either), place: id | null }.
function home(m) {
  const where = m.where || "";
  const ids = PLACES.filter((p) => where.toLowerCase().includes(p.name.toLowerCase())).map((p) => p.id);
  let world = /world of ruin|\bwor\b/i.test(where) ? "wor" : /world of balance|\bwob\b/i.test(where) ? "wob" : null;
  if (!world) {
    const ws = new Set(ids.flatMap((id) => ["wob", "wor"].filter((w) => pin(w, id))));
    if (ws.size === 1) world = [...ws][0];
  }
  return { world, place: ids.find((id) => (world ? pin(world, id) : true)) || null };
}

// The foe object the optimizer reads: { name, level, world, place, weak, absorb, immune, resist
// (Sets of elements), moves: [{ name, k, el, st, all, hp (damage before defense), w (share of its
// turns) }], unknown: [move names not in moves-data.js] }.
export function makeFoe(m) {
  if (!m) return null;
  const forms = m.forms || [m];
  const level = Math.max(...forms.map((f) => parseInt(f.level, 10) || 1));
  const seen = new Map(), unknown = [];
  const add = (name, mv, w) => {
    const prev = seen.get(name);
    if (prev) { prev.w = Math.max(prev.w, w); return; }
    seen.set(name, { ...mv, name, w });
  };
  add("Attack", { k: "phys", mult: 1 }, 2);
  for (const f of forms) {
    if (f.special) { const s = special(f.special); add(s.name, s, 2); }
    for (const [field, w] of [["other", 1], ["control", 1], ["sketch", 1], ["rage", 0.5]]) {
      for (const raw of list(f[field])) {
        const name = raw.replace(/\s*\(.*\)$/, "");
        if (name === "Attack" || name === "Attck" || (f.special && name === special(f.special).name)) continue;
        const mv = MOVES[name];
        if (!mv) { if (!unknown.includes(name)) unknown.push(name); continue; }
        if (mv.k === "self" || mv.k === "other") continue;
        add(name, mv, w);
      }
    }
  }
  const moves = [...seen.values()];
  const total = moves.reduce((a, x) => a + x.w, 0);
  for (const x of moves) {
    x.w /= total;
    x.st = x.st || [];
    // Damage before defense: physical as a level-based hit, magic from the spell's power.
    if (x.k === "phys") x.hp = level * 15 * (x.mult || 1);
    else if (x.k === "mag" || x.k === "drain" || x.k === "pierce") x.hp = (x.pow || 20) * (4 + (level * 10) / 32);
    else if (x.k === "fixed") x.hp = x.dmg || 1000;
    else x.hp = 0;
  }
  const el = m.el || {};
  return { name: m.name, level, ...home(m), weak: new Set(el.weak || []), absorb: new Set(el.absorb || []), immune: new Set(el.immune || []), resist: new Set(el.resist || []), moves, unknown };
}

// A move in a few words: "Meteor (magic, whole party)".
export function moveText(x) {
  const bits = [x.el ? `${x.el} ${KIND[x.k] || x.k}` : KIND[x.k] || x.k];
  if (x.k === "phys" && x.mult && x.mult !== 1) bits.push(`×${x.mult}`);
  if (x.st.length) bits.push(x.st.join(", "));
  if (x.all) bits.push("whole party");
  return `${x.name} (${bits.join(", ")})`;
}

// ---------------- shopping ----------------

// Shops selling an item: [{ town, id, world }]. "Albrook (WoR)" is in the World of Ruin; a town
// with no world named sells it in both. The Auction House isn't a shop.
const SHOPS = new Map();
for (const g of GEAR) {
  if (g.gba || !g.buy || !EQUIP[g.name]) continue;
  const out = [];
  for (const [how, where] of g.get || []) {
    if (how !== "Buy") continue;
    for (const entry of list(where)) {
      const [, town, tag = ""] = entry.match(/^([^(]+?)\s*(?:\((.*)\))?$/) || [];
      const id = town && placeId.get(town.toLowerCase());
      if (!id || id === "auction-house") continue;
      const worlds = /wor|ruin/i.test(tag) ? ["wor"] : /wob|balance/i.test(tag) ? ["wob"] : ["wob", "wor"].filter((w) => pin(w, id));
      for (const world of worlds) if (!out.some((s) => s.id === id && s.world === world)) out.push({ town, id, world });
    }
  }
  if (out.length) SHOPS.set(g.name, { price: g.buy, shops: out });
}

// Map distance, wrapping round the world's edges as the airship does.
function distance(world, a, b) {
  const p = pin(world, a), q = pin(world, b);
  if (!p || !q) return Infinity;
  const d = (x) => Math.min(Math.abs(x), SIZE - Math.abs(x));
  return Math.hypot(d(p[0] - q[0]), d(p[1] - q[1]));
}

// Where to buy an item for this foe: shops in its world, nearest first.
export function shopsFor(item, foe) {
  const s = SHOPS.get(item);
  if (!s) return [];
  const here = s.shops.filter((x) => !foe.world || x.world === foe.world);
  return here.map((x) => ({ ...x, dist: foe.place ? distance(x.world, foe.place, x.id) : 0 })).sort((a, b) => a.dist - b.dist);
}

// Why an item helps against this foe, in a few words each.
export function itemWhy(item, foe) {
  const e = EQUIP[item], why = [];
  for (const x of e.el?.atk || []) if (foe.weak.has(x)) why.push(`${x} hits its weakness`);
  const prevent = new Set((e.prevent || []).map((p) => STATUS_AS[p] || p));
  for (const m of foe.moves) {
    for (const st of m.st) if (prevent.has(st)) why.push(`blocks ${st} (${m.name})`);
    if (m.el) for (const [k, verb] of [["absorb", "absorbs"], ["null", "nullifies"], ["half", "halves"]]) if (e.el?.[k]?.includes(m.el)) why.push(`${verb} ${m.el} (${m.name})`);
    if (m.el && e.el?.weak?.includes(m.el)) why.push(`but weak to ${m.el} (${m.name})`);
  }
  const auto = e.auto || [];
  if ((auto.includes("Safe") || auto.includes("Protect")) && foe.moves.some((m) => m.k === "phys")) why.push("Protect against physical attacks");
  if (auto.includes("Shell") && foe.moves.some((m) => m.k === "mag")) why.push("Shell against magic");
  if (auto.includes("Float") && foe.moves.some((m) => m.el === "Earth")) why.push("Float dodges Earth attacks");
  if (auto.includes("Haste") && foe.moves.some((m) => m.st.includes("Slow"))) why.push("Haste undoes Slow");
  return [...new Set(why)];
}

// Items worth a trip to a shop. members and bag as for optimizeParty; res: its result; owned(item):
// how many you have in all. Returns up to `max` of [{ item, buy, have, price, shops, why, who }]
// (who: [{ name, before, after }] for the members whose load-out changes), best first.
export function shoppingList(members, bag, foe, res, owned, max = 4) {
  const total = (loadouts) => members.reduce((a, m, i) => a + score(m.char, m.level, loadouts[i], m.goal, foe), 0);
  const base = total(res.loadouts);
  const gains = [];
  for (const item of SHOPS.keys()) {
    if (!shopsFor(item, foe).length) continue;
    let gain = 0, helped = 0;
    members.forEach((m, i) => {
      const lo = res.loadouts[i], now = score(m.char, m.level, lo, m.goal, foe);
      let best = 0;
      for (const s of SLOTS) {
        if (m.locked[s] || lo[s] === item || !slotFits(s, item) || !canEquip(m.char, item)) continue;
        const trial = { ...lo, [s]: item };
        if (!handsOk(trial)) continue;
        best = Math.max(best, score(m.char, m.level, trial, m.goal, foe) - now);
      }
      if (best > 0.01) { gain += best; helped++; }
    });
    if (helped) gains.push({ item, gain, helped });
  }
  gains.sort((a, b) => b.gain - a.gain);
  const out = [];
  for (const g of gains.slice(0, max + 3)) {
    const extra = g.helped;
    const next = optimizeParty(members, { ...bag, [g.item]: (bag[g.item] || 0) + extra }, foe);
    const buy = extra - (next.bag[g.item] || 0);
    const gain = total(next.loadouts) - base;
    if (buy <= 0 || gain < 0.02) continue;
    const who = members.map((m, i) => ({ m, i })).filter(({ i }) => SLOTS.some((s) => next.loadouts[i][s] === g.item) && !SLOTS.some((s) => res.loadouts[i][s] === g.item && next.loadouts[i][s] === g.item))
      .map(({ m, i }) => ({ char: m.char, before: evaluate(m.char, m.level, res.loadouts[i], foe), after: evaluate(m.char, m.level, next.loadouts[i], foe) }));
    out.push({ item: g.item, buy, have: owned(g.item), price: SHOPS.get(g.item).price, shops: shopsFor(g.item, foe), why: itemWhy(g.item, foe), who, gain });
  }
  return out.sort((a, b) => b.gain - a.gain).slice(0, max);
}
