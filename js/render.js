// Renders parsed blocks to HTML strings.

export function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Light inline markup used in old text guides: _Final_Fantasy_VI_, *emphasis*, bare URLs.
export function inline(s) {
  let h = esc(s);
  h = h.replace(/(^|[\s(])_([A-Za-z0-9][A-Za-z0-9_']*?)_(?=[\s.,;:!?)]|$)/g, (m, a, b) => a + "<em>" + b.replace(/_/g, " ") + "</em>");
  h = h.replace(/(^|[\s("])\*([^*\s][^*]{0,40}?[^*\s]|[^*\s])\*(?=[\s.,;:!?)"]|$)/g, "$1<em>$2</em>");
  h = h.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  return h;
}

const LABEL = /^([A-Z][A-Za-z'\/ ]{1,30}?|\([A-Za-z]+\) [A-Za-z ]+|![A-Za-z ]+):(\s|$)/;

function labelled(s) {
  const m = s.match(LABEL);
  if (m) return "<strong>" + esc(m[1]) + ":</strong>" + inline(s.slice(m[1].length + 1));
  return inline(s);
}

// Sanitized inline HTML from the HTML importer: in-page links (#id) become links to the
// section that holds the target, and links to other sites open in a new tab.
function fixHtml(html, anchor) {
  return html.replace(/<a href="([^"]*)">/g, (m, href) => {
    if (href.startsWith("#")) {
      const to = anchor(decodeURIComponent(href.slice(1)).replace(/&amp;/g, "&"));
      return to ? `<a href="${to}">` : `<a class="deadlink">`;
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
  });
}

// link(num) returns an href for a section number; anchor(id) one for an element id. Either may return null.
export function renderBlocks(blocks, link, anchor = () => null) {
  const out = [];
  for (const b of blocks) {
    if (b.html !== undefined && (b.type === "p" || b.type === "quote")) {
      const h = fixHtml(b.html, anchor);
      out.push(b.type === "quote" ? `<blockquote>${h}</blockquote>` : `<p>${h}</p>`);
    } else if (b.type === "list") {
      out.push(renderList(b, anchor));
    } else if (b.type === "table") {
      const row = (r, th) => "<tr>" + r.map((c) => `<${th ? "th" : "td"}>${fixHtml(c.html, anchor)}</${th ? "th" : "td"}>`).join("") + "</tr>";
      const [first, ...rest] = b.rows;
      out.push(`<div class="tbl"><table>${b.head ? `<thead>${row(first, true)}</thead><tbody>${rest.map((r) => row(r)).join("")}` : `<tbody>${b.rows.map((r) => row(r)).join("")}`}</tbody></table></div>`);
    } else if (b.type === "img") {
      out.push(`<figure class="fig"><img src="${esc(b.src)}" alt="${esc(b.alt)}" loading="lazy" referrerpolicy="no-referrer">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`);
    } else if (b.type === "p") {
      const t = b.text;
      if (/:$/.test(t) && t.length <= 48 && !/[.!?]\s/.test(t)) out.push(`<p class="label">${inline(t)}</p>`);
      else out.push(`<p${b.indent ? ' class="ind"' : ""}>${labelled(t)}</p>`);
    } else if (b.type === "lines") {
      const rows = b.items.map((it, idx) => {
        const next = b.items[idx + 1];
        let body;
        if (idx === 0 && next && /^Level:/.test(next.text)) body = `<strong class="who">${inline(it.text)}</strong>`;
        else if (/:$/.test(it.text) && it.text.length <= 48) body = `<strong>${inline(it.text)}</strong>`;
        else body = labelled(it.text);
        return `<span class="row${it.indent ? " ind" : ""}">${body}</span>`;
      });
      out.push(`<p class="lines">${rows.join("")}</p>`);
    } else if (b.type === "pre") {
      out.push(`<div class="pre"><pre>${esc(b.lines.join("\n"))}</pre></div>`);
    } else if (b.type === "meta") {
      out.push(`<div class="meta"><span class="meta-k">${esc(b.label)}</span><span class="meta-v">${inline(b.text)}</span></div>`);
    } else if (b.type === "toc") {
      out.push('<ol class="toc">' + b.entries.map((e) => {
        const href = e.num ? link(e.num) : null;
        const inner = (e.num ? `<span class="n">${esc(e.num)}</span>` : "") + `<span class="t">${esc(e.text)}</span>`;
        return "<li>" + (href ? `<a href="${href}">${inner}</a>` : `<span class="nolink">${inner}</span>`) + "</li>";
      }).join("") + "</ol>");
    }
  }
  return out.join("\n");
}

function renderList(b, anchor) {
  // Items carry a nesting depth; rebuild the nested lists.
  const tag = b.ordered ? "ol" : "ul";
  let html = "", depth = -1;
  for (const it of b.items) {
    const d = Math.max(0, it.depth | 0);
    if (d > depth) {
      for (; depth < d; depth++) html += depth < 0 ? `<${tag} class="list${b.plain ? " plain" : ""}"><li>` : `<${tag}><li>`;
    } else {
      for (; depth > d; depth--) html += `</li></${tag}>`;
      html += "</li><li>";
    }
    html += fixHtml(it.html, anchor);
  }
  for (; depth >= 0; depth--) html += `</li></${tag}>`;
  return html;
}

export function renderHeading(s) {
  if (s.level === 1) {
    return `<header class="titlepage"><h1>${inline(s.title)}</h1>` +
      (s.subtitle && s.subtitle.length ? `<p class="sub">${s.subtitle.map(inline).join("<br>")}</p>` : "") + "</header>";
  }
  return `<h1 class="sec-h">${s.num ? `<span class="num">${esc(s.num)}</span>` : ""}<span>${inline(s.title)}</span></h1>`;
}
