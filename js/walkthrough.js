// Walkthrough: a short, original route through the game (walkthrough/ff6-pr.md), shown as a
// chapter index (#/ and #/walk) and chapter pages (#/walk/<n>). Format notes are at the top of the file.
// Done chapters are stored by slug in the "walkDone" setting; the last chapter opened in "walkLast".

import { getPref, setPref } from "./store.js";
import { esc } from "./render.js";
import { findMonster } from "./monsters.js";

const SRC = "walkthrough/ff6-pr.md";
let cache = null;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function loadWalkthrough() {
  if (cache) return cache;
  const res = await fetch(SRC);
  if (!res.ok) throw new Error("The walkthrough couldn't be loaded.");
  cache = parse(await res.text());
  return cache;
}

// { parts: [{ title, chapters: [n] }], chapters: [{ n, part, title, slug, guide, where, intro, sections: [{ title, blocks }] }] }
export function parse(text) {
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  const parts = [], chapters = [];
  let part = null, ch = null, sec = null;
  const block = (b) => {
    const into = sec ? sec.blocks : ch ? ch.intro : null;
    if (!into) return;
    const last = into[into.length - 1];
    if (b.type === "li" && last && last.type === "ul") last.items.push(b.text);
    else into.push(b.type === "li" ? { type: "ul", items: [b.text] } : b);
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^# (.+)/))) { part = { title: m[1].trim(), chapters: [] }; parts.push(part); ch = sec = null; }
    else if ((m = line.match(/^## (.+)/))) {
      ch = { n: chapters.length + 1, part: part ? part.title : "", title: m[1].trim(), slug: slug(m[1]), guide: "", where: [], intro: [], sections: [] };
      chapters.push(ch); if (part) part.chapters.push(ch.n); sec = null;
    }
    else if ((m = line.match(/^### (.+)/)) && ch) { sec = { title: m[1].trim(), blocks: [] }; ch.sections.push(sec); }
    else if ((m = line.match(/^@guide\s+(.+)/)) && ch) ch.guide = m[1].trim();
    else if ((m = line.match(/^@where\s+(.+)/)) && ch) ch.where = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    else if ((m = line.match(/^\s*[-*] (.+)/))) block({ type: "li", text: m[1] });
    else if (line.trim()) {
      const into = sec ? sec.blocks : ch ? ch.intro : null;
      const last = into && into[into.length - 1];
      if (last && last.type === "p" && !last.done) last.text += " " + line.trim();
      else block({ type: "p", text: line.trim() });
    } else {
      const into = sec ? sec.blocks : ch ? ch.intro : null;
      const last = into && into[into.length - 1];
      if (last) last.done = true;
    }
  }
  return { parts, chapters };
}

// Inline markup: **bold**, *italic*, [[Monster]] / [[Shown|Monster]] links to Monster intel.
export function inline(s) {
  let h = esc(s);
  h = h.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, shown, target) => {
    const name = (target || shown).trim();
    const m = findMonster(name);
    if (!m) return esc(shown);
    return `<a class="wt-mon ent ent-${m.boss ? "boss" : "enemy"}" href="#/monsters/${encodeURIComponent(m.name)}">${shown.trim()}</a>`;
  });
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  return h;
}

const blocksHtml = (blocks) => blocks.map((b) => (b.type === "ul" ? `<ul>${b.items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>` : `<p>${inline(b.text)}</p>`)).join("");

const SEC_CLASS = (t) => (/^boss/i.test(t) ? "wt-boss" : /^monsters/i.test(t) ? "wt-monsters" : /^don't miss/i.test(t) ? "wt-miss" : /grind/i.test(t) ? "wt-grind" : /side/i.test(t) ? "wt-side" : "");

export const loadDone = () => new Set(getPref("walkDone", []));
export const saveDone = (set) => setPref("walkDone", set.size ? [...set] : null);

// Plain text of a chapter, for search: markup dropped, monster links reduced to what's shown.
const plain = (s) => s.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
const blocksText = (blocks) => blocks.map((b) => (b.type === "ul" ? b.items.join("\n") : b.text)).join("\n");
export const chapterText = (c) => [c.title, blocksText(c.intro), ...c.sections.map((s) => s.title + "\n" + blocksText(s.blocks))].map(plain).join("\n");

// ctx: { rename(html) -> html, decorate(bodyEl), mapsFor(chapter) -> html (chips under the title), onDone(), askUpto(chapter), toast }
export async function renderWalkIndex(view, ctx) {
  view.innerHTML = `<p class="loading">Loading the walkthrough…</p>`;
  let w;
  try { w = await loadWalkthrough(); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const done = loadDone();
  const last = w.chapters.find((c) => c.slug === getPref("walkLast", "")) || w.chapters.find((c) => !done.has(c.slug)) || w.chapters[0];
  const total = w.chapters.length, n = w.chapters.filter((c) => done.has(c.slug)).length;
  view.innerHTML = ctx.rename(`
  <section class="walk">
    <p class="eyebrow">Final Fantasy VI · Pixel Remaster</p>
    <h1>Walkthrough</h1>
    <p class="hint">A short route from the opening to the credits: where to go, the bosses, what's worth doing on the way, and good places to level up. Colored names open their wiki article or Monster intel card; hover over one (or tap it) for a short summary. Written for the Pixel Remaster.</p>
    <a class="continue" href="#/walk/${last.n}"><span class="eyebrow">${n ? "Continue" : "Start"}</span><span class="ct"><span class="num">${last.n}</span>${esc(last.title)}</span></a>
    <p class="stat">${total} chapters${n ? ` · ${n} done` : ""}</p>
    ${w.parts.map((p) => `<h2 class="sheet-sub">${esc(p.title)}</h2><ol class="chapters wt-list">${p.chapters.map((i) => { const c = w.chapters[i - 1]; return `<li><a href="#/walk/${c.n}"${done.has(c.slug) ? ' class="done"' : ""}><span class="n">${c.n}</span><span class="t">${esc(c.title)}</span>${done.has(c.slug) ? `<span class="cnt">✓</span>` : ""}</a></li>`; }).join("")}</ol>`).join("")}
  </section>`);
}

export async function renderWalkChapter(view, n, ctx) {
  view.innerHTML = `<p class="loading">Loading the walkthrough…</p>`;
  let w;
  try { w = await loadWalkthrough(); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return null; }
  const c = w.chapters[n - 1];
  if (!c) { location.hash = "#/walk"; return null; }
  setPref("walkLast", c.slug);
  const done = loadDone();
  const prev = w.chapters[n - 2], next = w.chapters[n];
  const maps = ctx.mapsFor(c);
  const before = w.chapters.slice(0, n).filter((x) => !done.has(x.slug)).length;
  const nav = (t, dir) => (t ? `<a class="pn ${dir}" href="#/walk/${t.n}" rel="${dir}"><span class="eyebrow">${dir === "prev" ? "Previous" : "Next"}</span><span class="pt"><span class="num">${t.n}</span>${esc(t.title)}</span></a>` : "<span></span>");
  view.innerHTML = ctx.rename(`
  <article class="sec walk-ch">
    <p class="eyebrow"><a href="#/walk">Walkthrough</a> · ${esc(c.part)}</p>
    <h1 class="sec-h"><span class="num">${c.n}</span><span>${esc(c.title)}</span></h1>
    ${maps ? `<div class="sec-maps"><span class="eyebrow">Maps</span>${maps}</div>` : ""}
    <div class="body">
      ${blocksHtml(c.intro)}
      ${c.sections.map((s) => `<section class="wt-sec ${SEC_CLASS(s.title)}"><h2>${inline(s.title)}</h2>${blocksHtml(s.blocks)}</section>`).join("")}
    </div>
    <button type="button" class="done-btn${done.has(c.slug) ? " on" : ""}" id="walkDone" aria-pressed="${done.has(c.slug)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>${done.has(c.slug) ? "Done" : "Mark chapter done"}</span></button>
    ${before > (done.has(c.slug) ? 0 : 1) ? `<button type="button" class="txt-btn upto-btn" id="walkUpto">Mark everything up to here done</button>` : ""}
    <nav class="pager" aria-label="Chapter navigation">${nav(prev, "prev")}${nav(next, "next")}</nav>
  </article>`);
  ctx.decorate(view.querySelector(".body"));
  const btn = view.querySelector("#walkDone");
  btn.onclick = () => {
    const d = loadDone();
    if (d.has(c.slug)) d.delete(c.slug); else d.add(c.slug);
    saveDone(d);
    const on = d.has(c.slug);
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.querySelector("span").textContent = on ? "Done" : "Mark chapter done";
    ctx.onDone();
  };
  const upto = view.querySelector("#walkUpto");
  if (upto) upto.onclick = () => ctx.askUpto(c);
  return c;
}
