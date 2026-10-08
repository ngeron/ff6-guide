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

// link(num) returns an href for a section number, or null.
export function renderBlocks(blocks, link) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "p") {
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

export function renderHeading(s) {
  if (s.level === 1) {
    return `<header class="titlepage"><h1>${inline(s.title)}</h1>` +
      (s.subtitle && s.subtitle.length ? `<p class="sub">${s.subtitle.map(inline).join("<br>")}</p>` : "") + "</header>";
  }
  return `<h1 class="sec-h">${s.num ? `<span class="num">${esc(s.num)}</span>` : ""}<span>${inline(s.title)}</span></h1>`;
}
