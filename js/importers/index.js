// Importers turn a guide file into one shared document structure, which the reader, search,
// contents, progress and maps all work from. Each input format has its own importer:
//
//   text.js        fixed-width text guides (the classic GameFAQs format), and PDFs of them
//   html.js        saved web pages (.html); also detects text guides wrapped in <pre>
//   webarchive.js  Safari web archives, unwrapped to HTML
//   markdown.js    Markdown, converted to HTML
//
// Document:  { title, author, width, sections: [Section], anchors: { elementId: sectionKey } }
// Section:   { key, num, title, level, id, blocks: [Block], subtitle? }
//              level 1 = title page / front matter, 2 = chapter, 3 = subsection
// Blocks (every block that holds text also has a plain `text` for search, except where noted):
//   { type: "p", text, html?, indent? }               paragraph; html = sanitized inline markup
//   { type: "lines", items: [{ text, indent }] }       short lines kept as rows (text guides)
//   { type: "pre", lines: [string] }                   monospace block, alignment kept
//   { type: "meta", label, text }                      labelled info box ("Opponents:")
//   { type: "toc", entries: [{ num, text }] }          a table of contents inside the guide
//   { type: "list", ordered, items: [{ text, html, depth }] }
//   { type: "table", head, rows: [[{ text, html }]] }
//   { type: "quote", text, html }
//   { type: "img", src, alt, caption, text }
//
// A stored guide is { format: "text" | "html" | "markdown", text, name, source, importedAt },
// where `text` is the cleaned source in that format (the master copy the user can save).

import { parseText } from "./text.js";
import { importHtml } from "./html.js";
import { importMarkdown } from "./markdown.js";
import { webarchiveToHtml } from "./webarchive.js";

export const ACCEPT = ".pdf,.txt,.text,.html,.htm,.webarchive,.md,.markdown,application/pdf,text/plain,text/html,text/markdown";

const ext = (name) => (name.split(".").pop() || "").toLowerCase();

// What kind of file this is: "pdf", "text", "html", "webarchive" or "markdown".
export async function detectKind(file) {
  const e = ext(file.name);
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const sig = new TextDecoder("latin1").decode(head);
  if (sig.startsWith("%PDF")) return "pdf";
  if (sig.startsWith("bplist00")) return "webarchive";
  if (e === "md" || e === "markdown") return "markdown";
  if (e === "html" || e === "htm" || /^\s*(<!doctype html|<html|<head|<body)/i.test(sig.replace(/^﻿|^\xef\xbb\xbf/, ""))) return "html";
  if (e === "pdf") return "pdf";
  if (e === "webarchive") return "webarchive";
  return "text";
}

// Text in UTF-8, falling back to Windows-1252 for older guides.
export async function readText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Parse a stored guide by its format.
export function parseGuide(guide) {
  const format = guide.format || "text";
  if (format === "html") return importHtml(guide.text).doc;
  if (format === "markdown") return importMarkdown(guide.text).doc;
  return parseText(guide.text);
}

// Import one non-text file (web page, web archive or Markdown). Returns { format, text, doc }.
export async function importDocument(file, kind) {
  if (kind === "webarchive") return importHtml(webarchiveToHtml(await file.arrayBuffer()));
  if (kind === "html") return importHtml(await readText(file));
  if (kind === "markdown") return importMarkdown(await readText(file));
  throw new Error("unsupported");
}

export { parseText };

// Plain text of a section, for search.
export function sectionText(s) {
  const parts = [s.title];
  for (const b of s.blocks) {
    if (b.type === "lines") for (const it of b.items) parts.push(it.text);
    else if (b.type === "pre") parts.push(b.lines.join("\n"));
    else if (b.type === "meta") parts.push(b.label + ": " + b.text);
    else if (b.type === "toc") for (const e of b.entries) parts.push(e.num + " " + e.text);
    else if (b.type === "list") for (const it of b.items) parts.push(it.text);
    else if (b.type === "table") for (const r of b.rows) parts.push(r.map((c) => c.text).join("  "));
    else if (b.text) parts.push(b.text);
  }
  return parts.join("\n");
}

// File extension for saving a guide's master copy.
export const extFor = (format) => ({ html: "html", markdown: "md" }[format] || "txt");
