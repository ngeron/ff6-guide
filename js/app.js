import { parseGuide, sectionText, detectKind, readText, importDocument, parseText, extFor, ACCEPT } from "./importers/index.js";
import { renderBlocks, renderHeading, esc, inline } from "./render.js";
import { loadGuide, saveGuide, removeGuide, askPersist, getPref, setPref } from "./store.js";
import { makeBackup, readBackup, describeBackup, restoreBackup } from "./backup.js";
import { KINDS, KIND_LABEL, loadTags, saveTags, buildTerms, matcher, markNames } from "./tags.js";
import { DEFAULT_NAMES, loadNames, saveNames, renameDoc } from "./names.js";
import { initMaps, loadMaps, getMap, hasMaps, itemsForSection, importFiles as importMapFiles, renderPanel as renderMapsPanel, bindPanel as bindMapsPanel, renderViewer as renderMapViewer } from "./maps.js";

const VERSION = "0.7.0";
const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const state = {
  guide: null,      // { text, name, importedAt, source }
  base: null,       // parsed document, as imported
  doc: null,        // parsed document with your character names applied
  byKey: new Map(), // route key -> section
  byNum: new Map(), // section number -> section
  order: [],        // sections in reading order
  current: null,
  pendingQuery: "",
  searchText: null,
  done: new Set(getPref("done", [])),
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

// Saves the names and re-renders the guide with them, keeping your place on the page.
function applyNames() {
  saveNames(names.filter((n) => n.from.trim() || n.to.trim()));
  rerender();
}

// Rebuilds the guide from its source and shows the current page again in the same place.
function rerender() {
  if (!state.base) return;
  const y = window.scrollY;
  indexDoc();
  if (state.current) {
    const s = state.byKey.get(state.current.key);
    if (s) { viewSection(s); window.scrollTo(0, y); }
  } else if (state.doc && !state.currentMap && /^#\/?$|^$/.test(location.hash)) viewHome();
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

/* ---------------- guide loading ---------------- */

function useGuide(guide) {
  state.guide = guide;
  state.base = parseGuide(guide);
  indexDoc();
  updateGuideInfo();
}

// Applies character names to the parsed guide and rebuilds everything that shows its text.
function indexDoc() {
  state.doc = renameDoc(state.base, names);
  state.terms = buildTerms(state.doc, names, tags);
  state.matcher = matcher(state.terms);
  renderLegend();
  state.byKey.clear();
  state.byNum.clear();
  state.order = state.doc.sections;
  for (const s of state.order) {
    state.byKey.set(s.key, s);
    if (s.num && !state.byNum.has(s.num)) state.byNum.set(s.num, s);
  }
  state.searchText = null;
  document.title = shortTitle();
  buildToc();
  $("secNums").innerHTML = state.order.filter((s) => s.num).map((s) => `<option value="${esc(s.num)}">${esc(s.title)}</option>`).join("");
}

function shortTitle() {
  return "FF6 Guide";
}

const hrefFor = (s) => "#/s/" + encodeURIComponent(s.key);
const linkNum = (num) => { const s = state.byNum.get(num); return s ? hrefFor(s) : null; };
const linkAnchor = (id) => { const key = state.doc && state.doc.anchors && state.doc.anchors[id]; const s = key && state.byKey.get(key); return s ? hrefFor(s) : null; };

/* ---------------- contents ---------------- */

function groups() {
  // Chapters (level 1/2) with their subsections.
  const out = [];
  for (const s of state.order) {
    if (s.level <= 2 || !out.length) out.push({ head: s, items: [] });
    else out[out.length - 1].items.push(s);
  }
  return out;
}

function tocLabel(s) {
  if (s.level === 1) return "Title page";
  return s.title;
}

function buildToc() {
  const html = [`<div class="toc-in"><p class="toc-progress" id="tocProgress"></p><ol class="toc-list">`];
  for (const g of groups()) {
    const h = g.head;
    const doneH = state.done.has(h.key) ? " done" : "";
    if (!g.items.length) {
      html.push(`<li><a class="toc-ch${doneH}" href="${hrefFor(h)}" data-key="${esc(h.key)}">${h.num ? `<span class="n">${esc(h.num)}</span>` : ""}<span class="t">${esc(tocLabel(h))}</span></a></li>`);
      continue;
    }
    const doneCount = g.items.filter((s) => state.done.has(s.key)).length;
    html.push(`<li><details data-group="${esc(h.key)}"><summary><span class="sum-in"><span class="n">${esc(h.num)}</span><span class="t">${esc(tocLabel(h))}</span><span class="cnt">${doneCount ? doneCount + "/" : ""}${g.items.length}</span></span></summary><ol>`);
    html.push(`<li><a class="toc-sub intro${doneH}" href="${hrefFor(h)}" data-key="${esc(h.key)}"><span class="t">Introduction</span></a></li>`);
    for (const s of g.items) {
      html.push(`<li><a class="toc-sub${state.done.has(s.key) ? " done" : ""}" href="${hrefFor(s)}" data-key="${esc(s.key)}"><span class="n">${esc(s.num)}</span><span class="t">${esc(s.title)}</span></a></li>`);
    }
    html.push("</ol></details></li>");
  }
  html.push(`</ol><div class="toc-foot"><button type="button" class="reset-btn" id="resetBtn">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/></svg>Reset and remove guide</button></div></div>`);
  $("tocContents").innerHTML = html.join("");
  updateTocProgress();
}

function updateTocProgress() {
  const el = $("tocProgress");
  if (!el || !state.doc) return;
  const total = state.order.length - 1;
  const done = state.order.filter((s) => state.done.has(s.key)).length;
  el.textContent = done ? `${done} of ${total} sections done` : `${total} sections`;
}

function markTocCurrent() {
  const toc = $("toc");
  for (const a of toc.querySelectorAll("a[aria-current]")) a.removeAttribute("aria-current");
  if (!state.current) return;
  const a = toc.querySelector(`a[data-key="${CSS.escape(state.current.key)}"]`);
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
  if (!state.doc) { $("toc").hidden = true; $("scrim").hidden = true; return; }
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

function showChrome(on) {
  for (const id of ["tocBtn", "searchBtn"]) $(id).hidden = !on;
}

function viewImport(message) {
  state.current = null;
  showChrome(false);
  setBar("FF6 Guide");
  const replacing = !!state.doc;
  $("view").innerHTML = `
  <section class="import">
    <p class="eyebrow">${replacing ? "Import a new copy" : "Set up"}</p>
    <h1>Load your copy of the walkthrough</h1>
    <p>This app reads a guide you've saved yourself. Pick it from the Files app. It's stored only on this device and is never uploaded anywhere.</p>
    <button type="button" class="btn solid big" id="pickBtn">Choose a file</button>
    <div class="progress" id="prog" hidden><div class="progress-row"><span id="progText"></span><span id="progCount"></span></div><div class="meter"><i id="progFill"></i></div></div>
    <p class="err" id="importErr"${message ? "" : " hidden"}>${message ? esc(message) : ""}</p>
    <h2>Which file?</h2>
    <dl class="kinds">
      <div><dt>A PDF of a text guide</dt><dd>In Safari, open the guide on GameFAQs, tap Share, then Options, choose PDF, and save it to Files. This works for guides set in a fixed-width (typewriter) font.</dd></div>
      <div><dt>A saved web page</dt><dd>An .html file or a Safari web archive (Share, Options, Web Archive). Works for formatted guides with headings, lists and tables, and for text guides shown on a web page.</dd></div>
      <div><dt>A backup from this app</dt><dd>A .zip saved with "Save a backup" in Reading settings, from this or another device. It brings back the guide, your progress, character names and maps.</dd></div>
      <div><dt>A text or Markdown file</dt><dd>The clean copy this app saves, a guide in its original fixed-width text format, or Markdown (.md) using # for headings. Edited copies work too.</dd></div>
    </dl>
    <p class="hint">After importing a PDF or web page, save the clean copy the app offers and import that from then on.</p>
    ${replacing ? `<p><a href="#/">Back to the guide</a></p>` : ""}
  </section>`;
  $("pickBtn").onclick = () => $("file").click();
}

function viewHome() {
  state.current = null;
  showChrome(true);
  setBar("FF6 Guide");
  const front = state.order[0];
  const last = state.byKey.get(getPref("last", ""));
  const total = state.order.length - 1;
  const done = state.order.filter((s) => state.done.has(s.key)).length;
  const needsMaster = !["text", "markdown"].includes(state.guide.source) && !getPref("savedText", false);
  const copyKind = { html: "web page copy", markdown: "Markdown" }[state.guide.format] || "text";
  const chapters = groups().filter((g) => g.head.level === 2);
  $("view").innerHTML = `
  <section class="home">
    ${renderHeading(front)}
    ${last ? `<a class="continue" href="${hrefFor(last)}" data-resume="1"><span class="eyebrow">Continue</span><span class="ct">${last.num ? `<span class="num">${esc(last.num)}</span>` : ""}${inline(last.title)}</span></a>` : ""}
    ${needsMaster ? `<div class="notice"><p><strong>Keep a clean master copy.</strong> Save the cleaned ${copyKind} to iCloud Drive and import that next time. It has just the guide, without the rest of the ${state.guide.source === "pdf" ? "PDF" : "web page"}, and it's the file to edit if you want to change the guide.</p><button type="button" class="btn" id="homeExport">Save a clean copy</button></div>` : ""}
    <p class="stat">${total} sections${done ? ` · ${done} done` : ""}</p>
    <ol class="chapters">
      <li><a href="${hrefFor(front)}"><span class="n"></span><span class="t">Title page and contents</span></a></li>
      ${chapters.map((g) => `<li><a href="${hrefFor(g.head)}"><span class="n">${esc(g.head.num)}</span><span class="t">${esc(g.head.title)}</span>${g.items.length ? `<span class="cnt">${g.items.length}</span>` : ""}</a></li>`).join("")}
    </ol>
  </section>`;
  const he = $("homeExport");
  if (he) he.onclick = exportText;
  markTocCurrent();
  window.scrollTo(0, 0);
}

function viewSection(s, opts = {}) {
  state.current = s;
  showChrome(true);
  setBar((s.num ? `<span class="num">${esc(s.num)}</span>` : "") + `<span class="bt">${s.level === 1 ? "Title page" : esc(s.title)}</span>`, "#/");
  const i = state.order.indexOf(s);
  const prev = state.order[i - 1];
  const next = state.order[i + 1];
  const isDone = state.done.has(s.key);
  const navLink = (t, dir) => t ? `<a class="pn ${dir}" href="${hrefFor(t)}" rel="${dir}"><span class="eyebrow">${dir === "prev" ? "Previous" : "Next"}</span><span class="pt">${t.num ? `<span class="num">${esc(t.num)}</span>` : ""}${t.level === 1 ? "Title page" : esc(t.title)}</span></a>` : "<span></span>";
  $("view").innerHTML = `
  <article class="sec lv${s.level}">
    ${s.level === 1 ? renderHeading(s) : renderHeading(s)}
    ${sectionMaps(s)}
    <div class="body">${renderBlocks(s.blocks, linkNum, linkAnchor)}</div>
    ${s.level === 1 ? "" : `<button type="button" class="done-btn${isDone ? " on" : ""}" id="doneBtn" aria-pressed="${isDone}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>${isDone ? "Done" : "Mark section done"}</span></button>`}
    <nav class="pager" aria-label="Section navigation">${navLink(prev, "prev")}${navLink(next, "next")}</nav>
  </article>`;
  // Search highlights go first: they can span several names, and names inside them stay plain.
  const q = state.pendingQuery;
  state.pendingQuery = "";
  const first = q ? highlight($("view").querySelector("article"), q) : null;
  if (prefs.colorNames) markNames($("view").querySelector("article.sec"), state.matcher);
  const db = $("doneBtn");
  if (db) db.onclick = () => toggleDone(s, db);
  setPref("last", s.key);
  markTocCurrent();
  if (wide() && !$("toc").hidden) scrollTocToCurrent();

  if (first) { first.scrollIntoView({ block: "center" }); return; }
  if (opts.resume) {
    const pos = getPref("pos", {})[s.key];
    if (pos) { requestAnimationFrame(() => window.scrollTo(0, pos * document.documentElement.scrollHeight)); return; }
  }
  window.scrollTo(0, 0);
}

function sectionMaps(s) {
  const items = itemsForSection(s.num);
  if (!items.length) return "";
  return `<div class="sec-maps"><span class="eyebrow">Maps</span>${items.map((it) => it.kind === "map"
    ? `<a class="chip" href="${it.href}">${esc(it.title)}</a>`
    : `<a class="chip ext" href="${esc(it.href)}" target="_blank" rel="noopener noreferrer">${esc(it.title)} ↗</a>`).join("")}</div>`;
}

function viewMap(m) {
  state.current = null;
  state.currentMap = m.id;
  showChrome(true);
  setBar(`<span class="bt">${esc(m.title)}</span>`, "#/");
  const sec = m.section ? state.byNum.get(m.section) : null;
  renderMapViewer($("view"), m, { sectionLabel: sec ? { href: hrefFor(sec), title: sec.title } : null });
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
  onChange: () => {
    refreshMapsPanel();
    if (state.current) {
      const box = $("view").querySelector(".sec-maps");
      const html = sectionMaps(state.current);
      if (box) box.outerHTML = html || "";
      else if (html) $("view").querySelector(".sec-h")?.insertAdjacentHTML("afterend", html);
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

function toggleDone(s, btn) {
  if (state.done.has(s.key)) state.done.delete(s.key);
  else state.done.add(s.key);
  setPref("done", [...state.done]);
  const on = state.done.has(s.key);
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.querySelector("span").textContent = on ? "Done" : "Mark section done";
  const a = $("toc").querySelector(`a[data-key="${CSS.escape(s.key)}"]`);
  if (a) a.classList.toggle("done", on);
  const det = a && a.closest("details");
  if (det) {
    const links = [...det.querySelectorAll("a.toc-sub:not(.intro)")];
    const n = links.filter((l) => l.classList.contains("done")).length;
    det.querySelector(".cnt").textContent = (n ? n + "/" : "") + links.length;
  }
  updateTocProgress();
}

// Remember reading position per section.
let posTimer = null;
addEventListener("scroll", () => {
  if (!state.current) return;
  clearTimeout(posTimer);
  const key = state.current.key;
  posTimer = setTimeout(() => {
    const pos = getPref("pos", {});
    pos[key] = +(window.scrollY / document.documentElement.scrollHeight).toFixed(5);
    setPref("pos", pos);
  }, 300);
}, { passive: true });

/* ---------------- routing ---------------- */

let resumeNext = false;
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-resume]");
  if (a) resumeNext = true;
});

function route() {
  closeSheets();
  const h = location.hash;
  if (!state.doc || h === "#/import") return viewImport();
  state.currentMap = null;
  const mm = h.match(/^#\/map\/(.+)$/);
  if (mm) {
    const map = getMap(decodeURIComponent(mm[1]));
    if (map) return viewMap(map);
  }
  const m = h.match(/^#\/s\/(.+)$/);
  if (m) {
    const s = state.byKey.get(decodeURIComponent(m[1]));
    if (s) {
      const resume = resumeNext;
      resumeNext = false;
      return viewSection(s, { resume });
    }
  }
  viewHome();
}
addEventListener("hashchange", route);

/* ---------------- import ---------------- */

$("file").addEventListener("change", async (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = "";
  if (!files.length) return;
  if (location.hash !== "#/import") { history.pushState(null, "", "#/import"); viewImport(); }
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const prog = $("prog"), err = $("importErr");
  const status = (t, c = "", frac = null) => {
    prog.hidden = false;
    $("progText").textContent = t;
    $("progCount").textContent = c;
    if (frac !== null) $("progFill").style.width = Math.round(frac * 100) + "%";
  };
  err.hidden = true;
  $("pickBtn").disabled = true;
  try {
    const kinds = await Promise.all(files.map(detectKind));
    if (kinds.includes("zip")) {
      if (files.length > 1) throw new Error("onebackup");
      return await startRestore(files[0], (msg) => { err.textContent = msg; err.hidden = false; });
    }
    let guide, doc, pages = 0;
    const name = files.map((f) => f.name).join(", ");
    const docKinds = kinds.filter((k) => k === "html" || k === "webarchive" || k === "markdown");
    if (docKinds.length) {
      // Web pages, web archives and Markdown are imported one file at a time.
      if (files.length > 1) throw new Error("onedoc");
      status(kinds[0] === "markdown" ? "Reading Markdown" : "Reading the web page", "", 0.4);
      const r = await importDocument(files[0], kinds[0]);
      guide = { format: r.format, text: r.text, name, importedAt: Date.now(), source: kinds[0] };
      doc = r.doc;
    } else {
      let lines = [];
      let source = "text";
      for (let f = 0; f < files.length; f++) {
        const file = files[f];
        const tag = files.length > 1 ? ` (${f + 1} of ${files.length})` : "";
        if (kinds[f] === "pdf") {
          source = "pdf";
          status("Loading the PDF reader" + tag, "", 0.02);
          const { linesFromPdf } = await import("./extract.js");
          const res = await linesFromPdf(await file.arrayBuffer(), (p, n) => status("Reading pages" + tag, `${p} / ${n}`, 0.03 + 0.92 * (p / n)));
          lines = lines.concat(res.lines, [""]);
          pages += res.pages;
        } else {
          status("Reading text" + tag, "", 0.5);
          lines = lines.concat((await readText(file)).split(/\r?\n/), [""]);
        }
      }
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (lines.filter((l) => l.trim()).length < 20) throw new Error("notext");
      const text = lines.join("\n");
      guide = { format: "text", text, name, importedAt: Date.now(), source };
      doc = parseText(text);
    }
    status("Finding sections", "", 0.97);
    await new Promise((r) => setTimeout(r, 20));
    const found = doc.sections.length - 1;
    if (found < (guide.format === "text" ? 2 : 1)) throw new Error("nosections:" + guide.format);
    await saveGuide(guide);
    askPersist();
    setPref("savedText", guide.source === "text" || guide.source === "markdown");
    useGuide(guide);
    status("Ready", (pages ? `${pages} pages · ` : "") + `${found} sections`, 1);
    syncTocMode();
    toast("Guide imported");
    location.hash = "#/";
  } catch (ex) {
    console.error(ex);
    prog.hidden = true;
    const msg = String(ex && ex.message || ex);
    err.textContent = msg === "notext"
      ? "No guide text was found in that file. If it's a PDF, save the guide page itself from Safari (Share, Options, PDF) and try again."
      : msg === "onebackup"
        ? "Import a backup on its own."
      : msg === "onedoc"
        ? "Import a web page or Markdown file on its own. Several files at once only works for PDFs and text files."
      : msg === "nosections:text"
        ? "The text was read, but almost no section headings were found. The text importer looks for headings underlined with a row of asterisks, as GameFAQs guides use."
      : msg.startsWith("nosections")
        ? "The page was read, but it has no headings (h1–h6 in a web page, # in Markdown) to split it into sections."
        : ex && ex.name === "PasswordException"
          ? "That PDF is password protected. Save an unprotected copy and try again."
          : `That file couldn't be read (${msg}).`;
    err.hidden = false;
  } finally {
    const pb = $("pickBtn");
    if (pb) pb.disabled = false;
  }
});

/* ---------------- export ---------------- */

async function exportText() {
  if (!state.guide) return;
  const base = (state.guide.name.split(",")[0] || "guide").replace(/\.(pdf|txt|text|html?|webarchive|md|markdown)$/i, "").trim() || "guide";
  const name = (state.guide.source === "text" || state.guide.source === "markdown" ? base : base + " (clean)") + "." + extFor(state.guide.format);
  const file = new File([state.guide.text.replace(/\n?$/, "\n")], name, { type: { html: "text/html", markdown: "text/markdown" }[state.guide.format] || "text/plain" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      setPref("savedText", true);
      return;
    }
  } catch (ex) {
    if (ex && ex.name === "AbortError") return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  setPref("savedText", true);
}

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

// Reads a backup and, after asking if it would replace anything, restores it and restarts.
async function startRestore(file, onError) {
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
  if (state.base || hasMaps() || names.length) {
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
  history.replaceState(null, "", location.pathname);
  location.reload();
}

const restoreDialog = $("restoreDialog");
$("restoreNo").onclick = () => restoreDialog.close("no");
$("restoreYes").onclick = () => restoreDialog.close("yes");
restoreDialog.addEventListener("click", (e) => { if (e.target === restoreDialog) restoreDialog.close("no"); });

/* ---------------- search ---------------- */

function buildSearch() {
  if (!state.searchText) state.searchText = state.order.map((s) => sectionText(s).toLowerCase());
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
  const hits = [];
  let total = 0;
  // Section numbers jump straight to that section.
  const numHit = state.byNum.get(q.replace(/\.$/, ""));
  for (let i = 0; i < texts.length; i++) {
    let idx = texts[i].indexOf(ql), n = 0, first = idx;
    while (idx !== -1) { n++; idx = texts[i].indexOf(ql, idx + ql.length); }
    if (n) { hits.push({ s: state.order[i], n, first, i }); total += n; }
  }
  hits.sort((a, b) => (b.s.title.toLowerCase().includes(ql) - a.s.title.toLowerCase().includes(ql)) || a.i - b.i);
  const shown = hits.slice(0, 150);
  $("searchCount").textContent = hits.length ? `${total} match${total === 1 ? "" : "es"} in ${hits.length} section${hits.length === 1 ? "" : "s"}` : "No matches.";
  const full = (i) => sectionText(state.order[i]);
  list.innerHTML = (numHit ? `<li><a href="${hrefFor(numHit)}" data-q=""><span class="r-h"><span class="num">${esc(numHit.num)}</span>${esc(numHit.title)}</span><span class="r-s">Go to section</span></a></li>` : "") +
    shown.map((h) => `<li><a href="${hrefFor(h.s)}" data-q="${esc(q)}"><span class="r-h">${h.s.num ? `<span class="num">${esc(h.s.num)}</span>` : ""}${esc(h.s.level === 1 ? "Title page" : h.s.title)}${h.n > 1 ? `<span class="cnt">${h.n}</span>` : ""}</span><span class="r-s">${snippet(full(h.i), h.first, q.length)}</span></a></li>`).join("");
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
  $("removeConfirm").hidden = true;
  if ($("scrim").hidden) document.body.classList.remove("locked");
}
for (const b of document.querySelectorAll("[data-close]")) b.onclick = closeSheets;
for (const id of ["searchSheet", "settingsSheet"]) $(id).addEventListener("click", (e) => { if (e.target.id === id) closeSheets(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSheets(); if (!wide()) setTocOpen(false); } });

$("searchBtn").onclick = () => {
  openSheet("searchSheet");
  const q = $("q");
  if (!q.value) q.value = getPref("lastQuery", "");
  runSearch();
  q.focus();
  q.select();
};
$("settingsBtn").onclick = () => { updateGuideInfo(); openSheet("settingsSheet"); };

function updateGuideInfo() {
  const g = state.guide;
  $("guideInfo").textContent = g
    ? `${g.name}, imported ${new Date(g.importedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}. ${state.order.length - 1} sections.`
    : "No guide imported yet.";
  for (const id of ["exportBtn", "removeBtn"]) $(id).disabled = !g;
}
$("exportBtn").onclick = exportText;
$("replaceBtn").onclick = () => { closeSheets(); location.hash = "#/import"; };
$("removeBtn").onclick = () => { $("removeConfirm").hidden = false; };
$("removeCancel").onclick = () => { $("removeConfirm").hidden = true; };
// Deletes the stored guide and everything tied to it (done marks, reading positions, last
// section, search). Reading preferences such as text size and theme are kept.
async function purgeGuideData() {
  await removeGuide();
  for (const k of ["done", "last", "pos", "savedText", "lastQuery"]) setPref(k, null);
}

$("removeYes").onclick = async () => {
  await purgeGuideData();
  state.done.clear();
  state.guide = state.base = state.doc = null;
  state.byKey.clear();
  state.byNum.clear();
  state.order = [];
  $("tocContents").innerHTML = "";
  syncTocMode();
  closeSheets();
  updateGuideInfo();
  location.hash = "#/import";
  route();
  toast("Guide removed from this device");
};
/* ---------------- reset (contents panel) ---------------- */

const resetDialog = $("resetDialog");
$("toc").addEventListener("click", (e) => {
  if (!e.target.closest("#resetBtn")) return;
  $("resetGuideName").textContent = state.guide ? state.guide.name : "the current guide";
  resetDialog.showModal();
  $("resetNo").focus(); // "No" is the default choice
});
$("resetNo").onclick = () => resetDialog.close("no");
resetDialog.addEventListener("click", (e) => { if (e.target === resetDialog) resetDialog.close("no"); });
$("resetYes").onclick = async () => {
  $("resetYes").disabled = $("resetNo").disabled = true;
  try {
    await purgeGuideData();
  } catch (ex) {
    console.error(ex);
    $("resetYes").disabled = $("resetNo").disabled = false;
    resetDialog.close("no");
    toast("The guide couldn't be removed. Try again.");
    return;
  }
  // Reload from a clean URL so the app starts fresh on the import page.
  history.replaceState(null, "", location.pathname);
  location.reload();
};

$("file").setAttribute("accept", ACCEPT);
$("appVersion").textContent = `Version ${VERSION}. The guide and your progress are stored only in this browser.`;

/* ---------------- start ---------------- */

async function start() {
  applyPrefs();
  updateWakeLock();
  $("view").innerHTML = `<p class="loading">Opening your guide…</p>`;
  try {
    const g = await loadGuide();
    if (g && g.text) {
      useGuide(g);
      if (!location.hash || location.hash === "#" || location.hash === "#/") {
        const last = state.byKey.get(getPref("last", ""));
        if (last) { resumeNext = true; history.replaceState(null, "", hrefFor(last)); }
      }
    }
  } catch (ex) {
    console.error(ex);
  }
  await loadMaps();
  refreshMapsPanel();
  setPanelTab(getPref("panelTab", "contents"));
  syncTocMode();
  route();
}
start();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
