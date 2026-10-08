import { parse, sectionText } from "./parse.js";
import { renderBlocks, renderHeading, esc, inline } from "./render.js";
import { loadGuide, saveGuide, removeGuide, askPersist, getPref, setPref } from "./store.js";

const VERSION = "0.1.0";
const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const state = {
  guide: null,      // { text, name, importedAt, source }
  doc: null,        // parsed document
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
  state.doc = parse(guide.text);
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
  updateGuideInfo();
}

function shortTitle() {
  return "FF6 Guide";
}

const hrefFor = (s) => "#/s/" + encodeURIComponent(s.key);
const linkNum = (num) => { const s = state.byNum.get(num); return s ? hrefFor(s) : null; };

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
  html.push("</ol></div>");
  $("toc").innerHTML = html.join("");
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
      <div><dt>A PDF of the guide page</dt><dd>In Safari, open the guide on GameFAQs, tap Share, then Options, choose PDF, and save it to Files. After importing, save the cleaned text and use that from then on.</dd></div>
      <div><dt>A text file</dt><dd>The cleaned text this app saves, or any copy of the guide in its original fixed-width text format, including one you've edited.</dd></div>
    </dl>
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
  const fromPdf = state.guide.source === "pdf" && !getPref("savedText", false);
  const chapters = groups().filter((g) => g.head.level === 2);
  $("view").innerHTML = `
  <section class="home">
    ${renderHeading(front)}
    ${last ? `<a class="continue" href="${hrefFor(last)}" data-resume="1"><span class="eyebrow">Continue</span><span class="ct">${last.num ? `<span class="num">${esc(last.num)}</span>` : ""}${inline(last.title)}</span></a>` : ""}
    ${fromPdf ? `<div class="notice"><p><strong>Keep a clean master copy.</strong> Save the cleaned text to iCloud Drive and import that next time. It's the file to edit if you want to change the guide.</p><button type="button" class="btn" id="homeExport">Save cleaned text</button></div>` : ""}
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
    <div class="body">${renderBlocks(s.blocks, linkNum)}</div>
    ${s.level === 1 ? "" : `<button type="button" class="done-btn${isDone ? " on" : ""}" id="doneBtn" aria-pressed="${isDone}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>${isDone ? "Done" : "Mark section done"}</span></button>`}
    <nav class="pager" aria-label="Section navigation">${navLink(prev, "prev")}${navLink(next, "next")}</nav>
  </article>`;
  const db = $("doneBtn");
  if (db) db.onclick = () => toggleDone(s, db);
  setPref("last", s.key);
  markTocCurrent();
  if (wide() && !$("toc").hidden) scrollTocToCurrent();

  if (state.pendingQuery) {
    const q = state.pendingQuery;
    state.pendingQuery = "";
    const first = highlight($("view").querySelector(".body"), q);
    if (first) { first.scrollIntoView({ block: "center" }); return; }
  }
  if (opts.resume) {
    const pos = getPref("pos", {})[s.key];
    if (pos) { requestAnimationFrame(() => window.scrollTo(0, pos * document.documentElement.scrollHeight)); return; }
  }
  window.scrollTo(0, 0);
}

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
    let lines = [];
    let source = "text";
    let pages = 0;
    for (let f = 0; f < files.length; f++) {
      const file = files[f];
      const tag = files.length > 1 ? ` (${f + 1} of ${files.length})` : "";
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        source = "pdf";
        status("Loading the PDF reader" + tag, "", 0.02);
        const { linesFromPdf } = await import("./extract.js");
        const res = await linesFromPdf(await file.arrayBuffer(), (p, n) => status("Reading pages" + tag, `${p} / ${n}`, 0.03 + 0.92 * (p / n)));
        lines = lines.concat(res.lines, [""]);
        pages += res.pages;
      } else {
        status("Reading text" + tag, "", 0.5);
        lines = lines.concat((await file.text()).split(/\r?\n/), [""]);
      }
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.filter((l) => l.trim()).length < 20) throw new Error("notext");
    status("Finding sections", "", 0.97);
    await new Promise((r) => setTimeout(r, 20));
    const text = lines.join("\n");
    const guide = { text, name: files.map((f) => f.name).join(", "), importedAt: Date.now(), source };
    const test = parse(text);
    if (test.sections.length < 3) throw new Error("nosections:" + (test.sections.length - 1));
    await saveGuide(guide);
    askPersist();
    if (source === "pdf") setPref("savedText", false);
    useGuide(guide);
    status("Ready", (pages ? `${pages} pages · ` : "") + `${test.sections.length - 1} sections`, 1);
    syncTocMode();
    toast("Guide imported");
    location.hash = "#/";
  } catch (ex) {
    console.error(ex);
    prog.hidden = true;
    const msg = String(ex && ex.message || ex);
    err.textContent = msg === "notext"
      ? "No guide text was found in that file. If it's a PDF, save the guide page itself from Safari (Share, Options, PDF) and try again."
      : msg.startsWith("nosections")
        ? "The text was read, but almost no section headings were found. The importer looks for headings underlined with a row of asterisks, as GameFAQs guides use."
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
  const base = (state.guide.name.split(",")[0] || "guide").replace(/\.(pdf|txt)$/i, "").trim() || "guide";
  const name = (state.guide.source === "pdf" ? base + " (clean)" : base) + ".txt";
  const file = new File([state.guide.text + "\n"], name, { type: "text/plain" });
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
$("removeYes").onclick = async () => {
  await removeGuide();
  for (const k of ["done", "last", "pos", "savedText", "lastQuery"]) setPref(k, null);
  state.done.clear();
  state.guide = state.doc = null;
  state.byKey.clear();
  state.byNum.clear();
  state.order = [];
  $("toc").innerHTML = "";
  syncTocMode();
  closeSheets();
  updateGuideInfo();
  location.hash = "#/import";
  route();
  toast("Guide removed from this device");
};
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
  syncTocMode();
  route();
}
start();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
