// HTML importer: turns a saved web page into the shared document structure.
//
// 1. Finds the part of the page that holds the guide (the element with the most non-link text),
//    so site menus, sidebars and footers are left out.
// 2. If that part is mostly <pre> text, the page is a plain-text guide wrapped in HTML
//    (like GameFAQs text guides), and the text importer handles it.
// 3. Otherwise headings (h1-h6) start sections, and paragraphs, lists, tables, preformatted
//    blocks, quotes and images become blocks. Basic inline formatting and links are kept.

import { parseText } from "./text.js";

const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
const BLOCKS = new Set(["P", "UL", "OL", "TABLE", "PRE", "BLOCKQUOTE", "DL", "FIGURE", "IMG", "HR", "DIV", "SECTION",
  "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "DETAILS", "SUMMARY", "CENTER", "FORM", "FIELDSET", "ADDRESS", ...HEADINGS]);
const DROP = "script,style,noscript,template,iframe,object,embed,form,button,input,select,textarea,svg,canvas,video,audio,link,meta";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const squash = (s) => s.replace(/[\s ]+/g, " ");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "section";
const textOf = (el) => squash(el.textContent || "").trim();

function safeHref(href) {
  if (!href) return null;
  href = href.trim();
  if (href.startsWith("#")) return href.length > 1 ? href : null;
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

// Inline content -> sanitized HTML (strong, em, code, links, line breaks).
function inlineHtml(node) {
  let out = "";
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += esc(squash(n.nodeValue)); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (tag === "BR") { out += "<br>"; continue; }
    if (tag === "IMG") { const alt = n.getAttribute("alt"); if (alt) out += esc(alt); continue; }
    if (BLOCKS.has(tag) && tag !== "DIV") { out += " " + inlineHtml(n) + " "; continue; }
    const inner = inlineHtml(n);
    if (!inner.trim()) { out += inner; continue; }
    if (tag === "STRONG" || tag === "B") out += `<strong>${inner}</strong>`;
    else if (tag === "EM" || tag === "I" || tag === "CITE") out += `<em>${inner}</em>`;
    else if (tag === "CODE" || tag === "KBD" || tag === "TT" || tag === "SAMP") out += `<code>${inner}</code>`;
    else if (tag === "SUP" || tag === "SUB") out += `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
    else if (tag === "A") {
      const href = safeHref(n.getAttribute("href"));
      out += href ? `<a href="${esc(href)}">${inner}</a>` : inner;
    } else out += inner;
  }
  return out;
}

const cleanInline = (html) => html.replace(/\s+/g, " ").replace(/^(\s|<br>)+|(\s|<br>)+$/g, "").trim();

// The element that holds the guide: the deepest one that still has most of the page's
// non-link text.
function contentRoot(body) {
  const score = (el) => {
    const t = textOf(el).length;
    let l = 0;
    for (const a of el.querySelectorAll("a")) l += textOf(a).length;
    return t - 2 * l;
  };
  const total = score(body);
  if (total <= 0) return body;
  let best = body, bestDepth = 0;
  const depth = (el) => { let d = 0; for (let p = el; p && p !== body; p = p.parentElement) d++; return d; };
  for (const el of body.querySelectorAll("article, main, [role=main], section, div, td")) {
    const s = score(el);
    if (s >= total * 0.8) {
      const d = depth(el);
      if (d > bestDepth) { best = el; bestDepth = d; }
    }
  }
  return best;
}

function splitNumbered(text) {
  const m = text.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)$/);
  return m ? { num: m[1], title: m[2].trim() } : { num: "", title: text };
}

export function importHtml(source) {
  const dom = new DOMParser().parseFromString(source, "text/html");
  dom.querySelectorAll(DROP).forEach((e) => e.remove());
  const body = dom.body || dom.documentElement;
  const root = contentRoot(body);
  const pageTitle = squash(dom.title || "").trim();

  // A plain-text guide wrapped in a web page.
  const pres = [...root.querySelectorAll("pre")];
  const preText = pres.reduce((a, p) => a + (p.textContent || "").length, 0);
  if (pres.length && preText >= textOf(root).length * 0.6) {
    const text = pres.map((p) => p.textContent.replace(/\r\n?/g, "\n").replace(/\n+$/, "")).join("\n");
    return { format: "text", text, doc: parseText(text) };
  }

  const doc = parseStructured(root, pageTitle);
  return { format: "html", text: cleanDocument(root, doc.title), doc };
}

function parseStructured(root, pageTitle) {
  const heads = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => textOf(h));
  const levelsUsed = [...new Set(heads.map((h) => +h.tagName[1]))].sort();
  // A single h1 above other headings is the guide's title, not a section.
  let titleHeading = null;
  if (heads.filter((h) => h.tagName === "H1").length === 1 && levelsUsed.length > 1) {
    titleHeading = heads.find((h) => h.tagName === "H1");
    levelsUsed.shift();
  }
  const levelOf = (h) => (levelsUsed.indexOf(+h.tagName[1]) <= 0 ? 2 : 3);

  const title = (titleHeading ? textOf(titleHeading) : "") || pageTitle.split(/\s+[|–—-]\s+/)[0] || "Guide";
  const front = { num: "", title, level: 1, id: "start", blocks: [], subtitle: [] };
  const sections = [front];
  const anchors = {};
  const ids = new Set(["start"]);
  let cur = front;
  let para = [];

  const flush = () => {
    if (!para.length) return;
    const html = cleanInline(para.join(""));
    para = [];
    const text = squash(html.replace(/<br>/g, " ").replace(/<[^>]+>/g, "")).trim();
    if (text) cur.blocks.push({ type: "p", text: decode(text), html });
  };
  // Link targets (id="…" or <a name="…">) map to the section they appear in.
  const noteAnchor = (el) => {
    const id = el.getAttribute("id") || (el.tagName === "A" && el.getAttribute("name"));
    if (id && !anchors[id]) anchors[id] = cur;
  };
  const noteAll = (el) => { noteAnchor(el); for (const d of el.querySelectorAll("[id], a[name]")) noteAnchor(d); };
  const CONTAINERS = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "DETAILS", "CENTER", "FORM", "FIELDSET"]);

  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) para.push(esc(squash(n.nodeValue))); else if (para.length) para.push(" "); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (HEADINGS.has(tag)) {
        flush();
        if (n === titleHeading) continue;
        const t = textOf(n);
        if (!t) continue;
        const { num, title } = splitNumbered(t);
        let id = slug(n.getAttribute("id") || (num ? "s" + num.replace(/\./g, "-") : title));
        while (ids.has(id)) id += "-2";
        ids.add(id);
        cur = { num, title, level: levelOf(n), id, blocks: [] };
        sections.push(cur);
        if (n.getAttribute("id")) anchors[n.getAttribute("id")] = cur;
        for (const a of n.querySelectorAll("[id], a[name]")) anchors[a.getAttribute("id") || a.getAttribute("name")] = cur;
        continue;
      }
      if (!BLOCKS.has(tag) && !n.querySelector(blockSelector)) { noteAll(n); para.push(inlineHtml(wrapOne(n))); continue; }
      flush();
      if (CONTAINERS.has(tag) || ((tag === "P" || tag === "TABLE") && n.querySelector(blockSelector))) noteAnchor(n);
      else noteAll(n);
      switch (tag) {
        case "P": case "ADDRESS": case "SUMMARY": {
          if (n.querySelector(blockSelector)) { walk(n); break; }
          para.push(inlineHtml(n));
          flush();
          break;
        }
        case "UL": case "OL": {
          const items = listItems(n, 0);
          if (items.length) cur.blocks.push({ type: "list", ordered: tag === "OL", items });
          break;
        }
        case "DL": {
          const items = [];
          let term = "";
          for (const c of n.children) {
            if (c.tagName === "DT") term = cleanInline(inlineHtml(c));
            else if (c.tagName === "DD") {
              const dd = cleanInline(inlineHtml(c));
              const html = term ? `<strong>${term}</strong> ${dd}` : dd;
              items.push({ html, text: decode(stripTags(html)), depth: 0 });
              term = "";
            }
          }
          if (items.length) cur.blocks.push({ type: "list", ordered: false, items, plain: true });
          break;
        }
        case "TABLE": {
          if (n.querySelector("table, p, div, h1, h2, h3, h4, h5, h6, ul, ol, pre")) { walkTable(n); break; }
          const rows = [];
          let head = false;
          for (const tr of n.querySelectorAll("tr")) {
            const cells = [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH");
            if (!cells.length) continue;
            if (!rows.length && (tr.parentElement.tagName === "THEAD" || cells.every((c) => c.tagName === "TH"))) head = true;
            rows.push(cells.map((c) => { const html = cleanInline(inlineHtml(c)); return { html, text: decode(stripTags(html)) }; }));
          }
          if (rows.length) cur.blocks.push({ type: "table", head, rows });
          break;
        }
        case "PRE": {
          const lines = n.textContent.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "").split("\n");
          if (lines.some((l) => l.trim())) cur.blocks.push({ type: "pre", lines });
          break;
        }
        case "BLOCKQUOTE": {
          const html = cleanInline(inlineHtml(n));
          if (html) cur.blocks.push({ type: "quote", html, text: decode(stripTags(html)) });
          break;
        }
        case "IMG": pushImg(n); break;
        case "FIGURE": {
          for (const img of n.querySelectorAll("img")) pushImg(img, n.querySelector("figcaption"));
          break;
        }
        case "HR": break;
        default: walk(n);
      }
      flush();
    }
  };
  const walkTable = (t) => { for (const cell of t.querySelectorAll(":scope > * > tr > td, :scope > * > tr > th, :scope > tr > td")) { walk(cell); flush(); } };
  const pushImg = (img, cap) => {
    const src = img.getAttribute("src") || "";
    if (!/^(https?:|data:image\/)/i.test(src)) return;
    const caption = cap ? textOf(cap) : "";
    cur.blocks.push({ type: "img", src, alt: img.getAttribute("alt") || caption || "", caption, text: caption || img.getAttribute("alt") || "" });
  };

  walk(root);
  flush();

  // Route keys: the section number when unique, otherwise the id.
  const keys = new Set();
  for (const s of sections) {
    s.key = s.num && !keys.has(s.num) ? s.num : s.id;
    keys.add(s.key);
  }
  const anchorKeys = {};
  for (const [id, s] of Object.entries(anchors)) anchorKeys[id] = s.key;
  return { title, author: "", width: 0, sections, anchors: anchorKeys };
}

const blockSelector = "p,ul,ol,table,pre,blockquote,dl,figure,h1,h2,h3,h4,h5,h6,div,section,article,hr";
const wrapOne = (n) => { const d = n.ownerDocument.createElement("span"); d.appendChild(n.cloneNode(true)); return d; };
const stripTags = (h) => squash(h.replace(/<br>/g, " ").replace(/<[^>]+>/g, "")).trim();
function decode(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function listItems(list, depth) {
  const items = [];
  for (const li of list.children) {
    if (li.tagName !== "LI") continue;
    const copy = li.cloneNode(true);
    const nested = [...copy.querySelectorAll(":scope > ul, :scope > ol")];
    nested.forEach((x) => x.remove());
    const html = cleanInline(inlineHtml(copy));
    if (html) items.push({ html, text: decode(stripTags(html)), depth });
    for (const sub of li.querySelectorAll(":scope > ul, :scope > ol")) items.push(...listItems(sub, depth + 1));
  }
  return items;
}

/* ---------------- clean copy ---------------- */

// A compact, standalone HTML copy of just the guide content, kept as the stored master and
// offered by "Save a copy". Only structural tags and a few attributes survive.
const KEEP = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD",
  "PRE", "BLOCKQUOTE", "DL", "DT", "DD", "FIGURE", "FIGCAPTION", "IMG", "HR", "BR", "STRONG", "B", "EM", "I", "CODE", "KBD",
  "SUP", "SUB", "A", "SECTION", "ARTICLE", "DIV"]);
const ATTRS = { A: ["href", "name", "id"], IMG: ["src", "alt"], TD: ["colspan", "rowspan"], TH: ["colspan", "rowspan"] };

function serialize(node) {
  let out = "";
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += esc(n.nodeValue); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (!KEEP.has(tag)) { out += serialize(n); continue; }
    const t = tag.toLowerCase();
    let attrs = "";
    const id = n.getAttribute("id");
    if (id) attrs += ` id="${esc(id)}"`;
    for (const a of ATTRS[tag] || []) {
      if (a === "id") continue;
      let v = n.getAttribute(a);
      if (v === null) continue;
      if (a === "href") { v = safeHref(v); if (!v) continue; }
      if (a === "src" && !/^(https?:|data:image\/)/i.test(v)) continue;
      attrs += ` ${a}="${esc(v)}"`;
    }
    if (tag === "BR" || tag === "HR" || tag === "IMG") out += `<${t}${attrs}>`;
    else out += `<${t}${attrs}>${serialize(n)}</${t}>`;
    if (/^(P|H\d|LI|TR|TABLE|UL|OL|PRE|BLOCKQUOTE|DIV|SECTION|DL|DD|DT)$/.test(tag)) out += "\n";
  }
  return out;
}

function cleanDocument(root, title) {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title></head>\n<body>\n${serialize(root).replace(/\n{3,}/g, "\n\n")}</body></html>\n`;
}
