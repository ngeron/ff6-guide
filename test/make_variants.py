#!/usr/bin/env python3
"""Writes the Ember Crown test guide in other formats, to test the importers.

Reads test/fixtures/ember-crown-guide.txt and writes to test/fixtures/variants/:
  ember-crown-formatted.html   a formatted HTML guide inside a busy web page (menus, sidebar, footer)
  ember-crown.webarchive       the same page as a Safari web archive (binary plist)
  ember-crown.md               Markdown, with a contents list linking to headings
  ember-crown-pre.html         the plain-text guide shown in <pre> blocks on a web page

The conversion is written independently of the app's importers, so the tests compare two
separate readings of the same guide. Usage: python3 test/make_variants.py
"""
import html
import plistlib
import re
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "fixtures" / "ember-crown-guide.txt"
OUT = HERE / "fixtures" / "variants"

STARS = re.compile(r"^\s*\*{8,}\s*$")
DASHES = re.compile(r"^\s*-{10,}\s*$")
TOCLINE = re.compile(r"^\s{0,3}(\d+\.\d+(?:\.\d+)?)\s+(\S.*)$")
ALIGNED = re.compile(r"\S {3,}\S")
LABEL = re.compile(r"^([A-Z][A-Za-z' ]{1,30}):\s+(.*)$")
W = 79


def esc(s):
    return html.escape(s, quote=True)


def gh_slug(text):
    s = text.strip().lower()
    s = re.sub(r"[^\w\- ]", "", s)
    return s.replace(" ", "-")


def read_guide():
    lines = SRC.read_text().split("\n")
    sections, cur = [], {"num": "", "title": "", "body": []}
    i = 0
    while i < len(lines):
        l = lines[i]
        if i + 1 < len(lines) and l.strip() and STARS.match(lines[i + 1]):
            m = re.match(r"^\s*(\d+(?:\.\d+)*)\s+(.*)$", l)
            sections.append(cur)
            cur = {"num": m.group(1) if m else "", "title": (m.group(2) if m else l).strip(), "body": []}
            i += 2
            continue
        if DASHES.match(l):
            i += 1
            continue
        cur["body"].append(l)
        i += 1
    sections.append(cur)
    front = sections[0]
    return front, sections[1:]


def groups(body):
    out, g = [], []
    for l in body:
        if l.strip():
            g.append(l)
        elif g:
            out.append(g)
            g = []
    if g:
        out.append(g)
    return out


def join(lines):
    text = ""
    for l in lines:
        t = l.strip()
        if text.endswith("-") and not text.endswith("--") and t[:1].isalpha():
            text += t
        else:
            text = (text + " " + t).strip()
    return text


def classify(g):
    """Returns a list of (kind, data) items for one group of lines."""
    toc = [TOCLINE.match(l) for l in g]
    if sum(1 for m in toc if m) >= 2 and sum(1 for m in toc if m) >= len(g) * 0.6:
        entries = []
        for l, m in zip(g, toc):
            if m:
                entries.append([m.group(1), m.group(2).strip()])
            elif entries:
                entries[-1][1] += " " + l.strip()
        return [("toc", entries)]
    if len(g) >= 2 and all(2 <= len(l) - len(l.lstrip()) <= 4 for l in g) and g[0].strip().endswith(":"):
        return [("box", (g[0].strip()[:-1], join(g[1:])))]
    items, para, i = [], [], 0

    def flush():
        if para:
            items.append(("p", join(para)))
            para.clear()

    while i < len(g):
        l = g[i]
        if ALIGNED.search(l.strip()):
            flush()
            rows = []
            while i < len(g) and ALIGNED.search(g[i].strip()):
                rows.append(re.split(r"\s{2,}", g[i].strip()))
                i += 1
            items.append(("table", rows))
            continue
        if len(l) - len(l.lstrip()) >= 5:
            flush()
            opts = []
            prev = ""
            while i < len(g) and len(g[i]) - len(g[i].lstrip()) >= 5:
                if opts and len(prev) > W * 0.72:
                    opts[-1] = join([opts[-1], g[i]])
                else:
                    opts.append(g[i].strip())
                prev = g[i]
                i += 1
            items.append(("ul", opts))
            continue
        para.append(l)
        # A short line ends the paragraph (lists, labels, dialogue).
        if len(l) < W * 0.72 or (i + 1 < len(g) and LABEL.match(g[i + 1].strip())):
            flush()
        i += 1
    flush()
    # Runs of short single-line paragraphs become a list (formations, stat blocks).
    merged, run = [], []
    for kind, data in items:
        if kind == "p" and len(data) < 70 and not LABEL.match(data) or (kind == "p" and run and len(data) < 90 and LABEL.match(data) and run):
            run.append(data)
            continue
        if run:
            merged.extend([("p", run[0])] if len(run) == 1 else [("list", run)])
            run = []
        merged.append((kind, data))
    if run:
        merged.extend([("p", run[0])] if len(run) == 1 else [("list", run)])
    return merged


def html_inline(t):
    h = esc(t)
    h = re.sub(r"(^|\s)_([A-Za-z_]+?)_(?=[\s.,;:!?]|$)", lambda m: m.group(1) + "<em>" + m.group(2).replace("_", " ") + "</em>", h)
    h = re.sub(r"(^|\s)\*([^*\s][^*]*?)\*(?=[\s.,;:!?]|$)", r"\1<em>\2</em>", h)
    h = re.sub(r"(https?://[^\s<]+[^\s<.,;:)])", r'<a href="\1">\1</a>', h)
    m = LABEL.match(t)
    if m:
        h = f"<strong>{esc(m.group(1))}:</strong> " + html_inline_plain(m.group(2))
    return h


def html_inline_plain(t):
    h = esc(t)
    h = re.sub(r"(^|\s)_([A-Za-z_]+?)_(?=[\s.,;:!?]|$)", lambda m: m.group(1) + "<em>" + m.group(2).replace("_", " ") + "</em>", h)
    h = re.sub(r"(^|\s)\*([^*\s][^*]*?)\*(?=[\s.,;:!?]|$)", r"\1<em>\2</em>", h)
    return re.sub(r"(https?://[^\s<]+[^\s<.,;:)])", r'<a href="\1">\1</a>', h)


def sid(num, title):
    return "s-" + num.replace(".", "-") if num else re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def to_html(front, sections):
    out = []
    fg = groups(front["body"])
    title = fg[0][0].strip()
    out.append(f"<h1>{esc(title)}</h1>")
    out.append(f"<p class=\"byline\">{'<br>'.join(esc(l.strip()) for l in fg[0][1:])}</p>")
    for g in fg[1:]:
        if g[0].strip() == "Contents" or g[0].strip().startswith("No number"):
            continue
        for kind, data in classify(g):
            out.extend(render_html(kind, data))
    for s in sections:
        tag = "h2" if re.fullmatch(r"\d+\.0", s["num"]) or not s["num"] else "h3"
        out.append(f'<{tag} id="{sid(s["num"], s["title"])}">{esc(s["num"] + " " if s["num"] else "")}{esc(s["title"])}</{tag}>')
        for g in groups(s["body"]):
            for kind, data in classify(g):
                out.extend(render_html(kind, data))
    return title, "\n".join(out)


def render_html(kind, data):
    if kind == "p":
        if data.endswith(":") and len(data) < 48:
            return [f"<p><strong>{esc(data)}</strong></p>"]
        return [f"<p>{html_inline(data)}</p>"]
    if kind == "box":
        return [f'<p class="box"><strong>{esc(data[0])}:</strong> {html_inline_plain(data[1])}</p>']
    if kind == "toc":
        return ["<ol class=\"contents\">" + "".join(f'<li><a href="#{sid(n, t)}">{esc(n)} {esc(t)}</a></li>' for n, t in data) + "</ol>"]
    if kind == "table":
        width = max(len(r) for r in data)
        head = ["Item", "Price"] if width == 2 else (data[0] if width == 3 else None)
        body = data if width != 3 else data[1:]
        h = "<table>"
        if head:
            h += "<thead><tr>" + "".join(f"<th>{esc(c)}</th>" for c in head) + "</tr></thead>"
        h += "<tbody>" + "".join("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in r) + "</tr>" for r in body) + "</tbody></table>"
        return [h]
    if kind == "ul":
        return ["<ul>" + "".join(f"<li>{esc(o)}</li>" for o in data) + "</ul>"]
    if kind == "list":
        first, rest = data[0], data[1:]
        if rest and rest[0].startswith("Level:"):
            return [f"<p><strong>{esc(first)}</strong></p>", "<ul>" + "".join(f"<li>{html_inline(x)}</li>" for x in rest) + "</ul>"]
        if first.endswith(":"):
            return [f"<p><strong>{esc(first)}</strong></p>", "<ul>" + "".join(f"<li>{html_inline(x)}</li>" for x in rest) + "</ul>"]
        return ["<ul>" + "".join(f"<li>{html_inline(x)}</li>" for x in data) + "</ul>"]
    return []


PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title} - Guide and Walkthrough - GuideSite</title>
<style>body{{font-family:sans-serif}} .ad{{height:250px}}</style>
<script>window.analytics = {{ track: function () {{}} }};</script>
</head>
<body>
<header class="site">
  <a href="/">GuideSite</a>
  <nav><ul><li><a href="/boards">Boards</a></li><li><a href="/guides">Guides</a></li><li><a href="/news">News</a></li>
  <li><a href="/qa">Q&amp;A</a></li><li><a href="/login">Log In</a></li><li><a href="/signup">Sign Up</a></li></ul></nav>
</header>
<div class="layout">
  <aside class="sidebar">
    <h4>More guides</h4>
    <ul><li><a href="/g/1">Speedrun notes</a></li><li><a href="/g/2">Achievement list</a></li><li><a href="/g/3">Boss checklist</a></li></ul>
    <div class="ad">Advertisement</div>
  </aside>
  <div id="content">
    <div class="breadcrumbs"><a href="/">Home</a> &gt; <a href="/ember">The Ember Crown</a> &gt; Guides</div>
    <article class="guide">
{body}
    </article>
    <div class="rating">Was this guide helpful? <a href="/vote/yes">Yes</a> <a href="/vote/no">No</a></div>
  </div>
</div>
<footer><p>&copy; GuideSite. <a href="/terms">Terms</a> <a href="/privacy">Privacy</a></p></footer>
</body>
</html>
"""

PRE_PAGE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>The Ember Crown - Walkthrough - GuideSite</title></head>
<body>
<header><nav><a href="/">GuideSite</a> <a href="/boards">Boards</a> <a href="/guides">Guides</a> <a href="/login">Log In</a></nav></header>
<main>
<h1>The Ember Crown &ndash; Guide and Walkthrough</h1>
<p class="meta">Version: 1.3 | Updated: 03/02/2011</p>
<div id="faqwrap">
{pres}
</div>
<p>Was this guide helpful? <a href="/vote/yes">Yes</a> <a href="/vote/no">No</a></p>
</main>
<footer><a href="/terms">Terms</a></footer>
</body></html>
"""


def to_markdown(front, sections):
    out = []
    fg = groups(front["body"])
    out.append("# " + fg[0][0].strip())
    out.append("")
    out.append("  \n".join(l.strip() for l in fg[0][1:]))
    out.append("")

    def md_inline(t):
        t = re.sub(r"(^|\s)_([A-Za-z_]+?)_(?=[\s.,;:!?]|$)", lambda m: m.group(1) + "*" + m.group(2).replace("_", " ") + "*", t)
        m = LABEL.match(t)
        if m:
            t = f"**{m.group(1)}:** {m.group(2)}"
        return t

    def emit(kind, data):
        if kind == "p":
            out.append(f"**{data}**" if data.endswith(":") and len(data) < 48 else md_inline(data))
        elif kind == "box":
            out.append(f"**{data[0]}:** {data[1]}")
        elif kind == "toc":
            for n, t in data:
                out.append(f"- [{n} {t}](#{gh_slug(n + ' ' + t)})")
        elif kind == "table":
            width = max(len(r) for r in data)
            head = ["Item", "Price"] if width == 2 else data[0]
            body = data if width == 2 else data[1:]
            out.append("| " + " | ".join(head) + " |")
            out.append("|" + "---|" * len(head))
            for r in body:
                out.append("| " + " | ".join(r + [""] * (len(head) - len(r))) + " |")
        elif kind == "ul":
            out.extend(f"- {o}" for o in data)
        elif kind == "list":
            first, rest = data[0], data[1:]
            if rest and (rest[0].startswith("Level:") or first.endswith(":")):
                out.append(f"**{first}**")
                out.append("")
                out.extend(f"- {md_inline(x)}" for x in rest)
            else:
                out.extend(f"- {md_inline(x)}" for x in data)
        out.append("")

    for g in fg[1:]:
        if g[0].strip() == "Contents" or g[0].strip().startswith("No number"):
            continue
        for kind, data in classify(g):
            emit(kind, data)
    for s in sections:
        hashes = "##" if re.fullmatch(r"\d+\.0", s["num"]) or not s["num"] else "###"
        out.append(f"{hashes} {s['num'] + ' ' if s['num'] else ''}{s['title']}")
        out.append("")
        for g in groups(s["body"]):
            for kind, data in classify(g):
                emit(kind, data)
    return "\n".join(out).rstrip() + "\n"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    front, sections = read_guide()
    title, body = to_html(front, sections)
    page = PAGE.format(title=esc(title), body=body)
    (OUT / "ember-crown-formatted.html").write_text(page)
    archive = {
        "WebMainResource": {
            "WebResourceData": page.encode("utf-8"),
            "WebResourceFrameName": "",
            "WebResourceMIMEType": "text/html",
            "WebResourceTextEncodingName": "UTF-8",
            "WebResourceURL": "https://guides.example.com/ember-crown/walkthrough",
        },
        "WebSubresources": [],
    }
    (OUT / "ember-crown.webarchive").write_bytes(plistlib.dumps(archive, fmt=plistlib.FMT_BINARY))
    (OUT / "ember-crown.md").write_text(to_markdown(front, sections))
    text = SRC.read_text()
    parts = text.split("\n")
    n = len(parts)
    chunks = ["\n".join(parts[: n // 3]), "\n".join(parts[n // 3: 2 * n // 3]), "\n".join(parts[2 * n // 3:])]
    (OUT / "ember-crown-pre.html").write_text(PRE_PAGE.format(pres="\n".join(f"<pre>{esc(c)}</pre>" for c in chunks)))
    for f in sorted(OUT.iterdir()):
        print(f"wrote {f} ({f.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
