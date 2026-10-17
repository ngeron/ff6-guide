// World map (#/map): a drawn map of the World of Balance or the World of Ruin with a pin for
// every place. From a chapter it shows where that chapter goes: its places are highlighted, and
// a line runs from where the last chapter ended, with the compass direction to fly.
// Drag to pan; pinch, scroll or use the buttons to zoom. Pins are links to the wiki, so they
// get the usual summary popup.

import { SIZE, TERRAIN, MARKERS, SAME, PINS } from "./worldmap-data.js";
import { esc } from "./render.js";

export const WORLDS = { wob: "World of Balance", wor: "World of Ruin" };
const pinOf = (id) => SAME[id] || id;

// The worlds a place has a pin in.
export const worldsOf = (id) => Object.keys(WORLDS).filter((w) => MARKERS[w][pinOf(id)]);

const POINTS = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast",
  "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest"];

const compass = (dx, dy) => POINTS[Math.round(((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360) / 22.5) % 16];

// The way from a to b across the map, and, since the world wraps around at its edges, the way
// over the edge when that's clearly shorter: { dir, wrap: dir | null }.
function heading(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const near = (d) => (d > SIZE / 2 ? d - SIZE : d < -SIZE / 2 ? d + SIZE : d);
  const wx = near(dx), wy = near(dy);
  const shorter = Math.hypot(wx, wy) < Math.hypot(dx, dy) * 0.75;
  return { dir: compass(dx, dy), wrap: shorter ? compass(wx, wy) : null };
}

// opts: { world, focus: place id, route: { from, to, also: [ids], chapter }, back: { n, title } | null }
// ctx: { name(id) -> shown name, href(id) -> link for a pin }
export function renderWorldMap(view, opts, ctx) {
  const { world } = opts;
  const pins = MARKERS[world];
  const route = opts.route;
  const on = new Set(route ? [route.to, ...route.also].filter(Boolean).map(pinOf) : []);
  const focus = opts.focus && pinOf(opts.focus);
  if (focus) on.add(focus);
  const from = route && route.from && pinOf(route.from);
  const to = route && route.to && pinOf(route.to);
  let dirHtml = "";
  if (route) {
    const where = [route.to, ...route.also].filter(Boolean);
    const h = from && to && from !== to ? heading(pins[from], pins[to]) : null;
    dirHtml = `<p class="wm-dir"><span class="eyebrow">Chapter ${route.chapter.n}</span> ${esc(route.chapter.title)}<br>` +
      (h ? `From <strong>${esc(ctx.name(from))}</strong>, fly <strong>${h.dir}</strong> to <strong>${esc(ctx.name(to))}</strong>${h.wrap ? ` (or ${h.wrap} over the edge of the map, which is shorter: the world wraps around)` : ""}.`
        : where.length ? `Places: ${where.map((id) => `<strong>${esc(ctx.name(id))}</strong>`).join(", ")}.` : "No places on this map in this chapter.") +
      (h && route.also.length ? ` Also: ${route.also.map((id) => esc(ctx.name(id))).join(", ")}.` : "") + `</p>`;
  } else if (focus) {
    dirHtml = `<p class="wm-dir"><strong>${esc(ctx.name(focus))}</strong> in the ${WORLDS[world]}.</p>`;
  }
  const t = TERRAIN[world];
  const ground = Object.keys(t).filter((k) => k !== "land").map((k) => `<path class="wm-${k}" d="${t[k]}"/>`).join("");
  let line = "";
  if (from && to && from !== to) {
    const a = pins[from], b = pins[to];
    line = `<path class="wm-route" d="M${a[0] + 0.5} ${a[1] + 0.5}L${b[0] + 0.5} ${b[1] + 0.5}"/>`;
  }
  view.innerHTML = `
  <section class="wmap${world === "wor" ? " wm-ruin" : ""}">
    ${opts.back ? `<a class="wk-back" href="#/walk/${opts.back.n}">‹ Back to chapter ${opts.back.n}, ${esc(opts.back.title)}</a>` : ""}
    <div class="wm-bar">
      <div class="seg" role="group" aria-label="World">${Object.entries(WORLDS).map(([w, label]) => `<a class="wm-w" href="#/map/${w}" aria-current="${w === world ? "page" : "false"}">${label}</a>`).join("")}</div>
      <div class="wm-zoom"><button type="button" class="btn" id="wmOut" aria-label="Zoom out">−</button><button type="button" class="btn" id="wmFit">Fit</button><button type="button" class="btn" id="wmIn" aria-label="Zoom in">+</button></div>
    </div>
    ${dirHtml}
    <div class="wm-stage" id="wmStage" aria-label="Map of the ${WORLDS[world]}">
      <svg class="wm-svg" aria-hidden="true"><g id="wmG" shape-rendering="crispEdges"><path class="wm-land" d="${t.land}"/>${ground}</g><g id="wmR">${line}</g></svg>
      <div class="wm-pins">${Object.entries(pins).map(([id, [x, y]]) => `<a class="wm-pin${on.has(id) ? " on" : ""}${id === from ? " from" : ""}" href="${esc(ctx.href(id))}" data-x="${x + 0.5}" data-y="${y + 0.5}"><span class="wm-dot"></span><span class="wm-lb">${esc(ctx.name(id))}</span></a>`).join("")}</div>
    </div>
    <p class="hint small">Drawn from the game's world map; pins are approximate. Tap a pin for a summary.</p>
  </section>`;

  const stage = view.querySelector("#wmStage");
  const g = view.querySelector("#wmG"), r = view.querySelector("#wmR");
  const els = [...view.querySelectorAll(".wm-pin")];
  let s = 1, s0 = 1, tx = 0, ty = 0;
  const apply = () => {
    const tr = `translate(${tx} ${ty}) scale(${s})`;
    g.setAttribute("transform", tr);
    r.setAttribute("transform", tr);
    for (const el of els) { el.style.left = el.dataset.x * s + tx + "px"; el.style.top = el.dataset.y * s + ty + "px"; }
    stage.classList.toggle("wm-labels", s >= 4.2);
  };
  const size = () => stage.getBoundingClientRect();
  const fit = () => {
    const b = size();
    s0 = Math.min(b.width, b.height) / SIZE;
    s = s0; tx = (b.width - SIZE * s) / 2; ty = (b.height - SIZE * s) / 2;
    apply();
  };
  const center = (x, y, ns) => { const b = size(); s = ns; tx = b.width / 2 - x * s; ty = b.height / 2 - y * s; apply(); };
  const zoomAt = (f, px, py) => {
    const ns = Math.max(s0 * 0.8, Math.min(48, s * f));
    tx = px - (px - tx) * ns / s; ty = py - (py - ty) * ns / s; s = ns;
    apply();
  };
  fit();
  // Start on what matters: the place asked for, or the chapter's places.
  const show = [...on, from].filter((id) => id && pins[id]);
  if (show.length) {
    const xs = show.map((id) => pins[id][0]), ys = show.map((id) => pins[id][1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 40) + 30;
    const b = size();
    center((Math.max(...xs) + Math.min(...xs)) / 2 + 0.5, (Math.max(...ys) + Math.min(...ys)) / 2 + 0.5, Math.min(b.width, b.height) / Math.min(span, SIZE));
  }

  view.querySelector("#wmIn").onclick = () => { const b = size(); zoomAt(1.6, b.width / 2, b.height / 2); };
  view.querySelector("#wmOut").onclick = () => { const b = size(); zoomAt(1 / 1.6, b.width / 2, b.height / 2); };
  view.querySelector("#wmFit").onclick = fit;

  // Drag to pan, two fingers to pinch. A drag doesn't count as a tap on a pin.
  const pts = new Map();
  let last = null, pinch = null, moved = 0;
  const rel = (e) => { const b = size(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  stage.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, rel(e));
    if (pts.size === 1) { last = rel(e); moved = 0; }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s }; }
  });
  const move = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = rel(e);
    pts.set(e.pointerId, p);
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      zoomAt(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d / s, (a.x + b.x) / 2, (a.y + b.y) / 2);
      moved = 99;
    } else if (pts.size === 1 && last) {
      tx += p.x - last.x; ty += p.y - last.y; moved += Math.abs(p.x - last.x) + Math.abs(p.y - last.y);
      last = p;
      apply();
    }
  };
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) last = null; else last = [...pts.values()][0]; };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
  stage.addEventListener("click", (e) => { if (moved > 6) { e.preventDefault(); e.stopPropagation(); } }, true);
  stage.addEventListener("wheel", (e) => { e.preventDefault(); const p = rel(e); zoomAt(Math.exp(-e.deltaY * 0.0025), p.x, p.y); }, { passive: false });
  stage.addEventListener("dblclick", (e) => { if (e.target.closest(".wm-pin")) return; const p = rel(e); zoomAt(2, p.x, p.y); });
  const onResize = () => { const b = size(); if (b.width) { const cx = (b.width / 2 - tx) / s, cy = (b.height / 2 - ty) / s; s0 = Math.min(b.width, b.height) / SIZE; center(cx, cy, Math.max(s, s0 * 0.8)); } };
  addEventListener("resize", onResize);
  // The listeners on window go when the page changes.
  addEventListener("hashchange", () => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); removeEventListener("resize", onResize);
  }, { once: true });
}

export const pinName = (id) => (PINS[id] ? PINS[id].name : null);
export const pinHref = (id) => (PINS[id] ? PINS[id].href : null);
