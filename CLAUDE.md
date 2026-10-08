# FF6 Guide: notes for Claude

A reader web app for the owner's own copy of a Final Fantasy VI Advance walkthrough (Djibriel's GameFAQs guide), used on an iPad while playing on another device. Live at https://ngeron.github.io/ff6-guide/ (GitHub Pages, served from `main`, root folder).

## Rules

- **Never commit the walkthrough or any real guide text.** It's the author's copyrighted work. The app imports the user's own copy into on-device storage; the repo holds only code. `.gitignore` blocks `*.txt`, `*.pdf`, `*.epub` and `*.zip` (backups hold the guide) outside `test/fixtures/`. Test with the invented Ember Crown fixtures instead, and keep any new fixtures original and public domain.
- **Commit directly to `main` and push.** No branches or pull requests unless the owner asks. Every push deploys.
- **No build step.** Plain HTML, CSS and ES modules served as they are. Don't add bundlers, frameworks or npm dependencies to the app. The npm registry isn't reachable from Claude's cloud sessions anyway. Vendored libraries go in `vendor/` with their license (currently pdf.js, the legacy build).
- **When you add, rename or remove an app file, update `APP` in `sw.js` and bump `CACHE`**, or the offline cache serves stale files.
- **Anything the user adds or changes (progress, names, maps, future settings) goes in backups.** `js/backup.js` defines the backup .zip (`backup.json` manifest plus files); add new data there as a new key and extend the backup test in `e2e.mjs`. Per-device reading settings (text size, theme) stay out.
- Keep the UI working at iPad (landscape and portrait) and phone widths, and in both the Paper (light) and Night (dark) themes. Colors come from the tokens at the top of `css/app.css`.
- Bump `VERSION` in `js/app.js` for user-visible changes.

## Layout

```
index.html               shell: top bar, left panel (Contents / Maps tabs), search and settings sheets, dialogs
css/app.css              all styles; theme tokens at the top
js/app.js                routing (#/, #/s/<section>, #/map/<id>, #/import), views, import flow, search, settings
js/importers/index.js    the shared document structure (read this first), format detection, search text
js/importers/text.js     fixed-width text guides (headings = a line followed by a row of asterisks)
js/importers/html.js     web pages: finds the guide's part of the page, maps h1-h6/p/lists/tables to blocks
js/importers/markdown.js Markdown → HTML → html.js
js/importers/webarchive.js  Safari .webarchive (binary plist) → HTML
js/extract.js            PDF → fixed-width text lines (pdf.js), for monospace text guides
js/render.js             blocks → HTML
js/store.js              IndexedDB (guide, maps) and localStorage (settings, progress)
js/maps.js, js/zip.js    maps panel, map packs (.zip + maps.json), map viewer
js/names.js              character renames, applied to the parsed guide when shown
js/backup.js             backup .zip: guide, progress, names, maps; save and restore
sw.js                    offline cache
test/                    e2e smoke test and fixture generators
```

All importers return the same document structure, so the reader, contents, search, progress and maps never need to know the input format. Add new formats as new importers rather than special cases elsewhere.

## Testing

Run the headless browser smoke test after any change. It needs Playwright and Chromium; in Claude's cloud sessions both are preinstalled globally, so link Playwright first:

```
mkdir -p node_modules && ln -sfn "$(npm root -g)/playwright" node_modules/playwright
python3 test/make_fixture.py --pdf test/output/ember-crown.pdf
node test/e2e.mjs test/output/ember-crown.pdf test/output
```

It should end with "All checks passed." Screenshots land in `test/output/` (git-ignored); look at them for visual changes. `node_modules/` is git-ignored too.

Fixture generators, all producing invented, public-domain content:
- `test/make_fixture.py`: the Ember Crown guide in classic text format (plus an optional PDF that mimics Safari's "Save as PDF")
- `test/make_variants.py`: the same guide as a formatted web page, a web archive, Markdown and a `<pre>` web page
- `test/make_maps.py`: the Ember Crown map pack

## Status and next steps

The parser improvement plan (agreed with the owner):
1. Done: per-format importers (text, PDF, HTML, web archive, Markdown).
2. Next: scored heading detection for text guides: underlines in any character, boxed headings, GameFAQs search codes like `[WLK03]`, numbering styles, and matching against the guide's own table of contents. Infer the guide's "house style" from confident matches and apply it consistently.
3. Column-gap table detection, and bordered tables (`+---+`, box-drawing characters) → real tables. ASCII art kept as-is.
4. A font-size/weight mode for proportional-font PDFs.
5. An import preview with overrides (per-guide heading rules), with Markdown `#` headings as the escape hatch.

Add a fixture variant for each new format or heading style, and extend `e2e.mjs` to check it.

## Working with the owner

- They use the app on an iPad, often as a Home Screen web app. Home Screen apps have storage separate from Safari.
- Claude can't change repo settings or delete branches through the session's GitHub access. Ask the owner to do those on github.com.
- Keep explanations plain; they prefer seeing a short summary of what changed after each push.
