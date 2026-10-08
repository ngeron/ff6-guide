// Rebuilds the guide's fixed-width text lines from a PDF of the GameFAQs page.
// The guide is set in a monospace font; everything else on the page (site menus,
// ads, footers) is in other fonts or sizes and gets dropped.

import { normSpace } from "./parse.js";

function mode(map) {
  let best = null, bw = -1;
  for (const [k, w] of map) if (w > bw) { bw = w; best = k; }
  return best;
}

function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

// pages: array of arrays of { str, x, y, w, size, font }
export function linesFromItems(pages) {
  // Dominant monospace style: (advance per character / font size, font size).
  const combo = new Map();
  for (const items of pages) {
    for (const it of items) {
      const len = it.str.length;
      const nonSpace = it.str.replace(/\s/g, "").length;
      if (len < 4 || nonSpace < 3 || !it.size || !it.w) continue;
      it.ratio = it.w / (len * it.size);
      const key = (Math.round(it.ratio * 200) / 200).toFixed(3) + "|" + Math.round(it.size * 4) / 4;
      combo.set(key, (combo.get(key) || 0) + len);
    }
  }
  if (!combo.size) return [];
  const [rs, ss] = mode(combo).split("|");
  const R = parseFloat(rs), S = parseFloat(ss);
  // Character width: median advance per character over long runs in the dominant style.
  const perChar = [];
  for (const items of pages) {
    for (const it of items) {
      if (it.ratio && it.str.length >= 10 && Math.abs(it.ratio - R) < 0.008 && Math.abs(it.size - S) < S * 0.04) perChar.push(it.w / it.str.length);
    }
  }
  const cw = median(perChar) || R * S;

  const fonts = new Set();
  for (const items of pages) {
    for (const it of items) {
      if (it.ratio && Math.abs(it.ratio - R) < 0.008 && Math.abs(it.size - S) < S * 0.04) fonts.add(it.font);
    }
  }
  const keep = (it) => {
    if (!it.size || Math.abs(it.size - S) > S * 0.04) return false;
    if (fonts.has(it.font)) return true;
    return !!(it.ratio && Math.abs(it.ratio - R) < 0.008);
  };

  // Left margin of the text column, voted across pages.
  const lefts = new Map();
  const kept = pages.map((items) => {
    const k = items.filter(keep);
    let minx = Infinity;
    for (const it of k) {
      const lead = it.str.length - it.str.replace(/^ +/, "").length;
      minx = Math.min(minx, it.x + lead * cw);
    }
    if (k.length > 5 && isFinite(minx)) {
      const key = Math.round(minx);
      lefts.set(key, (lefts.get(key) || 0) + 1);
    }
    return k;
  });
  let left = 0;
  if (lefts.size) {
    const top = lefts.get(mode(lefts));
    left = Math.min(...[...lefts.keys()].filter((k) => lefts.get(k) >= Math.max(1, top * 0.2)));
  }

  // Group items into lines on each page.
  const pageLines = kept.map((items) => {
    const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const lines = [];
    for (const it of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) < S * 0.4) last.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    return lines;
  });

  const gaps = [];
  for (const lines of pageLines) for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
  const LH = median(gaps.filter((g) => g > S * 0.6)) || S * 1.2;

  // Blank lines that fell on a page break show up as a short page bottom or a low page top.
  const full = pageLines.filter((l) => l.length > 3);
  const tops = new Map(), bottoms = new Map();
  for (const l of full.slice(1)) { const k = Math.round(l[0].y); tops.set(k, (tops.get(k) || 0) + 1); }
  for (const l of full.slice(0, -1)) { const k = Math.round(l[l.length - 1].y); bottoms.set(k, (bottoms.get(k) || 0) + 1); }
  const topY = tops.size ? Math.max(...[...tops.keys()].filter((k) => tops.get(k) >= 2)) : null;
  const bottomY = bottoms.size ? Math.min(...[...bottoms.keys()].filter((k) => bottoms.get(k) >= 2)) : null;

  const out = [];
  pageLines.forEach((lines, p) => {
    if (!lines.length) return;
    if (p > 0 && out.length && out[out.length - 1] !== "") {
      const prev = pageLines.slice(0, p).reverse().find((l) => l.length);
      const shortBottom = bottomY !== null && isFinite(bottomY) && prev && prev[prev.length - 1].y - bottomY > LH * 0.8;
      const lowTop = topY !== null && isFinite(topY) && topY - lines[0].y > LH * 0.8;
      if (shortBottom || lowTop) out.push("");
    }
    lines.forEach((ln, i) => {
      if (i > 0 && lines[i - 1].y - ln.y > LH * 1.5) out.push("");
      const chars = [];
      for (const it of ln.items.sort((a, b) => a.x - b.x)) {
        let str = it.str;
        // Text extraction sometimes collapses runs of spaces; restore them from the item width.
        const missing = it.w / cw - str.length;
        const extra = Math.round(missing);
        if (missing > 0.75 && extra > 0 && str.indexOf(" ") > 0) {
          const p = str.lastIndexOf(" ");
          str = str.slice(0, p) + " ".repeat(extra + 1) + str.slice(p + 1);
        }
        const col = Math.max(0, Math.round((it.x - left) / cw));
        while (chars.length < col) chars.push(" ");
        for (let c = 0; c < str.length; c++) {
          if (chars.length > col + c) { if (str[c] !== " ") chars[col + c] = str[c]; }
          else chars.push(str[c]);
        }
      }
      out.push(chars.join("").replace(/\s+$/, ""));
    });
  });
  return out;
}

let pdfjs = null;
async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

// Returns the guide as an array of text lines.
export async function linesFromPdf(arrayBuffer, onProgress) {
  const lib = await loadPdfJs();
  const task = lib.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  const pdf = await task.promise;
  const pages = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (typeof it.str !== "string") continue;
        const str = normSpace(it.str);
        if (!str.trim()) continue;
        const t = it.transform;
        const size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
        items.push({ str, x: t[4], y: t[5], w: it.width, size, font: it.fontName });
      }
      pages.push(items);
      page.cleanup();
      if (onProgress) onProgress(p, pdf.numPages);
    }
  } finally {
    task.destroy();
  }
  return { lines: linesFromItems(pages), pages: pages.length };
}
