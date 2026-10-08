// Markdown importer: converts Markdown to HTML, then uses the HTML importer.
// Covers what guides need: headings (# and underlined), paragraphs, lists (nested by indent),
// fenced and indented code, pipe tables, block quotes, rules, emphasis, code spans, links,
// images and autolinks.

import { importHtml } from "./html.js";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s) {
  const codes = [];
  let h = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  h = esc(h);
  h = h.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '<img src="$2" alt="$1">');
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '<a href="$2">$1</a>');
  h = h.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
  h = h.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>");
  h = h.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1<em>$2</em>");
  h = h.replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1<em>$2</em>");
  h = h.replace(/ {2,}\n/g, "<br>\n").replace(/\\\n/g, "<br>\n");
  return h.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[+i])}</code>`);
}

const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ATX = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;

const startsBlock = (l, next) => ATX.test(l) || FENCE.test(l) || RULE.test(l) || QUOTE.test(l) || LIST.test(l) ||
  (l.includes("|") && next !== undefined && TABLE_SEP.test(next));

// Heading ids follow GitHub's rule, so contents links like [3.1.1 Harrowgate](#311-harrowgate) work.
let usedIds = new Map();
function headingId(text) {
  const base = text.replace(/<[^>]+>/g, "").trim().toLowerCase().replace(/&[a-z]+;|&#\d+;/g, "").replace(/[^\p{L}\p{N}\- _]/gu, "").replace(/ /g, "-");
  const n = usedIds.get(base) || 0;
  usedIds.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}
const heading = (n, html) => `<h${n} id="${headingId(html)}">${html}</h${n}>`;

export function markdownToHtml(src) {
  usedIds = new Map();
  const lines = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return blocks(lines);
}

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(FENCE))) {
      const fence = m[1];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence)) body.push(lines[i++]);
      i++;
      out.push(`<pre>${esc(body.join("\n"))}</pre>`);
      continue;
    }
    if ((m = l.match(ATX))) {
      const n = m[1].length;
      out.push(heading(n, inline(m[2])));
      i++;
      continue;
    }
    if (RULE.test(l)) { out.push("<hr>"); i++; continue; }
    if (QUOTE.test(l)) {
      const body = [];
      while (i < lines.length && lines[i].trim() && (m = lines[i].match(QUOTE) || [null, lines[i]])) { body.push(m[1]); i++; }
      out.push(`<blockquote>${blocks(body)}</blockquote>`);
      continue;
    }
    if (l.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, "|")));
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>` +
        rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") + "</tbody></table>");
      continue;
    }
    if (LIST.test(l)) {
      const items = [];
      while (i < lines.length) {
        const lm = lines[i].match(LIST);
        if (lm) { items.push({ indent: lm[1].length, ordered: /\d/.test(lm[2]), text: lm[3] }); i++; continue; }
        if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1].text += " " + lines[i].trim(); i++; continue; }
        if (!lines[i].trim() && i + 1 < lines.length && LIST.test(lines[i + 1])) { i++; continue; }
        break;
      }
      out.push(renderList(items));
      continue;
    }
    if (/^ {4,}\S/.test(l)) {
      const body = [];
      while (i < lines.length && (/^ {4,}/.test(lines[i]) || (!lines[i].trim() && i + 1 < lines.length && /^ {4,}\S/.test(lines[i + 1])))) body.push(lines[i++].slice(4));
      out.push(`<pre>${esc(body.join("\n"))}</pre>`);
      continue;
    }
    // Paragraph, or a heading underlined with === / ---.
    const para = [l];
    i++;
    while (i < lines.length && lines[i].trim()) {
      if (/^ {0,3}=+\s*$/.test(lines[i])) { out.push(heading(1, inline(para.join(" ").trim()))); para.length = 0; i++; break; }
      if (/^ {0,3}-+\s*$/.test(lines[i]) && para.length === 1) { out.push(heading(2, inline(para[0].trim()))); para.length = 0; i++; break; }
      if (startsBlock(lines[i], lines[i + 1])) break;
      para.push(lines[i++]);
    }
    if (para.length) out.push(`<p>${inline(para.join("\n").trim())}</p>`);
  }
  return out.join("\n");
}

function renderList(items) {
  let html = "";
  const stack = [];
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`;
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      const tag = it.ordered ? "ol" : "ul";
      stack.push({ indent: it.indent, tag });
      html += `<${tag}><li>`;
    } else html += "</li><li>";
    html += inline(it.text);
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

export function importMarkdown(src) {
  const r = importHtml(`<!doctype html><html><body><article>${markdownToHtml(src)}</article></body></html>`);
  return { format: "markdown", text: src, doc: r.doc };
}
