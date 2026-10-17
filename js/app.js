import { esc } from "./render.js";
import { removeGuide, removeMaps, getPref, setPref, onPrefChange } from "./store.js";
import { makeBackup, readBackup, describeBackup, restoreBackup, DATA_KEYS } from "./backup.js";
import { renderRages, rageCounts } from "./rages.js";
import { renderGear, gearCounts } from "./gear.js";
import { renderMonsters, findMonster } from "./monsters.js";
import { MONSTERS } from "./monsters-data.js";
import { renderParty, partyCount } from "./party.js";
import * as cloud from "./cloud.js";
import { KINDS, KIND_LABEL, loadTags, saveTags, buildTerms, matcher, markNames } from "./tags.js";
import { DEFAULT_NAMES, loadNames, saveNames, renamer } from "./names.js";
import { loadWalkthrough, renderWalkIndex, renderWalkChapter, chapterText, loadDone as loadWalkDone, saveDone as saveWalkDone } from "./walkthrough.js";
import { renderWiki, wikiTerms, linkFor, bindPeek, searchWiki, getEntry } from "./wiki.js";
import { renderWorldMap, worldsOf, pinName, pinHref } from "./worldmap.js";

const VERSION = "0.27.0";
const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const state = {
  walk: null,       // the walkthrough: { parts, chapters } (walkthrough.js)
  chapter: null,    // number of the chapter on screen
  terms: null,      // color coding: Map(term -> kind)
  matcher: null,
  unrename: null,   // your character names -> the guide's names, for links
  back: null,       // { n, y }: the chapter you left for a wiki article, monster card or the map, and where you were on it
  pendingQuery: "",
  searchText: null,
  wakeLock: null,
};

/* ---------------- settings ---------------- */

const prefs = {
  fs: getPref("fs", 18),
  theme: getPref("theme", "auto"),
  font: getPref("font", "serif"),
  wake: getPref("wake", false),
  colorNames: getPref("colorNames", true),
};

function applyPrefs() {
  root.style.setProperty("--fs", prefs.fs + "px");
  $("fsOut").textContent = prefs.fs;
  if (prefs.theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", prefs.theme);
  root.dataset.font = prefs.font;
  for (const [segId, val] of [["themeSeg", prefs.theme], ["fontSeg", prefs.font]]) {
    for (const b of $(segId).querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.v === val));
  }
  $("wake").checked = prefs.wake;
  $("colorNames").checked = prefs.colorNames;
}

function setPrefValue(key, value) {
  prefs[key] = value;
  setPref(key, value);
  applyPrefs();
}

$("fsDown").onclick = () => setPrefValue("fs", Math.max(14, prefs.fs - 1));
$("fsUp").onclick = () => setPrefValue("fs", Math.min(28, prefs.fs + 1));
$("themeSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) setPrefValue("theme", b.dataset.v); };
$("fontSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) setPrefValue("font", b.dataset.v); };

/* ---------------- character names ---------------- */

let names = loadNames();
$("nameSugg").innerHTML = DEFAULT_NAMES.map((n) => `<option value="${n}">`).join("");

function renderNames() {
  $("nameList").innerHTML = names.map((n, i) => `<li data-i="${i}">
    <input type="text" class="nm-from" value="${esc(n.from)}" aria-label="Name in the guide" placeholder="In the guide" list="nameSugg" autocomplete="off" autocapitalize="words" spellcheck="false">
    <span class="nm-arrow" aria-hidden="true">→</span>
    <input type="text" class="nm-to" value="${esc(n.to)}" aria-label="Your name for ${esc(n.from || "this character")}" placeholder="Your name" autocomplete="off" autocapitalize="words" spellcheck="false">
    <button type="button" class="mp-x nm-x" aria-label="Remove ${esc(n.from || "this name")}">×</button></li>`).join("");
}

// Saves the names and redraws the walkthrough with them, keeping your place on the page.
function applyNames() {
  saveNames(names.filter((n) => n.from.trim() || n.to.trim()));
  rerender();
}

// Rebuilds what depends on names and colors, and redraws a walkthrough page in the same place.
function rerender() {
  indexTerms();
  buildToc();
  const n = walkRoute();
  if (n !== null) viewWalk(n, { y: window.scrollY });
}

$("nameList").addEventListener("change", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  const n = names[+li.dataset.i];
  n.from = li.querySelector(".nm-from").value.trim();
  n.to = li.querySelector(".nm-to").value.trim();
  applyNames();
});
$("nameList").addEventListener("click", (e) => {
  const b = e.target.closest(".nm-x");
  if (!b) return;
  names.splice(+b.closest("li").dataset.i, 1);
  renderNames();
  applyNames();
});
$("nameAdd").onclick = () => {
  names.push({ from: "", to: "" });
  renderNames();
  $("nameList").lastElementChild.querySelector(".nm-from").focus();
};
renderNames();

/* ---------------- color coding ---------------- */

let tags = loadTags();
const TAG_KINDS = [...KINDS, "none"];
const tagLabel = (k) => k === "none" ? "Not colored" : KIND_LABEL[k];

function renderTags() {
  $("tagList").innerHTML = tags.map((t, i) => `<li data-i="${i}">
    <input type="text" class="tg-text" value="${esc(t.text)}" aria-label="Word" placeholder="Name or word" autocomplete="off" autocapitalize="words" spellcheck="false">
    <select class="tg-kind" aria-label="Color for ${esc(t.text || "this word")}">${TAG_KINDS.map((k) => `<option value="${k}"${k === t.kind ? " selected" : ""}>${tagLabel(k)}</option>`).join("")}</select>
    <button type="button" class="mp-x tg-x" aria-label="Remove ${esc(t.text || "this word")}">×</button></li>`).join("");
}

function renderLegend() {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const k of (state.terms || new Map()).values()) counts[k]++;
  $("tagLegend").innerHTML = KINDS.map((k) => `<span class="ent ent-${k}">${KIND_LABEL[k]}</span>${state.terms ? ` <span class="cnt">${counts[k]}</span>` : ""}`).map((h) => `<span class="lg">${h}</span>`).join("");
}

function applyTags() {
  saveTags(tags.filter((t) => t.text.trim()));
  rerender();
}

$("colorNames").onchange = (e) => { setPrefValue("colorNames", e.target.checked); rerender(); };
$("tagList").addEventListener("change", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  const t = tags[+li.dataset.i];
  t.text = li.querySelector(".tg-text").value.trim();
  t.kind = li.querySelector(".tg-kind").value;
  applyTags();
});
$("tagList").addEventListener("click", (e) => {
  const b = e.target.closest(".tg-x");
  if (!b) return;
  tags.splice(+b.closest("li").dataset.i, 1);
  renderTags();
  applyTags();
});
$("tagAdd").onclick = () => {
  tags.push({ text: "", kind: "party" });
  renderTags();
  $("tagList").lastElementChild.querySelector(".tg-text").focus();
};
renderTags();
renderLegend();

/* ---------------- wake lock ---------------- */

async function updateWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    if (prefs.wake && document.visibilityState === "visible" && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => { state.wakeLock = null; });
    } else if (!prefs.wake && state.wakeLock) {
      await state.wakeLock.release();
      state.wakeLock = null;
    }
  } catch {
    state.wakeLock = null;
  }
}
if (!("wakeLock" in navigator)) $("wakeRow").hidden = true;
$("wake").onchange = (e) => { setPrefValue("wake", e.target.checked); updateWakeLock(); };
document.addEventListener("visibilitychange", updateWakeLock);

/* ---------------- toast ---------------- */

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------------- walkthrough data ---------------- */

// Names to color: monsters and bosses from the monster data, places from the walkthrough, and
// everything with a wiki article.
function indexTerms() {
  const found = { boss: [], enemy: [], ...wikiTerms() };
  for (const m of MONSTERS) found[m.boss ? "boss" : "enemy"].push(m.name);
  for (const c of state.walk ? state.walk.chapters : []) found.place.push(...c.where);
  state.terms = buildTerms(found, names, tags);
  state.matcher = matcher(state.terms);
  state.unrename = new Map(names.filter((n) => n.from.trim() && n.to.trim()).map((n) => [n.to.trim().toLowerCase(), n.from.trim()]));
  state.searchText = null;
  renderLegend();
}

// Colors names in el and links them to their articles (except self, the article on screen).
function decorateNames(el, self = null) {
  if (!el || !prefs.colorNames) return;
  markNames(el, state.matcher, (text, kind) => {
    const href = linkFor(state.unrename.get(text.toLowerCase()) || text, kind);
    return href === self ? null : href;
  });
}

// The furthest chapter you've reached: the last one opened, or the last one marked done.
function reachedChapter() {
  const w = state.walk;
  if (!w) return 0;
  const done = loadWalkDone(), last = getPref("walkLast", "");
  return Math.max(0, ...w.chapters.filter((c) => done.has(c.slug) || c.slug === last).map((c) => c.n));
}

const chapterHref = (c) => "#/walk/" + c.n;

/* ---------------- contents ---------------- */

function buildToc() {
  const w = state.walk;
  const done = loadWalkDone();
  const html = [`<div class="toc-in"><a class="toc-tracker" href="#/walk"><span class="t">Walkthrough</span><span class="cnt" id="walkCnt">${walkLabel()}</span></a><a class="toc-tracker" href="#/party"><span class="t">Party</span><span class="cnt" id="partyCnt">${partyLabel()}</span></a><a class="toc-tracker" href="#/wiki"><span class="t">Wiki</span></a><a class="toc-tracker" href="#/map"><span class="t">World map</span></a><a class="toc-tracker" href="#/monsters"><span class="t">Monster intel</span></a><a class="toc-tracker" href="#/rages"><span class="t">Gau's Rages</span><span class="cnt" id="rageCnt">${rageLabel()}</span></a><a class="toc-tracker" href="#/gear"><span class="t">Inventory</span><span class="cnt" id="gearCnt">${gearLabel()}</span></a>`];
  if (w) {
    const n = w.chapters.filter((c) => done.has(c.slug)).length;
    html.push(`<p class="toc-progress" id="tocProgress">${n ? `${n} of ${w.chapters.length} chapters done` : `${w.chapters.length} chapters`}</p><ol class="toc-list">`);
    // The part you're in starts open: the chapter on screen, or else the next one not done.
    const here = state.chapter || (w.chapters.find((c) => !done.has(c.slug)) || w.chapters[0]).n;
    w.parts.forEach((p, i) => {
      const chs = p.chapters.map((k) => w.chapters[k - 1]);
      const d = chs.filter((c) => done.has(c.slug)).length;
      html.push(`<li><details data-group="${i + 1}"${p.chapters.includes(here) ? " open" : ""}><summary><span class="sum-in"><span class="t">${esc(p.title.replace(/^Part \d+:\s*/, ""))}</span><span class="cnt">${d ? d + "/" : ""}${chs.length}</span></span></summary><ol>`);
      for (const c of chs) html.push(`<li><a class="toc-sub${done.has(c.slug) ? " done" : ""}" href="${chapterHref(c)}" data-key="${c.n}"><span class="n">${c.n}</span><span class="t">${esc(c.title)}</span></a></li>`);
      html.push("</ol></details></li>");
    });
    html.push("</ol>");
  }
  html.push("</div>");
  $("tocContents").innerHTML = renameHtml(html.join(""));
  markTocCurrent();
}

const renameHtml = (html) => { const r = renamer(names); return r ? r.html(html) : html; };

function walkLabel() {
  const n = loadWalkDone().size;
  return n ? `${n} done` : "";
}

function partyLabel() {
  const c = partyCount();
  return c.party ? `${c.party} in party` : "";
}

function gearLabel() {
  const c = gearCounts();
  return c.kinds ? `${c.kinds} kind${c.kinds === 1 ? "" : "s"}` : "";
}

function rageLabel() {
  const c = rageCounts();
  return `${c.have}/${c.total}`;
}

// Highlights the page on screen in the contents: a chapter, or one of the tools.
function markTocCurrent() {
  const toc = $("toc");
  for (const a of toc.querySelectorAll("a[aria-current]")) a.removeAttribute("aria-current");
  const h = walkRoute() === 0 ? "#/walk" : location.hash.replace(/^(#\/(?:monsters|wiki|map))\/.*/, "$1");
  const a = state.chapter
    ? toc.querySelector(`a[data-key="${state.chapter}"]`)
    : [...toc.querySelectorAll(".toc-tracker")].find((t) => t.getAttribute("href") === h);
  if (!a) return;
  a.setAttribute("aria-current", "page");
  const det = a.closest("details");
  if (det) det.open = true;
}

function scrollTocToCurrent() {
  const a = $("toc").querySelector("a[aria-current]");
  if (a) a.scrollIntoView({ block: "center" });
}

const wide = () => matchMedia("(min-width: 1024px)").matches;

function setTocOpen(open) {
  const toc = $("toc");
  if (wide()) {
    const collapsed = !open;
    root.classList.toggle("toc-collapsed", collapsed);
    setPref("tocCollapsed", collapsed);
    toc.hidden = collapsed;
    $("scrim").hidden = true;
  } else {
    toc.hidden = !open;
    $("scrim").hidden = !open;
    document.body.classList.toggle("locked", open);
  }
  $("tocBtn").setAttribute("aria-expanded", String(open));
  if (open) { markTocCurrent(); scrollTocToCurrent(); }
}

function syncTocMode() {
  if (wide()) {
    const collapsed = getPref("tocCollapsed", false);
    root.classList.toggle("toc-collapsed", collapsed);
    $("toc").hidden = collapsed;
    $("scrim").hidden = true;
    document.body.classList.remove("locked");
    $("tocBtn").setAttribute("aria-expanded", String(!collapsed));
  } else {
    $("toc").hidden = true;
    $("scrim").hidden = true;
    $("tocBtn").setAttribute("aria-expanded", "false");
  }
}

$("tocBtn").onclick = () => setTocOpen($("toc").hidden);
$("scrim").onclick = () => setTocOpen(false);
$("toc").addEventListener("click", (e) => { if (e.target.closest("a") && !wide()) setTocOpen(false); });
matchMedia("(min-width: 1024px)").addEventListener("change", syncTocMode);

/* ---------------- views ---------------- */

function setBar(text, href = "#/") {
  $("barTitle").innerHTML = text;
  $("barTitle").setAttribute("href", href);
}

// Every view starts here: nothing selected in the contents, back to the top of the page.
function startView(title, href = "#/") {
  state.chapter = null;
  setBar(title, href);
  markTocCurrent();
}

function viewRages() {
  startView(`<span class="bt">Gau's Rages</span>`);
  renderRages($("view"), {
    onFind: (name) => openSearch(name),
    onChange: () => { const c = $("rageCnt"); if (c) c.textContent = rageLabel(); },
    toast,
  });
  window.scrollTo(0, 0);
}

function viewMonsters(selected) {
  startView(`<span class="bt">Monster intel</span>`);
  renderMonsters($("view"), selected, {
    onFind: (name) => openSearch(name),
    onRage: () => { const c = $("rageCnt"); if (c) c.textContent = rageLabel(); },
    toast,
  });
  if (!selected) window.scrollTo(0, 0);
}
// Shortcuts to the tools (top bar on wide screens, tab bar along the bottom on phones).
function markShortcut() {
  const h = walkRoute() !== null ? "#/walk" : location.hash;
  for (const a of $("shortcuts").querySelectorAll("a.sc")) {
    const on = h === a.getAttribute("href") || h.startsWith(a.getAttribute("href") + "/");
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}
addEventListener("hashchange", markShortcut);
$("shortcuts").addEventListener("click", (e) => {
  if (e.target.closest("a.sc")) { closeSheets(); if (!wide()) setTocOpen(false); }
});
function walkCtx() {
  return {
    rename: renameHtml,
    // Search highlights go first: they can span several names, and names inside them stay plain.
    decorate: (el) => {
      const q = state.pendingQuery;
      state.pendingQuery = "";
      const first = q ? highlight(el, q) : null;
      decorateNames(el);
      if (first) requestAnimationFrame(() => first.scrollIntoView({ block: "center" }));
    },
    mapsFor: (c) => (mapRoute(c, chapterWorld(c)).to ? `<a class="chip" href="#/map/ch/${c.n}">Where this chapter goes</a>` : ""),
    onDone: () => { buildToc(); updateProgressInfo(); },
    askUpto: (c) => askMarkThrough(c),
    toast,
  };
}

// The walkthrough route on screen: 0 for the chapter list, a chapter number, or null.
function walkRoute() {
  const h = location.hash;
  if (!h || h === "#" || h === "#/" || h === "#/walk") return 0;
  const m = h.match(/^#\/walk\/(\d+)$/);
  return m ? +m[1] : null;
}

function viewWalk(n, opts = {}) {
  startView(`<span class="bt">${n ? "Walkthrough" : "FF6 Guide"}</span>`, "#/walk");
  state.chapter = n || null;
  markTocCurrent();
  if (!opts.y) window.scrollTo(0, 0);
  if (n) renderWalkChapter($("view"), n, walkCtx()).then((c) => {
    if (!c) return;
    setBar(renameHtml(`<span class="num">${c.n}</span><span class="bt">${esc(c.title)}</span>`), "#/walk");
    if (opts.y) window.scrollTo(0, opts.y);
    if (wide() && !$("toc").hidden) scrollTocToCurrent();
  });
  else renderWalkIndex($("view"), walkCtx()).then(() => { if (opts.y) window.scrollTo(0, opts.y); });
}

function viewWiki(kind, id) {
  startView(`<span class="bt">Wiki</span>`, "#/wiki");
  const back = state.back && state.walk && state.walk.chapters[state.back.n - 1];
  const e = renderWiki($("view"), kind, id, {
    rename: renameHtml,
    decorate: decorateNames,
    reached: reachedChapter,
    chapters: () => (state.walk ? state.walk.chapters : []),
    back: back ? { n: back.n, title: renamer(names)?.(back.title) || back.title } : null,
  });
  if (e) setBar(renameHtml(`<span class="bt">${esc(e.name)}</span>`), "#/wiki");
  window.scrollTo(0, 0);
}

function viewParty() {
  startView(`<span class="bt">Party</span>`);
  renderParty($("view"), {
    toast,
    onChange: () => {
      const p = $("partyCnt"); if (p) p.textContent = partyLabel();
      const g = $("gearCnt"); if (g) g.textContent = gearLabel();
    },
  });
  window.scrollTo(0, 0);
}

function viewGear() {
  startView(`<span class="bt">Inventory</span>`);
  renderGear($("view"), {
    onFind: (name) => openSearch(name),
    onChange: () => { const c = $("gearCnt"); if (c) c.textContent = gearLabel(); },
    toast,
  });
  window.scrollTo(0, 0);
}

/* ---------------- world map ---------------- */

const chapterWorld = (c) => (/ruin/i.test(c.part) ? "wor" : "wob");
// The wiki places a chapter's @where lines name.
const placesOf = (c) => c.where.map((w) => (linkFor(w, "place") || "").match(/^#\/wiki\/place\/(.+)$/)).filter(Boolean).map((m) => m[1]);
// Where a chapter goes in a world: { chapter, from, to, also }, from being where the last
// chapter (in the same world) ended.
function mapRoute(c, world) {
  const here = [...new Set(placesOf(c).filter((id) => worldsOf(id).includes(world)))];
  let from = null;
  for (let k = c.n - 2; k >= 0 && !from; k--) {
    const p = state.walk.chapters[k];
    if (chapterWorld(p) !== world) break;
    from = placesOf(p).filter((id) => worldsOf(id).includes(world)).pop() || null;
  }
  return { chapter: c, from, to: here[0] || null, also: here.slice(1) };
}
// The chapter the map is about: the one you came from, or else the last one you opened.
const mapChapter = () => state.walk && (state.walk.chapters[(state.back ? state.back.n : 0) - 1] || state.walk.chapters.find((c) => c.slug === getPref("walkLast", "")) || state.walk.chapters[0]);

// arg: "", "ch/<n>", "wob", "wor" or "place/<id>".
function viewWorldMap(arg) {
  startView(`<span class="bt">World map</span>`, "#/map");
  const m = arg.match(/^(ch|place)\/(.+)$/);
  let c = mapChapter();
  if (m && m[1] === "ch") c = state.walk && state.walk.chapters[+m[2] - 1] || c;
  const here = c ? chapterWorld(c) : "wob";
  let world = /^wo[br]$/.test(arg) ? arg : here, focus = null;
  if (m && m[1] === "place") {
    focus = m[2];
    const ws = worldsOf(focus);
    if (ws.length && !ws.includes(world)) world = ws[0];
  }
  const back = state.back && state.walk && state.walk.chapters[state.back.n - 1];
  const r = renamer(names);
  renderWorldMap($("view"), {
    world, focus,
    route: c && !focus && chapterWorld(c) === world ? mapRoute(c, world) : null,
    back: back ? { n: back.n, title: r ? r(back.title) : back.title } : null,
  }, {
    name: (id) => { const n = pinName(id) || getEntry("place", id)?.name || id; return r ? r(n) : n; },
    href: (id) => pinHref(id) || "#/wiki/place/" + id,
  });
  window.scrollTo(0, 0);
}

/* ---------------- bulk mark done ---------------- */

// Chapters from the start through c that aren't marked done yet.
const notDoneThrough = (c) => state.walk.chapters.slice(0, c.n).filter((x) => !loadWalkDone().has(x.slug));
const chLabel = (c) => `${c.n}. ${c.title}`;

const markDialog = $("markDialog");
$("markNo").onclick = () => markDialog.close("no");
$("markYes").onclick = () => markDialog.close("yes");
markDialog.addEventListener("click", (e) => { if (e.target === markDialog) markDialog.close("no"); });

// Asks, then marks every chapter up to and including c as done.
async function askMarkThrough(c) {
  const todo = notDoneThrough(c);
  if (!todo.length) { toast(`Everything up to chapter ${c.n} is already done`); return; }
  $("markTitle").textContent = `Mark ${todo.length} chapter${todo.length === 1 ? "" : "s"} done?`;
  $("markFrom").textContent = renamer(names)?.(chLabel(state.walk.chapters[0])) || chLabel(state.walk.chapters[0]);
  $("markTo").textContent = renamer(names)?.(chLabel(c)) || chLabel(c);
  markDialog.returnValue = "";
  markDialog.showModal();
  $("markNo").focus();
  const yes = await new Promise((resolve) => markDialog.addEventListener("close", () => resolve(markDialog.returnValue === "yes"), { once: true }));
  if (!yes) return;
  const done = loadWalkDone();
  for (const x of todo) done.add(x.slug);
  saveWalkDone(done);
  buildToc();
  updateProgressInfo();
  const n = walkRoute();
  if (n !== null) viewWalk(n, { y: window.scrollY });
  toast(`Marked ${todo.length} chapter${todo.length === 1 ? "" : "s"} done`);
}

$("uptoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const c = state.walk && state.walk.chapters[+$("uptoCh").value - 1];
  if (c) askMarkThrough(c);
});

function updateProgressInfo() {
  const w = state.walk;
  if (!w) { $("progressInfo").textContent = "The walkthrough couldn't be loaded."; return; }
  const n = w.chapters.filter((c) => loadWalkDone().has(c.slug)).length;
  $("progressInfo").textContent = `${n} of ${w.chapters.length} chapters done. To catch up on a new device, mark everything up to the chapter you've reached.`;
  const sel = $("uptoCh"), v = sel.value;
  sel.innerHTML = renameHtml(w.chapters.map((c) => `<option value="${c.n}">${esc(chLabel(c))}</option>`).join(""));
  if (v) sel.value = v;
  $("resetBtn").disabled = !n && !getPref("walkLast", null);
}

/* ---------------- routing ---------------- */

function route() {
  closeSheets();
  const h = location.hash;
  // Leaving a chapter for an article or a monster card: remember where you were, so coming
  // back to the chapter puts you there again.
  const from = state.chapter ? { n: state.chapter, y: window.scrollY } : null;
  const peek = /^#\/(?:wiki|monsters|map)(?:\/|$)/.test(h);
  state.back = peek ? from || state.back : walkRoute() ? state.back : null;
  const mm = h.match(/^#\/map(?:\/(.+))?$/);
  if (mm) return viewWorldMap(decodeURIComponent(mm[1] || ""));
  if (h === "#/rages") return viewRages();
  if (h === "#/gear") return viewGear();
  if (h === "#/party") return viewParty();
  const wk = h.match(/^#\/wiki(?:\/([a-z]+)\/(.+))?$/);
  if (wk) return viewWiki(wk[1], wk[2] && decodeURIComponent(wk[2]));
  const mn = h.match(/^#\/monsters(?:\/(.+))?$/);
  if (mn) return viewMonsters(mn[1] ? findMonster(decodeURIComponent(mn[1])) : null);
  const n = walkRoute();
  if (n === null) { history.replaceState(null, "", "#/"); return viewWalk(0); }
  const back = state.back;
  state.back = null;
  viewWalk(n, back && back.n === n ? { y: back.y } : {});
}
addEventListener("hashchange", route);

/* ---------------- backup ---------------- */

async function shareOrDownload(file) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (ex) {
    if (ex && ex.name === "AbortError") return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$("backupBtn").onclick = async () => {
  try {
    await shareOrDownload(await makeBackup(VERSION));
  } catch (ex) {
    console.error(ex);
    toast("The backup couldn't be made.");
  }
};
$("restoreBtn").onclick = () => $("backupFile").click();
$("backupFile").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (f) startRestore(f, toast);
});

// Whether this browser holds anything a restore would replace.
const hasData = () => ["names", "tags", "rages", "gear", "party", "walkDone", "walkLast"].some((k) => getPref(k, null) !== null);

// Reads a backup and, after asking if it would replace anything, restores it and restarts.
async function startRestore(file, onError, onRestored = () => {}) {
  let b;
  try {
    b = await readBackup(file);
  } catch (ex) {
    const msg = String(ex && ex.message || ex);
    if (msg !== "notbackup") console.error(ex);
    onError(msg === "notbackup"
      ? "That .zip isn't a backup from this app."
      : msg.startsWith("That ") ? msg : `That backup couldn't be read (${msg}).`);
    return;
  }
  $("restoreWhat").textContent = describeBackup(b);
  $("restoreWhen").textContent = b.createdAt ? new Date(b.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "an unknown date";
  if (hasData()) {
    closeSheets();
    restoreDialog.returnValue = "";
    restoreDialog.showModal();
    $("restoreNo").focus();
    if (await new Promise((resolve) => restoreDialog.addEventListener("close", () => resolve(restoreDialog.returnValue === "yes"), { once: true })) === false) return;
  }
  try {
    await restoreBackup(b);
  } catch (ex) {
    console.error(ex);
    onError("The backup couldn't be restored. Try again.");
    return;
  }
  onRestored();
  history.replaceState(null, "", location.pathname);
  location.reload();
}

const restoreDialog = $("restoreDialog");
$("restoreNo").onclick = () => restoreDialog.close("no");
$("restoreYes").onclick = () => restoreDialog.close("yes");
restoreDialog.addEventListener("click", (e) => { if (e.target === restoreDialog) restoreDialog.close("no"); });

/* ---------------- search ---------------- */

// Searches the walkthrough (with your character names) and monster names.
function buildSearch() {
  if (!state.searchText) {
    const r = renamer(names);
    state.searchText = (state.walk ? state.walk.chapters : []).map((c) => { const t = chapterText(c); return r ? r(t) : t; });
  }
  return state.searchText;
}

function snippet(text, idx, len) {
  const start = Math.max(0, idx - 50);
  const end = Math.min(text.length, idx + len + 70);
  const raw = text.slice(start, end).replace(/\s+/g, " ");
  const q = text.slice(idx, idx + len).replace(/\s+/g, " ");
  const at = raw.toLowerCase().indexOf(q.toLowerCase());
  const pre = (start > 0 ? "…" : "") + raw.slice(0, at);
  const post = raw.slice(at + q.length) + (end < text.length ? "…" : "");
  return esc(pre) + "<mark>" + esc(raw.slice(at, at + q.length)) + "</mark>" + esc(post);
}

let searchTimer = null;
function runSearch() {
  const q = $("q").value.trim();
  const list = $("results");
  if (q.length < 2) { list.innerHTML = ""; $("searchCount").textContent = q ? "Type at least two letters." : ""; return; }
  const ql = q.toLowerCase();
  const texts = buildSearch();
  const chs = state.walk ? state.walk.chapters : [];
  const hits = [];
  let total = 0;
  // A chapter number ("12" or "chapter 12") jumps straight to that chapter.
  const num = q.match(/^(?:ch(?:apter)?\.?\s*)?(\d{1,2})$/i);
  const numHit = num && chs[+num[1] - 1];
  for (let i = 0; i < texts.length; i++) {
    const tl = texts[i].toLowerCase();
    let idx = tl.indexOf(ql), n = 0, first = idx;
    while (idx !== -1) { n++; idx = tl.indexOf(ql, idx + ql.length); }
    if (n) { hits.push({ c: chs[i], n, first, i }); total += n; }
  }
  hits.sort((a, b) => (b.c.title.toLowerCase().includes(ql) - a.c.title.toLowerCase().includes(ql)) || a.i - b.i);
  const mons = MONSTERS.filter((m) => m.name.toLowerCase().includes(ql) || (m.alt || "").toLowerCase().includes(ql))
    .sort((a, b) => (b.name.toLowerCase().startsWith(ql) - a.name.toLowerCase().startsWith(ql)) || a.name.localeCompare(b.name));
  const seen = new Set();
  const monHits = mons.filter((m) => !seen.has(m.name) && seen.add(m.name)).slice(0, 6);
  const wikiHits = searchWiki(ql, renamer(names));
  const parts = [];
  if (hits.length) parts.push(`${total} match${total === 1 ? "" : "es"} in ${hits.length} chapter${hits.length === 1 ? "" : "s"}`);
  if (wikiHits.length) parts.push(`${wikiHits.length} wiki article${wikiHits.length === 1 ? "" : "s"}`);
  if (monHits.length) parts.push(`${seen.size} monster${seen.size === 1 ? "" : "s"}`);
  $("searchCount").textContent = parts.join(" · ") || "No matches.";
  const label = (c) => renameHtml(`<span class="num">${c.n}</span>${esc(c.title)}`);
  list.innerHTML = (numHit ? `<li><a href="${chapterHref(numHit)}" data-q=""><span class="r-h">${label(numHit)}</span><span class="r-s">Go to chapter</span></a></li>` : "") +
    renameHtml(wikiHits.slice(0, 6).map((e) => `<li><a href="${e.href}" data-q=""><span class="r-h"><span class="ent ent-${e.color}">${esc(e.name)}</span></span><span class="r-s">Wiki · ${esc(e.label)}${e.sum ? " · " + esc(e.sum) : ""}</span></a></li>`).join("")) +
    monHits.map((m) => `<li><a href="#/monsters/${encodeURIComponent(m.name)}" data-q=""><span class="r-h"><span class="ent ent-${m.boss ? "boss" : "enemy"}">${esc(m.name)}</span></span><span class="r-s">Monster intel${m.boss ? " · boss" : ""}${m.alt && m.alt !== m.name ? ` · was ${esc(m.alt)}` : ""}</span></a></li>`).join("") +
    hits.slice(0, 100).map((h) => `<li><a href="${chapterHref(h.c)}" data-q="${esc(q)}"><span class="r-h">${label(h.c)}${h.n > 1 ? `<span class="cnt">${h.n}</span>` : ""}</span><span class="r-s">${snippet(texts[h.i], h.first, q.length)}</span></a></li>`).join("");
}
// Colored names in a page: a summary on hover (or first tap), and the article on click.
bindPeek($("view"), { el: $("peek"), rename: renameHtml });
// A chapter listed in a wiki article opens with the name highlighted.
$("view").addEventListener("click", (e) => {
  const a = e.target.closest(".wk-refs a[data-q]");
  if (a) state.pendingQuery = renamer(names)?.(a.dataset.q) || a.dataset.q;
});
$("q").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 160); setPref("lastQuery", $("q").value); });
$("results").addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;
  state.pendingQuery = a.dataset.q || "";
  if (a.getAttribute("href") === location.hash) { e.preventDefault(); closeSheets(); route(); }
});

function highlight(container, q) {
  if (!container || !q) return null;
  const ql = q.toLowerCase();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let first = null;
  for (const node of nodes) {
    const t = node.nodeValue;
    const tl = t.toLowerCase();
    let idx = tl.indexOf(ql);
    if (idx === -1) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    while (idx !== -1) {
      frag.appendChild(document.createTextNode(t.slice(pos, idx)));
      const m = document.createElement("mark");
      m.className = "hit";
      m.textContent = t.slice(idx, idx + q.length);
      frag.appendChild(m);
      if (!first) first = m;
      pos = idx + q.length;
      idx = tl.indexOf(ql, pos);
    }
    frag.appendChild(document.createTextNode(t.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }
  return first;
}

/* ---------------- sheets ---------------- */

function openSheet(id) {
  closeSheets();
  $(id).hidden = false;
  document.body.classList.add("locked");
}
function closeSheets() {
  for (const id of ["searchSheet", "settingsSheet"]) $(id).hidden = true;
  if ($("scrim").hidden) document.body.classList.remove("locked");
}
for (const b of document.querySelectorAll("[data-close]")) b.onclick = closeSheets;
for (const id of ["searchSheet", "settingsSheet"]) $(id).addEventListener("click", (e) => { if (e.target.id === id) closeSheets(); });
// Escape closes a dialog first (the browser does that), and only then the sheet or drawer under it.
addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) { closeSheets(); if (!wide()) setTocOpen(false); } });

// Opens search, with a query to run or the last one used.
function openSearch(query) {
  openSheet("searchSheet");
  const q = $("q");
  if (query) { q.value = query; setPref("lastQuery", query); }
  else if (!q.value) q.value = getPref("lastQuery", "");
  runSearch();
  q.focus();
  q.select();
}
$("searchBtn").onclick = () => openSearch();
$("settingsBtn").onclick = () => { updateSettingsInfo(); openSheet("settingsSheet"); };

function updateSettingsInfo() {
  updateProgressInfo();
}

/* ---------------- reset ---------------- */

const resetDialog = $("resetDialog");
$("resetBtn").addEventListener("click", () => {
  resetDialog.showModal();
  $("resetNo").focus(); // "No" is the default choice
});
$("resetNo").onclick = () => resetDialog.close("no");
resetDialog.addEventListener("click", (e) => { if (e.target === resetDialog) resetDialog.close("no"); });
$("resetYes").onclick = () => {
  resetDialog.close("yes");
  for (const k of ["walkDone", "walkLast"]) setPref(k, null);
  buildToc();
  updateSettingsInfo();
  const n = walkRoute();
  if (n !== null) viewWalk(n, { y: window.scrollY });
  toast("Walkthrough progress reset");
};

$("appVersion").textContent = `Version ${VERSION}. Your progress is stored only in this browser.`;

/* ---------------- Google Drive sync ---------------- */

const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const cloudDialog = $("cloudDialog");
$("cloudNo").onclick = () => cloudDialog.close("no");
$("cloudYes").onclick = () => cloudDialog.close("yes");
cloudDialog.addEventListener("click", (e) => { if (e.target === cloudDialog) cloudDialog.close("no"); });
$("gdRedirect").textContent = cloud.redirectUri();
$("gdClient").value = cloud.clientId();
$("gdClient").addEventListener("change", (e) => { cloud.setClientId(e.target.value); updateCloudStatus(); updateAutoStatus(); });

function updateCloudStatus(text) {
  const last = cloud.lastSync();
  $("gdStatus").textContent = text || (!cloud.clientId()
    ? "Keep one backup in your Google Drive and sync it between browsers. Set it up below first."
    : last ? `This browser last synced with Google Drive on ${when(last.modifiedTime)}.` : "Keep one backup in your Google Drive and sync it between browsers.");
  $("gdSetup").open = !cloud.clientId();
}

/* Auto-save: after an edit, wait for 30 seconds without edits, then upload, but never let changes
   wait more than 5 minutes, and save right away when the app goes to the background. Sign-in
   lasts about an hour and can't be renewed without leaving the page, so when it runs out
   auto-save pauses until you tap Save to Google Drive. It also stops rather than overwrite a
   copy saved from another browser. "gdriveDirty" remembers unsaved changes across restarts. */
const AUTO_IDLE = 30000, AUTO_MAX = 300000;
const auto = { timer: 0, since: 0, edits: 0, busy: false, state: "" }; // state: "", "paused", "blocked", "error"
const autoOn = () => getPref("gdriveAuto", false) && !!cloud.clientId();
const isDirty = () => getPref("gdriveDirty", false);

function updateAutoStatus(text) {
  const on = autoOn();
  $("gdAuto").checked = getPref("gdriveAuto", false);
  $("gdAuto").disabled = !cloud.clientId();
  const last = cloud.lastSync();
  const msg = text || (!cloud.clientId() ? "Set up Google Drive below to use auto-save."
    : !on ? "Off. Changes are saved on this device; tap Save to Google Drive to copy them there."
    : auto.state === "blocked" ? "Stopped: Google Drive has a newer copy saved from another browser. Use Save or Restore above to choose which to keep."
    : auto.state === "paused" || (isDirty() && !cloud.signedIn()) ? "Paused until you sign in: tap Save to Google Drive to save your changes and resume. (Google sign-in lasts about an hour.)"
    : auto.state === "error" ? "Couldn't reach Google Drive. Trying again in a minute."
    : isDirty() ? "Waiting to save your latest changes…"
    : cloud.signedIn() ? `On.${last ? ` Last saved ${when(last.modifiedTime)}.` : ""}`
    : "On. Tap Save to Google Drive once to sign in and start.");
  $("gdAutoStatus").textContent = msg;
  // A dot on the menu button when changes are waiting and auto-save can't send them.
  $("settingsBtn").classList.toggle("has-dot", on && isDirty() && (auto.state === "blocked" || !cloud.signedIn()));
}

function scheduleAuto(delay) {
  clearTimeout(auto.timer);
  if (!autoOn() || !isDirty()) return;
  if (!auto.since) auto.since = Date.now();
  const wait = delay ?? Math.min(AUTO_IDLE, auto.since + AUTO_MAX - Date.now());
  auto.timer = setTimeout(autoSave, Math.max(0, wait));
}

async function autoSave() {
  clearTimeout(auto.timer);
  if (!autoOn() || !isDirty() || auto.busy || auto.state === "blocked") return updateAutoStatus();
  if (!cloud.signedIn()) { auto.state = "paused"; return updateAutoStatus(); }
  auto.busy = true;
  const edits = auto.edits;
  try {
    const existing = await cloud.findFile();
    const last = cloud.lastSync();
    if (existing && (!last || existing.modifiedTime !== last.modifiedTime)) {
      auto.state = "blocked";
      toast("Auto-save stopped: Google Drive has a newer copy. See Settings.");
      return;
    }
    cloud.markSynced(await cloud.upload(await makeBackup(VERSION), existing && existing.id));
    auto.state = "";
    if (auto.edits === edits) { setPref("gdriveDirty", null); auto.since = 0; }
  } catch (ex) {
    console.error(ex);
    auto.state = String(ex && ex.message) === "signin" ? "paused" : "error";
    if (auto.state === "error") scheduleAuto(60000);
  } finally {
    auto.busy = false;
    updateAutoStatus();
    if (isDirty() && !auto.state) scheduleAuto();
  }
}

// A manual save or a restore from Drive leaves nothing to auto-save.
function autoSynced() {
  clearTimeout(auto.timer);
  setPref("gdriveDirty", null);
  auto.since = 0;
  auto.state = "";
  updateAutoStatus();
}

onPrefChange((key) => {
  if (!DATA_KEYS.includes(key)) return;
  auto.edits++;
  if (!isDirty()) setPref("gdriveDirty", true);
  if (auto.state === "paused" && cloud.signedIn()) auto.state = "";
  scheduleAuto();
  updateAutoStatus();
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && isDirty()) autoSave(); });
$("gdAuto").addEventListener("change", (e) => {
  setPref("gdriveAuto", e.target.checked || null);
  auto.state = "";
  if (e.target.checked) setPref("gdriveDirty", true); // save what's here now
  scheduleAuto(0);
  updateAutoStatus();
});

updateCloudStatus();
updateAutoStatus();
scheduleAuto(); // changes left unsaved last time

function cloudError(ex) {
  console.error(ex);
  const msg = String(ex && ex.message || ex);
  if (msg === "noclient") { openSheet("settingsSheet"); $("gdSetup").open = true; $("gdClient").focus(); toast("Add your Google OAuth client ID first."); return; }
  updateCloudStatus();
  toast(/fetch|network/i.test(msg) ? "Couldn't reach Google Drive. Check your connection." : msg);
}

async function cloudSave() {
  try {
    await cloud.withDrive("save", async () => {
      updateCloudStatus("Checking Google Drive…");
      const existing = await cloud.findFile();
      const last = cloud.lastSync();
      if (existing && (!last || existing.modifiedTime !== last.modifiedTime)) {
        $("cloudFrom").textContent = (existing.appProperties && existing.appProperties.device) || "another browser";
        $("cloudWhen").textContent = when(existing.modifiedTime);
        cloudDialog.returnValue = "";
        cloudDialog.showModal();
        const yes = await new Promise((resolve) => cloudDialog.addEventListener("close", () => resolve(cloudDialog.returnValue === "yes"), { once: true }));
        if (!yes) { updateCloudStatus(); return; }
      }
      updateCloudStatus("Saving to Google Drive…");
      const meta = await cloud.upload(await makeBackup(VERSION), existing && existing.id);
      cloud.markSynced(meta);
      autoSynced();
      updateCloudStatus();
      toast("Saved to Google Drive");
    });
  } catch (ex) { cloudError(ex); }
}

async function cloudRestore() {
  try {
    await cloud.withDrive("restore", async () => {
      updateCloudStatus("Checking Google Drive…");
      const f = await cloud.findFile();
      if (!f) { updateCloudStatus(); toast("There's no copy in Google Drive yet. Save one from a browser that has your data."); return; }
      updateCloudStatus("Downloading from Google Drive…");
      const file = await cloud.download(f.id);
      updateCloudStatus();
      await startRestore(file, toast, () => { cloud.markSynced(f); autoSynced(); });
    });
  } catch (ex) { cloudError(ex); }
}
$("gdSave").onclick = () => cloudSave();
$("gdRestore").onclick = () => cloudRestore();

/* ---------------- start ---------------- */

async function start() {
  const signedIn = cloud.finishSignIn(); // back from Google sign-in?
  applyPrefs();
  updateWakeLock();
  document.body.classList.add("has-tabs");
  $("view").innerHTML = `<p class="loading">Opening the walkthrough…</p>`;
  // Versions before 0.20.0 read an imported copy of Djibriel's guide. Remove it and its
  // progress; backups made back then still hold the guide.
  removeGuide().catch(() => {});
  // Versions before 0.22.0 kept map images and links you added; the drawn world map replaced them.
  removeMaps().catch(() => {});
  setPref("panelTab", null);
  for (const k of ["done", "last", "pos", "savedText"]) setPref(k, null);
  try {
    state.walk = await loadWalkthrough();
  } catch (ex) {
    console.error(ex);
  }
  indexTerms();
  buildToc();
  // Opening the app picks up at the last chapter read.
  const last = state.walk && state.walk.chapters.find((c) => c.slug === getPref("walkLast", ""));
  if (last && (!location.hash || location.hash === "#" || location.hash === "#/")) history.replaceState(null, "", chapterHref(last));
  syncTocMode();
  route();
  markShortcut();
  if (signedIn && signedIn.error) toast(signedIn.error);
  else if (signedIn && signedIn.action === "save") cloudSave();
  else if (signedIn && signedIn.action === "restore") cloudRestore();
}
start();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
