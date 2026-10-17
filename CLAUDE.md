# FF6 Guide: notes for Claude

A Final Fantasy VI companion web app, used on an iPad while playing on another device: an original walkthrough plus party, monster, Rage and inventory tools. The owner plays the **Pixel Remaster**: data and text follow it (no GBA bonus content such as Dragons' Den or Soul Shrine, Pixel Remaster names and bestiary numbers). Up to 0.19 the app was a reader for an imported copy of Djibriel's GameFAQs FF6 Advance guide; 0.20.0 removed that and its importers, and deletes the stored copy on start. Live at https://ngeron.github.io/ff6-guide/ (GitHub Pages, served from `main`, root folder).

## Rules

- **Never commit Djibriel's guide or any other real guide text.** It's the author's copyrighted work. `walkthrough/ff6-pr.md` is original text written for this app: facts are fine, wording must be our own, never pasted or paraphrased closely from a guide. `.gitignore` blocks `*.txt`, `*.pdf`, `*.epub` and `*.zip` (older backups hold the guide) outside `test/fixtures/`. Keep test fixtures original and public domain.
- **Commit directly to `main` and push.** No branches or pull requests unless the owner asks. Every push deploys.
- **No build step.** Plain HTML, CSS and ES modules served as they are. Don't add bundlers, frameworks or npm dependencies to the app. The npm registry isn't reachable from Claude's cloud sessions anyway. Vendored libraries go in `vendor/` with their license (none at the moment).
- **When you add, rename or remove an app file, update `APP` in `sw.js` and bump `CACHE`**, or the offline cache serves stale files.
- **Anything the user adds or changes (progress, names, party, inventory, maps, future settings) goes in backups.** `js/backup.js` defines the backup .zip (`backup.json` manifest plus files); add new data there as a new key and extend the backup test in `e2e.mjs`. Per-device reading settings (text size, theme) stay out.
- Keep the UI working at iPad (landscape and portrait) and phone widths, and in both the Paper (light) and Night (dark) themes. Colors come from the tokens at the top of `css/app.css`.
- Bump `VERSION` in `js/app.js` for user-visible changes.

## Layout

```
index.html               shell: top bar with tool shortcuts, left panel (contents), search and settings sheets, dialogs
css/app.css              all styles; theme tokens at the top
js/app.js                routing (#/ and #/walk, #/walk/<n>, #/wiki, #/wiki/<kind>/<id>, #/party, #/monsters/<name>, #/rages, #/gear, #/map, #/map/ch/<n>, #/map/<wob|wor>, #/map/place/<id>), contents, search, settings, bulk mark done, backup and Drive UI
js/walkthrough.js        the walkthrough (read from walkthrough/ff6-pr.md; format notes at the top of that file): chapter list and pages, done marks ("walkDone"), last chapter ("walkLast"), search text, and which chapter a map belongs to
walkthrough/ff6-pr.md    the walkthrough text: ORIGINAL, written for this app
js/render.js             esc() for HTML strings
js/store.js              localStorage (settings, progress); IndexedDB only to delete what older versions stored
js/worldmap.js, worldmap-data.js  world map (#/map): drawn World of Balance / World of Ruin terrain (generated from the game's tile map; no game images), a pin per wiki place, a chapter's route and flying direction
js/zip.js                .zip reading and writing for backups
js/names.js              character renames, applied when the walkthrough is shown
js/tags.js               color coding: characters, people, items and espers, monsters, bosses and places; marks them in the page and links them
js/wiki.js, wiki-data.js  wiki (#/wiki): articles on characters, people and places (ORIGINAL text, spoilers after a chapter folded until you reach it), espers and items from the data files; where colored names link; the summary popup (hover, or first tap on touch)
js/rages.js, rages-data.js  Gau's Rages tracker (#/rages) and its data (credited, MIT)
js/gear.js, gear-data.js    inventory tracker (#/gear): counts, prices, sources (data CC BY-SA, credited)
js/party.js, optimizer.js, party-data.js, espers-data.js  Party page (#/party): met characters, levels, load-outs, espers (acquired, equipped, spells learned) (equipping moves items out of the gear bag), and the load-out optimizer (FF6 damage formulas; see optimizer.js header)
js/monsters.js, monsters-data.js  monster intel (#/monsters/<name>): search, 3-column picture grid, stats (CC BY-SA). Pictures are hotlinked from the wiki with no referrer and cached by sw.js; never commit them
js/cloud.js              Google Drive sync of the backup .zip (OAuth token redirect, drive.file scope; client ID entered in Settings per browser, never committed)
js/backup.js             backup .zip: progress, names, tags, party, gear, Rages; save and restore (older backups' guide and maps are ignored)
sw.js                    offline cache
test/                    e2e smoke test
```

## Testing

Run the headless browser smoke test after any change. It needs Playwright and Chromium; in Claude's cloud sessions both are preinstalled globally, so link Playwright first:

```
mkdir -p node_modules && ln -sfn "$(npm root -g)/playwright" node_modules/playwright
node test/e2e.mjs
```

Without Node locally, run it in the Playwright container:

```
podman run --rm -v "$PWD":/app:Z -w /app mcr.microsoft.com/playwright:v1.55.0-noble bash -c 'cd /tmp && npm i playwright@1.55.0 >/dev/null 2>&1 && mkdir -p /app/node_modules && ln -sfn /tmp/node_modules/playwright /app/node_modules/playwright && cd /app && node test/e2e.mjs "" test/output'; rm -rf node_modules
```

It should end with "All checks passed." Screenshots land in `test/output/` (git-ignored); look at them for visual changes. `node_modules/` is git-ignored too.

## Working with the owner

- They use the app on an iPad, often as a Home Screen web app. Home Screen apps have storage separate from Safari.
- Claude can't change repo settings or delete branches through the session's GitHub access. Ask the owner to do those on github.com.
- Keep explanations plain; they prefer seeing a short summary of what changed after each push.
