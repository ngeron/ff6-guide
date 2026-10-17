# FF6 Guide

A companion web app for *Final Fantasy VI* (Pixel Remaster), built for an iPad propped up next to the game: a short walkthrough from the opening to the credits, monster intel, Gau's Rages, inventory and party planning.

Live app: https://ngeron.github.io/ff6-guide/

## Using it on an iPad

Open the app in Safari (or Chrome) and tap **Share → Add to Home Screen**. Use the Home Screen icon from then on: it opens full screen, works offline, and its storage isn't cleared after a week of disuse the way a regular Safari tab's can be. The Home Screen app keeps its own storage, separate from the browser.

## Features

- **Walkthrough** (`#/walk`, `#/walk/12`): 48 chapters across the World of Balance and the World of Ruin. Each chapter says where to go, how to beat its bosses, what not to miss, side trips and good places to grind. Monster names open their Monster intel cards. Mark chapters done one at a time, or everything up to a chapter at once (on a chapter page, or in Settings). Opening the app picks up at the last chapter you read.
- **Party** (`#/party`): characters met, levels, load-outs from your inventory, espers, and a load-out optimizer.
- **Monster intel** (`#/monsters`): search with a picture grid; weaknesses, steals and stats, paired with the Rages Gau has learned.
- **Gau's Rages** (`#/rages`) and **Inventory** (`#/gear`) trackers.
- Search across the walkthrough and monster names. A chapter number (`12`, `chapter 12`) jumps to that chapter.
- Your character names shown throughout, and color coding for characters, bosses, monsters and places.
- Maps: your own map images and links to hosted maps, attached to walkthrough chapters.
- Backups (one `.zip`) and Google Drive sync to move everything between devices.
- Text size, Paper/Night themes, Charter or system typeface, keep the screen on. Works offline.

The walkthrough is original text written for this app (`walkthrough/ff6-pr.md`). Earlier versions read an imported copy of Djibriel's GameFAQs guide instead; that copy is removed from the device on first start of version 0.20.0. Backups made before then still contain it, and restoring one brings back everything except the guide.

## Maps

The left panel has two tabs, **Contents** and **Maps**. Maps holds two kinds of things:

- **My maps:** your own map images, stored on this device. Tap **Add map images** and pick PNG, JPEG, WebP or GIF files, or a **map pack**. Open a map to pan and zoom (pinch, double-tap, or the Fit / − / + / Actual size buttons). Under **Map details** you can rename it, attach it to a walkthrough chapter, or delete it.
- **Map links:** bookmarks to maps hosted on other sites. Links open in a new tab.

A map or link attached to a chapter appears as a chip at the top of that chapter.

In Settings, **Save map pack** exports your maps and links as `maps.zip`, and **Remove all maps and links** (under Start over) clears them.

### Map pack format

A map pack is a `.zip` with images and an optional `maps.json` (folders inside the zip are fine). Unlisted images are added with a title made from the file name. A `maps.json` on its own can be imported to add links.

```json
{
  "title": "My maps",
  "maps": [
    { "file": "narshe.png", "title": "Narshe", "chapter": "the-raid-on-narshe" },
    { "file": "mines.png", "title": "Narshe mines", "section": "4.2.3" }
  ],
  "links": [
    { "title": "Interactive world map", "url": "https://example.com/maps/world", "chapter": "the-falcon-a-world-to-explore", "note": "optional" }
  ]
}
```

`chapter` is a chapter's title in lower case with words joined by `-`. Packs made for older versions use `section`, a section number of Djibriel's guide; those land on the walkthrough chapter that covers that section. `test/fixtures/ember-crown-maps.zip` is an example pack with invented maps.

## Development

There's no build step. The app is plain HTML, CSS and JavaScript modules, and GitHub Pages serves the files as they are. Edit a file, push to `main`, and the site updates within a minute or two. See `CLAUDE.md` for the file layout.

To run it locally, serve the folder and open it in a browser:

```
python3 -m http.server 8000
```

To run the smoke test (needs Node 18+ and Playwright):

```
npm i -D playwright && npx playwright install chromium
node test/e2e.mjs
```

When you change the list of app files, update `APP` in `sw.js` and bump `CACHE`.
