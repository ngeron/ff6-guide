// Turns the guide's plain text (79-column GameFAQs format) into a structured document.
//
// Document shape:
//   { title, author, width, sections: [Section] }
//   Section = { key, num, title, level, id, blocks: [Block], subtitle? }
//     level 1 = front matter / title page, 2 = chapter (1.0, 4.0, Foreword), 3 = subsection (4.15.2)
//   Block = { type: "p", text, indent }
//         | { type: "lines", items: [{ text, indent }] }   short lines kept as separate rows
//         | { type: "pre", lines: [string] }                column-aligned tables (shops, charts)
//         | { type: "meta", label, text }                   indented info boxes ("Opponents:")
//         | { type: "toc", entries: [{ num, text }] }       tables of contents

const DIVIDER = /^\s*([*\-=_~#])\1{9,}\s*$/;
const STARS = /^\s*\*{8,}\s*$/;
const TOCLINE = /^\s{0,3}(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(\S.*)$/;
const ALIGNED = /\S {3,}\S/;

export function normSpace(s) {
  return s.replace(/[     ]/g, " ").replace(/\t/g, "    ").replace(/\r$/, "");
}

function textWidth(lines) {
  const lens = lines.map((l) => l.length).filter((n) => n > 20).sort((a, b) => a - b);
  if (!lens.length) return 79;
  return lens[Math.floor(lens.length * 0.985)] || 79;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "section";
}

const indentOf = (s) => s.length - s.replace(/^ +/, "").length;
const firstWord = (s) => s.trim().split(/\s+/)[0] || "";

export function parse(text) {
  const lines = (Array.isArray(text) ? text : text.split("\n")).map((l) => normSpace(l).replace(/\s+$/, ""));
  const W = textWidth(lines);
  const used = new Set();
  const uniq = (id) => { let out = id, n = 2; while (used.has(out)) out = `${id}-${n++}`; used.add(out); return out; };

  // A heading is a text line immediately followed by a line of asterisks.
  const heads = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() && !DIVIDER.test(lines[i]) && STARS.test(lines[i + 1])) heads.push(i);
  }
  const headSet = new Set(heads);
  const skip = new Set();
  for (const h of heads) {
    skip.add(h + 1);
    if (h > 0 && DIVIDER.test(lines[h - 1])) skip.add(h - 1);
  }

  const makeSection = (heading) => {
    const m = heading.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)$/);
    const num = m ? m[1] : "";
    const title = m ? m[2].trim() : heading;
    const level = !num || /^\d+(\.0)?$/.test(num) ? 2 : 3;
    return { num, title, level, id: uniq(num ? "s" + num.replace(/\./g, "-") : slug(title)), body: [] };
  };

  const front = { num: "", title: "", level: 1, id: uniq("start"), body: [] };
  const sections = [];
  let cur = front;
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    if (headSet.has(i)) {
      cur = makeSection(lines[i].trim());
      sections.push(cur);
      continue;
    }
    cur.body.push(DIVIDER.test(lines[i]) ? "" : lines[i]);
  }

  // Title page from the front matter.
  const fb = front.body;
  while (fb.length && !fb[0].trim()) fb.shift();
  const title = fb.length ? fb.shift().trim() : "Guide";
  front.title = title;
  const subtitle = [];
  while (fb.length && fb[0].trim()) subtitle.push(fb.shift().trim());
  front.subtitle = subtitle;

  const all = [front, ...sections];
  const keys = new Set();
  for (const s of all) {
    s.blocks = blocksFrom(s.body, W);
    delete s.body;
    // Route key: the section number when unique, otherwise the element id.
    s.key = s.num && !keys.has(s.num) ? s.num : s.id;
    keys.add(s.key);
  }

  let author = "";
  for (const l of subtitle) {
    const m = l.match(/^([^,]{2,40}),\s+[A-Z][a-z]+ \d{4}$/);
    if (m && !author) author = m[1];
  }
  return { title, author, sections: all, width: W };
}

function isWrapped(a, b, W) {
  const len = a.length;
  const bt = b.trim();
  if (!bt) return false;
  // A line starting with a label ("Weakness:", "Locke:", "!Wing:") begins a new row, not a wrap.
  if (/^[A-Z!(][A-Za-z'\/ ()!.-]{0,30}:(\s|$)/.test(bt)) return false;
  if (len + 1 + firstWord(b).length > W - 3) return true;
  if (len >= W * 0.55 && /^[a-z(]/.test(bt)) return true;
  if (len >= W * 0.78 && !/[.!?:]["')\]]?$/.test(a)) return true;
  return false;
}

function joinLines(a, b) {
  const at = a.replace(/\s+$/, "");
  const bt = b.trim();
  if (/[A-Za-z]-$/.test(at) && !/--$/.test(at) && /^[A-Za-z]/.test(bt)) return at + bt;
  return at + " " + bt;
}

function blocksFrom(body, W) {
  const groups = [];
  let g = [];
  for (const l of body) {
    if (l.trim()) g.push(l);
    else if (g.length) { groups.push(g); g = []; }
  }
  if (g.length) groups.push(g);

  const blocks = [];
  for (const grp of groups) {
    // Table of contents.
    const tocHits = grp.filter((l) => TOCLINE.test(l)).length;
    if ((tocHits >= 3 && tocHits >= grp.length * 0.6) || (tocHits >= 2 && tocHits === grp.length)) {
      const entries = [];
      for (const l of grp) {
        const m = l.match(TOCLINE);
        const last = entries[entries.length - 1];
        if (m) entries.push({ num: m[1], text: m[2].trim() });
        else if (last && last.num && indentOf(l) >= 4) last.text += " " + l.trim();
        else entries.push({ num: "", text: l.trim() });
      }
      blocks.push({ type: "toc", entries });
      continue;
    }

    // Indented info box ("  Opponents:" followed by an indented list).
    if (grp.length >= 2 && grp.every((l) => indentOf(l) >= 2 && indentOf(l) <= 4) &&
        /:$/.test(grp[0].trim()) && grp[0].trim().length < 40 && !grp.some((l) => ALIGNED.test(l.trim()))) {
      let txt = grp[1];
      for (let k = 2; k < grp.length; k++) txt = joinLines(txt, grp[k]);
      blocks.push({ type: "meta", label: grp[0].trim().replace(/:$/, ""), text: txt.trim() });
      continue;
    }

    const segs = [];
    let i = 0;
    while (i < grp.length) {
      const line = grp[i];
      if (ALIGNED.test(line.trim())) {
        const run = [];
        while (i < grp.length && ALIGNED.test(grp[i].trim())) run.push(grp[i++]);
        // Continuation lines hanging under an aligned row.
        while (i < grp.length && indentOf(grp[i]) >= 8 && !ALIGNED.test(grp[i].trim()) && grp[i].length < W * 0.6) run.push(grp[i++]);
        const ind = Math.min(...run.map(indentOf));
        segs.push({ type: "pre", lines: run.map((r) => r.slice(ind)) });
        continue;
      }
      let text = line, wrapped = false, last = line;
      i++;
      while (i < grp.length && !ALIGNED.test(grp[i].trim()) && isWrapped(last, grp[i], W)) {
        text = joinLines(text, grp[i]);
        last = grp[i];
        wrapped = true;
        i++;
      }
      segs.push({ type: "p", text: text.trim(), wrapped, indent: indentOf(line) >= 4 });
    }

    // Runs of short, unwrapped lines become a line list (stat blocks, item lists, dialogue).
    let j = 0;
    while (j < segs.length) {
      const s = segs[j];
      if (s.type === "p" && !s.wrapped) {
        const items = [];
        let jj = j;
        while (jj < segs.length && segs[jj].type === "p" && (!segs[jj].wrapped || items.length)) {
          if (segs[jj].wrapped && segs[jj].text.length > 160) break;
          items.push({ text: segs[jj].text, indent: segs[jj].indent });
          jj++;
        }
        if (items.length >= 2) { blocks.push({ type: "lines", items }); j = jj; continue; }
      }
      if (s.type === "p") blocks.push({ type: "p", text: s.text, indent: s.indent && !s.wrapped });
      else blocks.push(s);
      j++;
    }
  }
  return blocks;
}

// Plain text of a section, for search.
export function sectionText(s) {
  const parts = [s.title];
  for (const b of s.blocks) {
    if (b.type === "p") parts.push(b.text);
    else if (b.type === "lines") for (const it of b.items) parts.push(it.text);
    else if (b.type === "pre") parts.push(b.lines.join("\n"));
    else if (b.type === "meta") parts.push(b.label + ": " + b.text);
    else if (b.type === "toc") for (const e of b.entries) parts.push(e.num + " " + e.text);
  }
  return parts.join("\n");
}
