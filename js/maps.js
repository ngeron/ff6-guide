// Maps: your own map images (stored on this device) and a list of links to maps hosted elsewhere.
//
// Images can be imported one by one, or as a map pack: a .zip holding the images plus an
// optional maps.json that gives titles, order, the guide section each map belongs to, and links:
//
//   {
//     "title": "Ember Crown maps",
//     "maps":  [{ "file": "world.png", "title": "World map", "section": "3.0" }],
//     "links": [{ "title": "Interactive world map", "url": "https://…", "section": "3.0", "note": "…" }]
//   }

import { listMaps, putMap, deleteMap, clearMaps, loadLinks, saveLinks } from "./store.js";
import { unzip, zip } from "./zip.js";
import { esc } from "./render.js";

const IMG_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const $ = (id) => document.getElementById(id);

let maps = [];
let links = [];
const urls = new Map(); // map id -> object URL
let ctx = { toast: () => {}, onChange: () => {}, sectionTitle: () => null, sectionHref: () => null, sectionNums: () => [] };

const uid = () => {
  try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
};
const baseName = (n) => n.split("/").pop();
const ext = (n) => (baseName(n).split(".").pop() || "").toLowerCase();
const titleFromFile = (n) => baseName(n).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase()) || "Map";

export function initMaps(options) { ctx = { ...ctx, ...options }; }

export async function loadMaps() {
  try {
    maps = await listMaps();
    links = await loadLinks();
  } catch (ex) {
    console.error(ex);
    maps = [];
    links = [];
  }
}

export const getMap = (id) => maps.find((m) => m.id === id);
export const hasMaps = () => maps.length > 0 || links.length > 0;

function urlFor(m) {
  if (!urls.has(m.id)) urls.set(m.id, URL.createObjectURL(new Blob([m.data], { type: m.type })));
  return urls.get(m.id);
}
function dropUrl(id) {
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
}

export function itemsForSection(num) {
  if (!num) return [];
  return [
    ...maps.filter((m) => m.section === num).map((m) => ({ kind: "map", title: m.title, href: `#/map/${m.id}` })),
    ...links.filter((l) => l.section === num).map((l) => ({ kind: "link", title: l.title, href: l.url })),
  ];
}

/* ---------------- import ---------------- */

async function measure(data, type) {
  const blob = new Blob([data], { type });
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close();
      return size;
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("not an image"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cleanLink(l) {
  if (!l || typeof l.url !== "string") return null;
  let url;
  try { url = new URL(l.url.trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  return { id: uid(), title: String(l.title || url.hostname).trim().slice(0, 120), url: url.href, section: l.section ? String(l.section).trim() : "", note: l.note ? String(l.note).trim().slice(0, 300) : "" };
}

// Accepts images, map pack .zip files and maps.json files. Returns a summary.
export async function importFiles(files, onProgress = () => {}) {
  const images = []; // { name, data: Uint8Array }
  let manifest = null;
  const problems = [];
  for (const f of files) {
    const e = ext(f.name);
    onProgress(`Reading ${f.name}`);
    if (e === "zip") {
      const entries = await unzip(await f.arrayBuffer());
      if (entries.some((en) => en.name === "backup.json")) { problems.push(`${f.name} is a full backup. Restore it from Settings`); continue; }
      for (const en of entries) {
        if (baseName(en.name).startsWith(".") || en.name.includes("__MACOSX")) continue;
        if (baseName(en.name).toLowerCase() === "maps.json") manifest = parseManifest(en.data, problems);
        else if (IMG_TYPES[ext(en.name)]) images.push(en);
      }
    } else if (e === "json") {
      manifest = parseManifest(new Uint8Array(await f.arrayBuffer()), problems);
    } else if (IMG_TYPES[e] || (f.type || "").startsWith("image/")) {
      images.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    } else {
      problems.push(`${f.name} isn't an image, a map pack or maps.json`);
    }
  }

  const meta = new Map();
  (manifest?.maps || []).forEach((m, i) => { if (m && m.file) meta.set(baseName(String(m.file)).toLowerCase(), { ...m, order: i }); });
  let order = maps.reduce((a, m) => Math.max(a, m.order || 0), 0) + 1;
  let added = 0;
  const now = Date.now();
  for (const im of images) {
    onProgress(`Adding ${baseName(im.name)}`);
    const type = IMG_TYPES[ext(im.name)] || "image/png";
    let size;
    try { size = await measure(im.data, type); } catch { problems.push(`${baseName(im.name)} couldn't be read as an image`); continue; }
    const m = meta.get(baseName(im.name).toLowerCase());
    const rec = {
      id: uid(),
      title: (m && m.title ? String(m.title) : titleFromFile(im.name)).slice(0, 120),
      section: m && m.section ? String(m.section).trim() : "",
      data: im.data.buffer.slice(im.data.byteOffset, im.data.byteOffset + im.data.byteLength),
      type,
      width: size.width,
      height: size.height,
      order: m ? order + m.order : order + meta.size + added,
      addedAt: now + added,
      file: baseName(im.name),
    };
    await putMap(rec);
    added++;
  }

  let linksAdded = 0;
  if (manifest?.links?.length) {
    const known = new Set(links.map((l) => l.url));
    for (const raw of manifest.links) {
      const l = cleanLink(raw);
      if (l && !known.has(l.url)) { links.push(l); known.add(l.url); linksAdded++; }
    }
    await saveLinks(links);
  }
  await loadMaps();
  ctx.onChange();
  return { added, linksAdded, problems };
}

function parseManifest(bytes, problems) {
  try {
    const j = JSON.parse(new TextDecoder().decode(bytes));
    return { maps: Array.isArray(j.maps) ? j.maps : [], links: Array.isArray(j.links) ? j.links : [], title: j.title || "" };
  } catch {
    problems.push("maps.json couldn't be read (it isn't valid JSON)");
    return null;
  }
}

/* ---------------- export ---------------- */

export async function exportPack() {
  const used = new Set();
  const entries = maps.map((m) => {
    let name = (m.file || m.title.replace(/[^\w.-]+/g, "-").toLowerCase() + "." + (Object.entries(IMG_TYPES).find(([, t]) => t === m.type)?.[0] || "png"));
    while (used.has(name.toLowerCase())) name = name.replace(/(\.\w+)$/, "-2$1");
    used.add(name.toLowerCase());
    return { m, name };
  });
  const manifest = {
    title: "My maps",
    maps: entries.map(({ m, name }) => ({ file: name, title: m.title, ...(m.section ? { section: m.section } : {}) })),
    links: links.map(({ title, url, section, note }) => ({ title, url, ...(section ? { section } : {}), ...(note ? { note } : {}) })),
  };
  const blob = zip([{ name: "maps.json", data: JSON.stringify(manifest, null, 2) }, ...entries.map(({ m, name }) => ({ name, data: new Uint8Array(m.data) }))]);
  const file = new File([blob], "maps.zip", { type: "application/zip" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (ex) {
    if (ex && ex.name === "AbortError") return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = "maps.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------------- edits ---------------- */

export async function updateMap(id, changes) {
  const m = getMap(id);
  if (!m) return;
  Object.assign(m, changes);
  await putMap(m);
  ctx.onChange();
}

export async function removeMap(id) {
  await deleteMap(id);
  dropUrl(id);
  maps = maps.filter((m) => m.id !== id);
  ctx.onChange();
}

export async function addLink(raw) {
  const l = cleanLink(raw);
  if (!l) return false;
  links.push(l);
  await saveLinks(links);
  ctx.onChange();
  return true;
}

export async function removeLink(id) {
  links = links.filter((l) => l.id !== id);
  await saveLinks(links);
  ctx.onChange();
}

export async function removeAllMaps() {
  await clearMaps();
  await saveLinks([]);
  for (const id of [...urls.keys()]) dropUrl(id);
  maps = [];
  links = [];
  ctx.onChange();
}

/* ---------------- panel ---------------- */

const linkIcon = `<svg class="ext" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`;

export function renderPanel(container, currentMapId) {
  const sec = (num) => {
    if (!num) return "";
    return `<span class="mp-sec">${esc(num)}</span>`;
  };
  container.innerHTML = `
  <div class="toc-in maps-in">
    <h3 class="mp-h">My maps <span class="cnt">${maps.length || ""}</span></h3>
    ${maps.length ? `<ol class="mp-list">${maps.map((m) => `
      <li><a class="mp-item" href="#/map/${m.id}"${m.id === currentMapId ? ' aria-current="page"' : ""}>
        <img class="mp-thumb" src="${urlFor(m)}" alt="" loading="lazy" width="56" height="42">
        <span class="mp-t">${esc(m.title)}${sec(m.section)}</span></a></li>`).join("")}</ol>`
      : `<p class="mp-empty">No maps yet. Add your own images from Files, or a map pack (.zip).</p>`}
    <button type="button" class="btn mp-add" id="mapAddBtn">Add map images</button>

    <h3 class="mp-h">Map links <span class="cnt">${links.length || ""}</span></h3>
    ${links.length ? `<ol class="mp-links">${links.map((l) => `
      <li><a class="mp-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
        <span class="mp-t">${esc(l.title)}${linkIcon}${sec(l.section)}</span>
        <span class="mp-host">${esc(l.note || new URL(l.url).hostname)}</span></a>
        <button type="button" class="mp-x" data-unlink="${l.id}" aria-label="Remove link ${esc(l.title)}">×</button></li>`).join("")}</ol>`
      : `<p class="mp-empty">Bookmark maps hosted on other sites. They open in a new tab.</p>`}
    <details class="mp-form"${links.length ? "" : " open"}>
      <summary>Add a link</summary>
      <form id="linkForm" novalidate>
        <label for="linkTitle">Name</label>
        <input id="linkTitle" type="text" placeholder="World map (interactive)" maxlength="120" autocomplete="off">
        <label for="linkUrl">Address</label>
        <input id="linkUrl" type="url" inputmode="url" placeholder="https://" autocapitalize="off" autocomplete="off" spellcheck="false">
        <label for="linkSec">Guide section <span class="opt">(optional)</span></label>
        <input id="linkSec" type="text" inputmode="decimal" placeholder="4.31" list="secNums" autocomplete="off">
        <p class="mp-err" id="linkErr" hidden></p>
        <button type="submit" class="btn solid">Add link</button>
      </form>
    </details>

    <div class="toc-foot mp-foot">
      <button type="button" class="btn" id="mapExportBtn"${hasMaps() ? "" : " disabled"}>Save map pack</button>
      <button type="button" class="reset-btn" id="mapClearBtn"${hasMaps() ? "" : " disabled"}>Remove all maps and links</button>
      <div class="confirm" id="mapClearConfirm" hidden>
        <p>Remove every map image and link from this device? Save a map pack first if you want to keep them.</p>
        <div class="row2"><button type="button" class="btn solid" id="mapClearNo">No, keep them</button><button type="button" class="btn danger" id="mapClearYes">Remove</button></div>
      </div>
    </div>
  </div>`;
}

// Event handling for the panel (delegated so re-rendering is cheap).
export function bindPanel(container, pickFiles) {
  container.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("#mapAddBtn")) return pickFiles();
    if (t.closest("#mapExportBtn")) return exportPack();
    if (t.closest("#mapClearBtn")) { $("mapClearConfirm").hidden = false; $("mapClearNo").focus(); return; }
    if (t.closest("#mapClearNo")) { $("mapClearConfirm").hidden = true; return; }
    if (t.closest("#mapClearYes")) { await removeAllMaps(); ctx.toast("Maps and links removed"); return; }
    const un = t.closest("[data-unlink]");
    if (un) {
      const l = links.find((x) => x.id === un.dataset.unlink);
      if (un.dataset.armed) { await removeLink(un.dataset.unlink); ctx.toast(`Removed ${l ? l.title : "link"}`); }
      else { un.dataset.armed = "1"; un.textContent = "Remove"; un.classList.add("armed"); setTimeout(() => { if (un.isConnected) { delete un.dataset.armed; un.textContent = "×"; un.classList.remove("armed"); } }, 3000); }
    }
  });
  container.addEventListener("submit", async (e) => {
    if (e.target.id !== "linkForm") return;
    e.preventDefault();
    const err = $("linkErr");
    let url = $("linkUrl").value.trim();
    if (url && !/^[a-z]+:\/\//i.test(url)) url = "https://" + url;
    const ok = await addLink({ title: $("linkTitle").value.trim(), url, section: $("linkSec").value.trim() });
    if (!ok) { err.textContent = "Enter a web address starting with https://"; err.hidden = false; $("linkUrl").focus(); return; }
    ctx.toast("Link added");
  });
}

/* ---------------- viewer ---------------- */

export function renderViewer(view, m, { sectionLabel }) {
  view.innerHTML = `
  <section class="mapview">
    <div class="map-tools" role="toolbar" aria-label="Zoom">
      <button type="button" class="btn" id="zFit">Fit</button>
      <button type="button" class="btn" id="zOut" aria-label="Zoom out">−</button>
      <output id="zPct" class="zpct">100%</output>
      <button type="button" class="btn" id="zIn" aria-label="Zoom in">+</button>
      <button type="button" class="btn" id="z100">Actual size</button>
      ${m.section && sectionLabel ? `<a class="map-back" href="${sectionLabel.href}">${esc(m.section)} ${esc(sectionLabel.title)}</a>` : ""}
    </div>
    <div class="map-stage" id="stage" tabindex="0" aria-label="${esc(m.title)}, double-tap to zoom">
      <img id="mapImg" src="${urlFor(m)}" alt="${esc(m.title)}" width="${m.width}" height="${m.height}" draggable="false">
    </div>
    <details class="map-edit">
      <summary>Map details</summary>
      <form id="mapForm" novalidate>
        <label for="mapTitle">Name</label>
        <input id="mapTitle" type="text" value="${esc(m.title)}" maxlength="120" autocomplete="off">
        <label for="mapSec">Show with guide section <span class="opt">(optional)</span></label>
        <input id="mapSec" type="text" inputmode="decimal" value="${esc(m.section || "")}" placeholder="3.1.3" list="secNums" autocomplete="off">
        <p class="hint">${m.width} × ${m.height} pixels${m.file ? ` · ${esc(m.file)}` : ""}</p>
        <div class="row2">
          <button type="submit" class="btn solid">Save</button>
          <button type="button" class="btn danger" id="mapDel">Delete map</button>
        </div>
        <div class="confirm" id="mapDelConfirm" hidden>
          <p>Delete “${esc(m.title)}” from this device?</p>
          <div class="row2"><button type="button" class="btn solid" id="mapDelNo">No, keep it</button><button type="button" class="btn danger" id="mapDelYes">Delete</button></div>
        </div>
      </form>
    </details>
  </section>`;
  setupZoom(m);
  $("mapForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await updateMap(m.id, { title: $("mapTitle").value.trim() || m.title, section: $("mapSec").value.trim() });
    ctx.toast("Map saved");
  });
  $("mapDel").onclick = () => { $("mapDelConfirm").hidden = false; $("mapDelNo").focus(); };
  $("mapDelNo").onclick = () => { $("mapDelConfirm").hidden = true; };
  $("mapDelYes").onclick = async () => { await removeMap(m.id); ctx.toast("Map deleted"); location.hash = "#/"; };
}

function setupZoom(m) {
  const stage = $("stage"), img = $("mapImg");
  let scale = 1, fit = 1;
  const clamp = (s) => Math.min(4, Math.max(Math.min(fit, 1) * 0.5, s));
  const apply = (s, ax, ay) => {
    // Keep the point under (ax, ay) (stage coordinates) still while zooming.
    const r = stage.getBoundingClientRect();
    ax = ax ?? r.width / 2;
    ay = ay ?? r.height / 2;
    const cx = (stage.scrollLeft + ax) / scale, cy = (stage.scrollTop + ay) / scale;
    scale = clamp(s);
    img.style.width = Math.round(m.width * scale) + "px";
    img.style.height = Math.round(m.height * scale) + "px";
    stage.scrollLeft = cx * scale - ax;
    stage.scrollTop = cy * scale - ay;
    $("zPct").textContent = Math.round(scale * 100) + "%";
  };
  const computeFit = () => {
    const r = stage.getBoundingClientRect();
    fit = Math.min((r.width - 2) / m.width, (r.height - 2) / m.height);
  };
  computeFit();
  apply(Math.min(fit, 1));
  $("zFit").onclick = () => { computeFit(); apply(fit); };
  $("z100").onclick = () => apply(1);
  $("zIn").onclick = () => apply(scale * 1.4);
  $("zOut").onclick = () => apply(scale / 1.4);

  // Double-tap / double-click toggles between fit and actual size at the tapped point.
  let lastTap = 0, lastToggle = 0;
  const toggleAt = (x, y) => { lastToggle = Date.now(); computeFit(); apply(scale < Math.max(1, fit) * 0.99 ? Math.max(1, fit * 2) : fit, x, y); };
  stage.addEventListener("dblclick", (e) => {
    if (Date.now() - lastToggle < 600) return; // already handled as a touch double-tap
    const r = stage.getBoundingClientRect();
    toggleAt(e.clientX - r.left, e.clientY - r.top);
  });

  // Two-finger pinch.
  const pts = new Map();
  let pinch = null;
  stage.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch" && pts.size === 1) {
      const now = Date.now();
      if (now - lastTap < 300) { const r = stage.getBoundingClientRect(); toggleAt(e.clientX - r.left, e.clientY - r.top); lastTap = 0; }
      else lastTap = now;
    }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale };
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const r = stage.getBoundingClientRect();
      apply(pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  // Trackpad pinch / ctrl+wheel.
  stage.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    apply(scale * Math.exp(-e.deltaY / 200), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  stage.addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") apply(scale * 1.4);
    else if (e.key === "-") apply(scale / 1.4);
    else if (e.key === "0") { computeFit(); apply(fit); }
  });
}
