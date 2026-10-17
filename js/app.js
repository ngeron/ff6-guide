import { esc } from "./render.js";
import { removeGuide, askPersist, getPref, setPref } from "./store.js";
import { makeBackup, readBackup, describeBackup, restoreBackup } from "./backup.js";
import { renderRages, rageCounts } from "./rages.js";
import { renderGear, gearCounts } from "./gear.js";
import { renderMonsters, findMonster } from "./monsters.js";
import { MONSTERS } from "./monsters-data.js";
import { renderParty, partyCount } from "./party.js";
import * as cloud from "./cloud.js";
import { KINDS, KIND_LABEL, loadTags, saveTags, buildTerms, matcher, markNames } from "./tags.js";
import { DEFAULT_NAMES, loadNames, saveNames, renamer } from "./names.js";
import { loadWalkthrough, renderWalkIndex, renderWalkChapter, chapterText, chapterOf, loadDone as loadWalkDone, saveDone as saveWalkDone } from "./walkthrough.js";
import { initMaps, loadMaps, getMap, hasMaps, mapCounts, exportPack, removeAllMaps, itemsForChapter, importFiles as importMapFiles, renderPanel as renderMapsPanel, bindPanel as bindMapsPanel, renderViewer as renderMapViewer } from "./maps.js";

const VERSION = "0.20.0";
const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const state = {
  walk: null,       // the walkthrough: { parts, chapters } (walkthrough.js)
  chapter: null,    // number of the chapter on screen
  currentMap: null,
  terms: null,      // color coding: Map(term -> kind)
  matcher: null,
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

// Names to color: monsters and bosses from the monster data, places from the walkthrough.
function indexTerms() {
  const found = { boss: [], enemy: [], place: [] };
  for (const m of MONSTERS) found[m.boss ? "boss" : "enemy"].push(m.name);
  for (const c of state.walk ? state.walk.chapters : []) found.place.push(...c.where);
  state.terms = buildTerms(found, names, tags);
  state.matcher = matcher(state.terms);
  state.searchText = null;
  renderLegend();
}

const chapterHref = (c) => "#/walk/" + c.n;
const chapterFor = (rec) => chapterOf(state.walk, rec);

/* ---------------- contents ---------------- */

function buildToc() {
  const w = state.walk;
  const done = loadWalkDone();
  const html = [`<div class="toc-in"><a class="toc-tracker" href="#/walk"><span class="t">Walkthrough</span><span class="cnt" id="walkCnt">${walkLabel()}</span></a><a class="toc-tracker" href="#/party"><span class="t">Party</span><span class="cnt" id="partyCnt">${partyLabel()}</span></a><a class="toc-tracker" href="#/monsters"><span class="t">Monster intel</span></a><a class="toc-tracker" href="#/rages"><span class="t">Gau's Rages</span><span class="cnt" id="rageCnt">${rageLabel()}</span></a><a class="toc-tracker" href="#/gear"><span class="t">Inventory</span><span class="cnt" id="gearCnt">${gearLabel()}</span></a>`];
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
  const h = walkRoute() === 0 ? "#/walk" : location.hash.replace(/^(#\/monsters)\/.*/, "$1");
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
$("mapsBtn").onclick = () => {
  closeSheets();
  const showing = !$("toc").hidden && !$("tocMaps").hidden;
  setPanelTab("maps");
  setTocOpen(!(showing && !wide()) || wide());
};

const chips = (items) => items.map((it) => it.kind === "map"
  ? `<a class="chip" href="${it.href}">${esc(it.title)}</a>`
  : `<a class="chip ext" href="${esc(it.href)}" target="_blank" rel="noopener noreferrer">${esc(it.title)} ↗</a>`).join("");

function walkCtx() {
  return {
    rename: renameHtml,
    // Search highlights go first: they can span several names, and names inside them stay plain.
    decorate: (el) => {
      const q = state.pendingQuery;
      state.pendingQuery = "";
      const first = q ? highlight(el, q) : null;
      if (prefs.colorNames) markNames(el, state.matcher);
      if (first) requestAnimationFrame(() => first.scrollIntoView({ block: "center" }));
    },
    mapsFor: (c) => chips(itemsForChapter(c.n)),
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

function viewMap(m) {
  startView(`<span class="bt">${esc(m.title)}</span>`);
  state.currentMap = m.id;
  renderMapViewer($("view"), m);
  setPanelTab("maps");
  refreshMapsPanel();
  window.scrollTo(0, 0);
}

/* ---------------- panel tabs and maps ---------------- */

function setPanelTab(tab) {
  const maps = tab === "maps";
  $("tabContents").setAttribute("aria-selected", String(!maps));
  $("tabMaps").setAttribute("aria-selected", String(maps));
  $("tocContents").hidden = maps;
  $("tocMaps").hidden = !maps;
  setPref("panelTab", tab);
}
$("tabContents").onclick = () => { setPanelTab("contents"); markTocCurrent(); scrollTocToCurrent(); };
$("tabMaps").onclick = () => setPanelTab("maps");

function refreshMapsPanel() {
  const panel = $("tocMaps");
  const scroll = $("toc").scrollTop;
  const open = panel.querySelector(".mp-form")?.open;
  renderMapsPanel(panel, state.currentMap);
  if (open !== undefined) panel.querySelector(".mp-form").open = open;
  $("toc").scrollTop = scroll;
}

initMaps({
  toast: (m) => toast(m),
  chapterOf: chapterFor,
  chapterOptions: (slug) => (state.walk ? state.walk.chapters : []).map((c) => `<option value="${esc(c.slug)}"${c.slug === slug ? " selected" : ""}>${c.n}. ${esc(c.title)}</option>`).join(""),
  onChange: () => {
    refreshMapsPanel();
    // Update the map chips on the chapter on screen.
    if (state.chapter && state.walk) {
      const box = $("view").querySelector(".sec-maps");
      const html = chips(itemsForChapter(state.chapter));
      if (box) box.outerHTML = html ? `<div class="sec-maps"><span class="eyebrow">Maps</span>${html}</div>` : "";
      else if (html) $("view").querySelector(".sec-h")?.insertAdjacentHTML("afterend", `<div class="sec-maps"><span class="eyebrow">Maps</span>${html}</div>`);
    }
  },
});
bindMapsPanel($("tocMaps"), () => $("mapFile").click());

$("mapFile").addEventListener("change", async (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = "";
  if (!files.length) return;
  toast("Adding maps…");
  try {
    const r = await importMapFiles(files, (msg) => toast(msg));
    const parts = [];
    if (r.added) parts.push(`${r.added} map${r.added === 1 ? "" : "s"}`);
    if (r.linksAdded) parts.push(`${r.linksAdded} link${r.linksAdded === 1 ? "" : "s"}`);
    const msg = parts.length ? `Added ${parts.join(" and ")}` : "Nothing new was added";
    toast(r.problems.length ? `${msg}. ${r.problems[0]}.` : msg);
    setPanelTab("maps");
    askPersist();
  } catch (ex) {
    console.error(ex);
    toast(ex && ex.message ? ex.message : "Those files couldn't be added.");
  }
});

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
  state.currentMap = null;
  const mm = h.match(/^#\/map\/(.+)$/);
  if (mm) {
    const map = getMap(decodeURIComponent(mm[1]));
    if (map) return viewMap(map);
  }
  if (h === "#/rages") return viewRages();
  if (h === "#/gear") return viewGear();
  if (h === "#/party") return viewParty();
  const mn = h.match(/^#\/monsters(?:\/(.+))?$/);
  if (mn) return viewMonsters(mn[1] ? findMonster(decodeURIComponent(mn[1])) : null);
  const n = walkRoute();
  if (n === null) { history.replaceState(null, "", "#/"); return viewWalk(0); }
  viewWalk(n);
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
const hasData = () => hasMaps() || ["names", "tags", "rages", "gear", "party", "walkDone", "walkLast"].some((k) => getPref(k, null) !== null);

// Reads a backup and, after asking if it would replace anything, restores it and restarts.
async function startRestore(file, onError, onRestored = () => {}) {
  let b;
  try {
    b = await readBackup(file);
  } catch (ex) {
    const msg = String(ex && ex.message || ex);
    if (msg !== "notbackup") console.error(ex);
    onError(msg === "notbackup"
      ? "That .zip isn't a backup from this app. To add a map pack, use the Maps tab."
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
  const parts = [];
  if (hits.length) parts.push(`${total} match${total === 1 ? "" : "es"} in ${hits.length} chapter${hits.length === 1 ? "" : "s"}`);
  if (monHits.length) parts.push(`${seen.size} monster${seen.size === 1 ? "" : "s"}`);
  $("searchCount").textContent = parts.join(" · ") || "No matches.";
  const label = (c) => renameHtml(`<span class="num">${c.n}</span>${esc(c.title)}`);
  list.innerHTML = (numHit ? `<li><a href="${chapterHref(numHit)}" data-q=""><span class="r-h">${label(numHit)}</span><span class="r-s">Go to chapter</span></a></li>` : "") +
    monHits.map((m) => `<li><a href="#/monsters/${encodeURIComponent(m.name)}" data-q=""><span class="r-h"><span class="ent ent-${m.boss ? "boss" : "enemy"}">${esc(m.name)}</span></span><span class="r-s">Monster intel${m.boss ? " · boss" : ""}${m.alt && m.alt !== m.name ? ` · was ${esc(m.alt)}` : ""}</span></a></li>`).join("") +
    hits.slice(0, 100).map((h) => `<li><a href="${chapterHref(h.c)}" data-q="${esc(q)}"><span class="r-h">${label(h.c)}${h.n > 1 ? `<span class="cnt">${h.n}</span>` : ""}</span><span class="r-s">${snippet(texts[h.i], h.first, q.length)}</span></a></li>`).join("");
}
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
  $("mapClearConfirm").hidden = true;
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
  const mc = mapCounts();
  $("mapInfo").textContent = hasMaps()
    ? `${mc.maps} map${mc.maps === 1 ? "" : "s"} and ${mc.links} link${mc.links === 1 ? "" : "s"} on this device. A map pack (.zip) holds just your maps, to share or add on another device.`
    : "No maps on this device yet. Add them from the Maps tab in the side panel.";
  for (const id of ["mapExportBtn", "mapClearBtn"]) $(id).disabled = !hasMaps();
}
$("mapExportBtn").onclick = () => exportPack();
$("mapClearBtn").onclick = () => { $("mapClearConfirm").hidden = false; $("mapClearNo").focus(); };
$("mapClearNo").onclick = () => { $("mapClearConfirm").hidden = true; };
$("mapClearYes").onclick = async () => {
  await removeAllMaps();
  $("mapClearConfirm").hidden = true;
  updateSettingsInfo();
  toast("Maps and links removed");
};

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
$("gdClient").addEventListener("change", (e) => { cloud.setClientId(e.target.value); updateCloudStatus(); });

function updateCloudStatus(text) {
  const last = cloud.lastSync();
  $("gdStatus").textContent = text || (!cloud.clientId()
    ? "Keep one backup in your Google Drive and sync it between browsers. Set it up below first."
    : last ? `This browser last synced with Google Drive on ${when(last.modifiedTime)}.` : "Keep one backup in your Google Drive and sync it between browsers.");
  $("gdSetup").open = !cloud.clientId();
}
updateCloudStatus();

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
      await startRestore(file, toast, () => cloud.markSynced(f));
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
  await loadMaps();
  refreshMapsPanel();
  setPanelTab(getPref("panelTab", "contents"));
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
