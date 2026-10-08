# FF6 Guide

A reader web app for your own copy of Djibriel's *Final Fantasy VI Advance Walkthrough and Battle Tactics Guide* (GameFAQs), built for reading on an iPad while you play on another device.

**This repository contains only the app.** The guide is the author's copyrighted work, so it is never committed here or served from this site. You import your own saved copy, and it stays in your browser's storage on your device.

Live app: https://ngeron.github.io/ff6-guide/

## Using it on an iPad

1. **Save the guide.** In Safari, open the guide on GameFAQs, tap **Share → Options → PDF**, and save it to Files.
2. **Open the app** in Safari (or Chrome) and tap **Share → Add to Home Screen**. Use the Home Screen icon from then on. It opens full screen, works offline, and its storage isn't cleared after a week of disuse the way a regular Safari tab's can be. The Home Screen app keeps its own storage, separate from the browser, so import inside it.
3. **Import** the PDF. The app rebuilds the guide's text from the PDF and splits it into sections.
4. **Save the cleaned text** (Reading settings → Save cleaned text) to iCloud Drive. That `.txt` file is your master copy: edit it as you like, and import it instead of the PDF from then on.

To pick up edits to your master copy, import it again (Reading settings → Import a new copy). Your progress is kept as long as section numbers don't change.

## Features

- One section per page, with previous/next links and a contents sidebar (a drawer on narrow screens)
- Section links: `#/s/4.15.2` opens that section directly
- Search across the whole guide, with matches highlighted in the section
- Remembers your place, and lets you mark sections done
- Text size, Paper/Night themes, Charter or system typeface, and an option to keep the screen on
- Maps: your own map images and links to hosted maps, attachable to guide sections
- Offline support through a service worker
- Reset button at the bottom of the contents panel: after an "are you really sure?" check (No is the default), it removes the guide and its progress and returns to the import page

## Maps

The left panel has two tabs, **Contents** and **Maps**. Maps holds two kinds of things:

- **My maps:** your own map images, stored on this device like the guide. Tap **Add map images** and pick PNG, JPEG, WebP or GIF files, or a **map pack**. Open a map to pan and zoom (pinch, double-tap, or the Fit / − / + / Actual size buttons). Under **Map details** you can rename it, attach it to a guide section, or delete it.
- **Map links:** bookmarks to maps hosted on other sites. Add one with the form in the panel. Links open in a new tab.

A map or link attached to a guide section (for example `3.1.3`) also appears as a chip at the top of that section.

**Save map pack** exports everything as `maps.zip`, so you can back it up or move it to another device. **Remove all maps and links** clears them. Resetting the guide keeps your maps.

### Map pack format

A map pack is a `.zip` with images and an optional `maps.json` (folders inside the zip are fine). Unlisted images are added with a title made from the file name. A `maps.json` on its own can be imported to add links.

```json
{
  "title": "Ember Crown maps",
  "maps": [
    { "file": "world.png", "title": "World map", "section": "3.0" },
    { "file": "old-quarry.png", "title": "Old Quarry", "section": "3.1.3" }
  ],
  "links": [
    { "title": "Interactive world map", "url": "https://example.com/maps/world", "section": "3.0", "note": "optional" }
  ]
}
```

`test/fixtures/ember-crown-maps.zip` is an example pack for the invented test guide.

## Editing your copy

The importer reads the guide's original fixed-width text format. When you edit, keep these conventions:

- **Section headings** are a line of text followed directly by a line of asterisks. A number at the start sets the level: `4.0` is a chapter, `4.15.2` a subsection.
  ```
  -------------------------------------------------------------------------------
   4.15.2  Scenario Sabin: Apparition and the Phantom Train continued
  **********************************
  ```
- **Paragraphs** are separated by blank lines. Lines wrapped at about 79 characters are joined back together.
- **Tables** (shops, charts): any line with a run of three or more spaces between words is kept in monospace with its alignment.
- **Info boxes:** an indented `Label:` line followed by indented lines, like the guide's `Opponents:` lists.
- **Labels:** `Preparation:`, `Steal:` and similar labels at the start of a line are shown in bold.

## Development

There's no build step. The app is plain HTML, CSS and JavaScript modules, and GitHub Pages serves the files as they are. Edit a file, push to `main`, and the site updates within a minute or two.

```
index.html            shell: top bar, contents panel, search and settings sheets
css/app.css           all styles; color tokens for Paper and Night at the top
js/app.js             routing, views, import/export, search, settings
js/parse.js           guide text → sections and blocks
js/render.js          blocks → HTML
js/extract.js         PDF → fixed-width text lines (uses pdf.js)
js/store.js           IndexedDB for the guide and maps, localStorage for settings and progress
js/maps.js            maps panel, map pack import/export, map viewer
js/zip.js             minimal zip reader/writer for map packs
sw.js                 offline cache
vendor/pdfjs/         pdf.js legacy build (Apache-2.0, see its LICENSE)
test/e2e.mjs          headless browser smoke test
test/make_fixture.py  generates an invented guide (and optionally a PDF) for testing
test/make_maps.py     generates the invented Ember Crown map pack
test/fixtures/        that invented guide, public domain (not the real walkthrough)
```

To run it locally, serve the folder and open it in a browser:

```
python3 -m http.server 8000
```

To run the smoke test (needs Node 18+ and Playwright):

```
npm i -D playwright && npx playwright install chromium
python3 test/make_fixture.py --pdf test/output/ember-crown.pdf   # needs reportlab
node test/e2e.mjs test/output/ember-crown.pdf
```

## Trying it without the real guide

`test/fixtures/ember-crown-guide.txt` is a complete walkthrough for an invented game, written in the same format as the real one (stat blocks, shop tables, info boxes, a sub-contents list). Import it to try the app, or download it from GitHub on your iPad and save it to Files first.

When you change the list of app files, update `APP` in `sw.js` and bump `CACHE`.

`.gitignore` excludes `*.txt`, `*.pdf` and `*.epub` (except test fixtures) so a copy of the guide can't be committed by accident.
