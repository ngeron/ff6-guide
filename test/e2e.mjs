// Headless smoke test: serves the app and checks the walkthrough, tools, world map, backups and sync.
// Usage: node test/e2e.mjs [ignored] [screenshot-dir]
// Requires Playwright (npm i -D playwright) and a Chromium build.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.argv[3] || path.join(ROOT, "test/output");
fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".md": "text/markdown; charset=utf-8", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); console.log((cond ? "ok   " : "FAIL ") + msg); };
const watch = (page) => {
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
};
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const doneKeys = (page) => page.evaluate(() => [...document.querySelectorAll(".toc-list a.done")].map((a) => +a.dataset.key));

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base);
  await page.waitForSelector(".walk .wt-list");
  check(await page.locator(".walk .continue").count() === 1, `[${scheme}] starts on the walkthrough, no import step`);
  const chapters = await page.locator(".toc-list a.toc-sub").count();
  check(chapters >= 40, `[${scheme}] contents lists the chapters (${chapters})`);
  check(await page.locator('.toc-tracker[href="#/walk"][aria-current="page"]').count() === 1, `[${scheme}] contents highlights the walkthrough`);
  await page.screenshot({ path: path.join(SHOTS, `2-home-${scheme}.png`) });

  await page.click('.toc-list a[data-key="3"]');
  await page.waitForFunction(() => /Figaro Castle/.test(document.querySelector(".walk-ch .sec-h")?.textContent || ""));
  check(await page.locator('.toc-list a[data-key="3"][aria-current="page"]').count() === 1, `[${scheme}] contents opens a chapter and marks it current`);
  await page.screenshot({ path: path.join(SHOTS, `3-chapter-${scheme}.png`), fullPage: true });
  await page.click("#walkDone");
  check(JSON.stringify(await doneKeys(page)) === "[3]", `[${scheme}] mark done updates contents`);

  await page.click("#searchBtn");
  await page.fill("#q", "south figaro");
  await page.waitForSelector(".results li");
  if (scheme === "light") await page.screenshot({ path: path.join(SHOTS, "4-search.png") });
  await page.click('.results li a[href^="#/walk/"]');
  await page.waitForSelector(".walk-ch mark.hit");
  check(true, `[${scheme}] search result opens the chapter with highlights`);
  const chap = await page.textContent(".walk-ch .sec-h");

  await page.reload();
  await page.waitForSelector(".walk-ch");
  check(await page.textContent(".walk-ch .sec-h") === chap, `[${scheme}] reload stays on the chapter`);
  await page.goto(base);
  await page.waitForSelector(".walk-ch");
  check(await page.textContent(".walk-ch .sec-h") === chap, `[${scheme}] opening the app resumes the last chapter`);

  if (scheme === "light") {
    await page.click("#settingsBtn");
    await page.click('#themeSeg [data-v="dark"]');
    await page.click("#fsUp");
    await page.screenshot({ path: path.join(SHOTS, "5-settings.png") });
    await page.click("#settingsSheet [data-close]");
    check(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "[light] theme switch applies");
  }
  await ctx.close();
}

// Search: chapter numbers and monsters.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base);
  await page.waitForSelector(".walk");
  await page.click("#searchBtn");
  await page.fill("#q", "chapter 12");
  await page.waitForSelector('.results a[href="#/walk/12"]');
  check(/Go to chapter/.test(await page.textContent(".results li")), "[search] a chapter number jumps to it");
  await page.fill("#q", "kefka");
  await page.waitForSelector('.results a[href^="#/monsters/"]');
  check(/monster/.test(await page.textContent("#searchCount")) && await page.locator('.results a[href^="#/walk/"]').count() >= 5, "[search] finds monsters and chapters");
  await page.click('.results a[href^="#/monsters/"] >> nth=0');
  await page.waitForSelector(".mn-card");
  check(/Kefka/.test(await page.textContent("#mnName")), "[search] a monster result opens its card");
  await ctx.close();
}

// Upgrading from a version that stored an imported guide: the guide and its progress are removed.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base);
  await page.waitForSelector(".walk");
  await page.evaluate(async () => {
    const m = await import("./js/store.js");
    await m.idbSet("guide", { text: "old guide", name: "old.txt", importedAt: 1 });
    for (const k of ["done", "last", "pos", "savedText"]) localStorage.setItem("ff6g:" + k, "[]");
    // Map images and links from before 0.22.0.
    const db = await new Promise((ok) => { const r = indexedDB.open("ff6-guide", 2); r.onsuccess = () => ok(r.result); });
    await new Promise((ok) => { const t = db.transaction("maps", "readwrite"); t.objectStore("maps").put({ id: "old", title: "Old map" }); t.oncomplete = ok; });
    db.close();
    await m.idbSet("mapLinks", [{ id: "l", title: "Old link", url: "https://example.com" }]);
  });
  await page.reload();
  await page.waitForSelector(".walk");
  await page.waitForFunction(async () => !(await (await import("./js/store.js")).idbGet("guide")));
  check(await page.evaluate(() => ["done", "last", "pos", "savedText"].every((k) => localStorage.getItem("ff6g:" + k) === null)), "[upgrade] old guide and its progress removed");
  await page.waitForFunction(async () => {
    const db = await new Promise((ok) => { const r = indexedDB.open("ff6-guide", 2); r.onsuccess = () => ok(r.result); });
    const n = await new Promise((ok) => { const q = db.transaction("maps").objectStore("maps").count(); q.onsuccess = () => ok(q.result); });
    db.close();
    return n === 0 && !(await (await import("./js/store.js")).idbGet("mapLinks"));
  });
  check(true, "[upgrade] old map images and links removed");
  await ctx.close();
}

// Phone-width drawer behaviour.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base);
  await page.waitForSelector(".walk");
  check(await page.locator("#toc").isHidden(), "[phone] contents hidden by default");
  await page.click("#tocBtn");
  check(await page.locator("#toc").isVisible(), "[phone] contents drawer opens");
  await page.screenshot({ path: path.join(SHOTS, "6-phone-drawer.png") });
  await page.click('details[data-group="2"] summary');
  await page.click('.toc-list a[data-key="30"]');
  await page.waitForSelector(".walk-ch");
  check(await page.locator("#toc").isHidden(), "[phone] drawer closes after picking a chapter");
  check(await noScroll(page), "[phone] no horizontal page scroll");
  await page.screenshot({ path: path.join(SHOTS, "7-phone-chapter.png"), fullPage: true });
  await ctx.close();
}

// Reset walkthrough progress from Settings.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base + "#/walk/2");
  await page.waitForSelector("#walkDone");
  await page.click("#walkDone");
  check(await page.locator("#toc #resetBtn").count() === 0, "[reset] contents panel has no reset button");
  await page.click("#settingsBtn");
  check(await page.locator("#settingsSheet #resetBtn").isEnabled(), "[reset] reset button shown in settings");
  await page.click("#resetBtn");
  check(await page.locator("#resetDialog").isVisible(), "[reset] confirmation dialog opens");
  check(await page.evaluate(() => document.activeElement && document.activeElement.id) === "resetNo", "[reset] 'No' is focused by default");
  await page.screenshot({ path: path.join(SHOTS, "8-reset-dialog.png") });
  await page.keyboard.press("Enter");
  check(await page.locator("#resetDialog").isHidden() && (await doneKeys(page)).length === 1, "[reset] pressing Enter chooses No and keeps progress");
  await page.click("#resetBtn");
  await page.keyboard.press("Escape");
  check(await page.locator("#resetDialog").isHidden() && await page.locator("#settingsSheet").isVisible(), "[reset] Escape cancels and leaves settings open");
  await page.click("#resetBtn");
  await page.click("#resetYes");
  await page.waitForFunction(() => !document.querySelector(".toc-list a.done"));
  check(await page.evaluate(() => localStorage.getItem("ff6g:walkDone") === null), "[reset] done marks cleared");
  check(await page.locator("#walkDone.on").count() === 0, "[reset] chapter page shows it's not done");
  await ctx.close();
}

// World map: chapter routes, pins, both worlds, zoom, and links from the walkthrough and wiki.
for (const vp of [{ tag: "ipad", w: 1180, h: 820 }, { tag: "phone", w: 390, h: 844, touch: true }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: !!vp.touch, isMobile: !!vp.touch });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base + "#/walk/19");
  await page.waitForSelector(".walk-ch .sec-maps a[href='#/map/ch/19']");
  check(true, `[map ${vp.tag}] a chapter links to its route on the map`);
  await page.click(".walk-ch .sec-maps a");
  await page.waitForSelector(".wm-stage .wm-pin");
  check(await page.locator('.wm-w[aria-current="page"]', { hasText: "Balance" }).count() === 1, `[map ${vp.tag}] chapter 19 opens the World of Balance`);
  check(/fly \w/.test(await page.textContent(".wm-dir")) && /Narshe/.test(await page.textContent(".wm-dir")), `[map ${vp.tag}] directions from the last chapter (${(await page.textContent(".wm-dir")).replace(/\s+/g, " ").trim()})`);
  check(await page.locator(".wm-pin.on").count() >= 1 && await page.locator(".wm-pin.from").count() === 1 && await page.locator(".wm-route").count() === 1, `[map ${vp.tag}] destination, start and route drawn`);
  check(await noScroll(page), `[map ${vp.tag}] no horizontal page scroll`);
  await page.screenshot({ path: path.join(SHOTS, `9-worldmap-${vp.tag}.png`) });
  // Zoom changes the drawing's scale.
  const sc = () => page.evaluate(() => +document.getElementById("wmG").getAttribute("transform").match(/scale\(([\d.]+)\)/)[1]);
  const s1 = await sc();
  await page.click("#wmIn");
  check(await sc() > s1, `[map ${vp.tag}] zoom in`);
  await page.click("#wmFit");
  check(await page.locator(".wm-stage.wm-labels").count() === 0 || vp.tag === "ipad", `[map ${vp.tag}] Fit shows the whole world`);
  // The other world.
  await page.click('.wm-w:has-text("Ruin")');
  await page.waitForFunction(() => document.querySelector(".wmap.wm-ruin"));
  check(await page.locator('.wm-pin[href="#/wiki/place/kefkas-tower"]').count() === 1, `[map ${vp.tag}] World of Ruin has its own pins`);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.join(SHOTS, `10-worldmap-ruin-dark-${vp.tag}.png`) });
  await page.emulateMedia({ colorScheme: "light" });
  // A pin gives the place's summary; the summary of a place in the walkthrough offers the map.
  await page.goto(base + "#/walk/22");
  await page.waitForSelector(".walk-ch .body a.ent-place");
  const place = page.locator('.walk-ch .body a[href="#/wiki/place/thamasa"]').first();
  await place.scrollIntoViewIfNeeded();
  if (vp.touch) await place.tap(); else await place.hover();
  await page.waitForSelector("#peek:not([hidden]) .pk-map");
  await page.click("#peek .pk-map");
  await page.waitForSelector(".wm-pin.on");
  check(await page.locator('.wm-pin.on[href="#/wiki/place/thamasa"]').count() === 1, `[map ${vp.tag}] "On the map" from a summary shows the place`);
  await page.click(".wmap .wk-back");
  await page.waitForSelector(".walk-ch");
  check(/#\/walk\/22$/.test(page.url()), `[map ${vp.tag}] back to the chapter`);
  await ctx.close();
}

// Character names: rename on display, persist, search, and undo.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base);
  const unit = await page.evaluate(async () => {
    const { renamer } = await import("./js/names.js");
    const r = renamer([{ from: "terra", to: "Prns Donut" }, { from: "Celes", to: "Terra" }]);
    return [r("Terra's TERRA terrapin Celes"), r.html('<a href="#terra">Terra</a> &amp; Celes')];
  });
  check(unit[0] === "Prns Donut's PRNS DONUT terrapin Terra", `[names] whole words, capitals and swaps (${unit[0]})`);
  check(unit[1] === '<a href="#terra">Prns Donut</a> &amp; Terra', `[names] HTML attributes untouched (${unit[1]})`);

  await page.goto(base + "#/walk/1");
  await page.waitForSelector(".walk-ch");
  await page.click("#settingsBtn");
  await page.click("#nameAdd");
  await page.fill("#nameList li:last-child .nm-from", "terra");
  await page.fill("#nameList li:last-child .nm-to", "Prns Donut");
  await page.press("#nameList li:last-child .nm-to", "Tab");
  await page.waitForFunction(() => /Prns Donut/.test(document.querySelector(".walk-ch")?.textContent || ""));
  await page.screenshot({ path: path.join(SHOTS, "11-names.png") });
  const body = await page.textContent(".walk-ch");
  check(body.includes("Prns Donut") && !/\bTerra\b/.test(body), "[names] chapter re-rendered with the new name");
  check(await page.locator("#settingsSheet").isVisible(), "[names] settings stay open while renaming");
  await page.click("#settingsSheet [data-close]");

  await page.reload();
  await page.waitForSelector(".walk-ch");
  check((await page.textContent(".walk-ch")).includes("Prns Donut"), "[names] names kept after reload");
  await page.click("#searchBtn");
  await page.fill("#q", "prns donut");
  await page.waitForSelector(".results li");
  check(await page.locator(".results li").count() >= 2, "[names] search finds the new name");
  await page.click("#searchSheet [data-close]");

  await page.click("#settingsBtn");
  await page.click("#nameList .nm-x");
  await page.waitForFunction(() => /\bTerra\b/.test(document.querySelector(".walk-ch")?.textContent || ""));
  check(true, "[names] removing a name restores the default name");
  await ctx.close();
}

// Bulk mark done: from a chapter page and from Settings.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base + "#/walk/5");
  await page.waitForSelector("#walkUpto");
  await page.click("#walkUpto");
  await page.waitForSelector("#markDialog[open]");
  check((await page.textContent("#markTitle")).includes("Mark 5 chapters"), "[bulk] dialog counts 5 chapters");
  await page.screenshot({ path: path.join(SHOTS, "17-bulk-dialog.png") });
  await page.click("#markNo");
  check((await doneKeys(page)).length === 0, "[bulk] Cancel marks nothing");
  await page.click("#walkUpto");
  await page.click("#markYes");
  await page.waitForFunction(() => document.querySelectorAll(".toc-list a.done").length === 5);
  check(JSON.stringify(await doneKeys(page)) === "[1,2,3,4,5]", "[bulk] marks every chapter through 5 and nothing after");
  await page.waitForSelector("#walkDone.on");
  check(await page.locator("#walkUpto").count() === 0, "[bulk] page shows Done and hides the bulk link");

  await page.click("#settingsBtn");
  check(/5 of \d+ chapters done/.test(await page.textContent("#progressInfo")), "[bulk] settings show progress");
  await page.selectOption("#uptoCh", "9");
  await page.click("#uptoForm button");
  await page.waitForSelector("#markDialog[open]");
  check((await page.textContent("#markTitle")).includes("Mark 4 chapters"), "[bulk] only chapters not yet done are counted");
  await page.screenshot({ path: path.join(SHOTS, "18-bulk-settings.png") });
  await page.click("#markYes");
  await page.waitForFunction(() => document.querySelectorAll(".toc-list a.done").length === 9);
  await page.reload();
  await page.waitForSelector(".toc-list");
  check(JSON.stringify(await doneKeys(page)) === "[1,2,3,4,5,6,7,8,9]", "[bulk] marks kept after reload");
  await ctx.close();
}

// Gau's Rages tracker.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base);
  await page.waitForSelector(".walk");
  await page.click('.toc-tracker[href="#/rages"]');
  await page.waitForSelector(".rages");
  check(await page.locator(".rg").count() === 256 && (await page.textContent(".rg-stat")).includes("0 of 252"), "[rages] lists 256 Rages, 252 learnable");
  await page.check('.rg:has-text("Stray Cat") input');
  check((await page.textContent(".rg-stat")).includes("1 of 252") && (await page.textContent("#rageCnt")) === "1/252", "[rages] checking a Rage updates the counts");
  await page.click('#rgSeg [data-v="missing"]');
  check(await page.locator('.rg:has-text("Stray Cat")').isHidden(), "[rages] Missing hides learned Rages");
  check(await page.locator('.rg.never:has-text("Siegfried")').isHidden() && await page.locator('.rg.never:has-text("Death Warden")').isHidden(), "[rages] Missing leaves out Rages that can't be learned in the Pixel Remaster");
  await page.click('#rgSeg [data-v="lore"]');
  check(await page.locator(".rg:not([hidden])").count() === 40, "[rages] Lores filter shows the 40 Lore sources");
  await page.click('#rgSeg [data-v="all"]');
  await page.fill("#rgQ", "incisor");
  const abil = await page.locator(".rg:not([hidden]) .rg-ab").allTextContents();
  check(abil.length >= 1 && abil.every((t) => /incisor/i.test(t)) && await page.locator('.rg:not([hidden]):has-text("Leaf Bunny")').count() === 1, `[rages] search matches abilities (${abil.length} with Incisor)`);
  await page.fill("#rgQ", "leafer");
  check(await page.locator('.rg:not([hidden]):has-text("Leaf Bunny")').count() === 1, "[rages] search matches SNES names");
  await page.fill("#rgQ", "017");
  check(await page.locator('.rg:not([hidden]):has-text("Zaghrem")').count() === 1, "[rages] search matches Pixel Remaster bestiary numbers");
  await page.fill("#rgQ", "");
  await page.click("#rgStart");
  check((await page.textContent(".rg-stat")).includes("10 of 252") && await page.locator("#rgStart").isHidden(), "[rages] marks the starting Rages");
  await page.screenshot({ path: path.join(SHOTS, "19-rages.png") });
  await page.selectOption("#rgEl", "Fire");
  const fireRows = await page.locator(".rg:not([hidden]) .rg-pow").allTextContents();
  check(fireRows.length > 5 && fireRows.every((t) => /Fire/.test(t)), `[rages] attack-type filter shows only Fire Rages (${fireRows.length})`);
  await page.selectOption("#rgSort", "strong");
  const firstTwo = await page.locator(".rg:not([hidden]) .rg-pow").evaluateAll((els) => els.slice(0, 2).map((e) => +e.textContent.replace(/[^0-9]/g, "").slice(0, 6)));
  check(firstTwo[0] >= firstTwo[1], `[rages] strongest first (${firstTwo.join(" ≥ ")})`);
  check(/≈ [\d,]+ damage · Fire/.test(fireRows[0]), `[rages] each Rage shows a damage estimate (${fireRows[0]})`);
  await page.selectOption("#rgEl", "any");
  await page.selectOption("#rgSort", "menu");
  await page.click('.rg:has-text("Stray Cat") .rg-find');
  check(await page.locator("#searchSheet").isVisible() && await page.inputValue("#q") === "Stray Cat", "[rages] find button searches the walkthrough");
  await page.click("#searchSheet [data-close]");
  await page.reload();
  await page.waitForSelector(".rages");
  check((await page.textContent(".rg-stat")).includes("10 of 252") && await page.locator('.rg.on:has-text("Stray Cat")').count() === 1, "[rages] kept after reload");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(SHOTS, "20-rages-phone-dark.png") });
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "[rages] no horizontal scroll at phone width");
  await ctx.close();
}

// Party: characters, levels, load-outs and the optimizer.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base);
  await page.waitForSelector(".walk");
  const BAG = { "Mythril Knife": 2, "Icebrand": 1, "Rune Blade": 1, "Bastard Sword": 2, "Mythril Shield": 7, "Heavy Shield": 1, "Bandana": 1, "Plumed Hat": 1, "Twist Headband": 1,
    "Mythril Vest": 2, "Ninja Gear": 3, "White Dress": 1, "Genji Glove": 1, "Gigas Glove": 1, "Hero's Ring": 1, "Earring": 2, "Hyper Wrist": 1, "Black Belt": 1, "Hermes Sandals": 2, "Sprint Shoes": 1, "Potion": 9 };
  await page.evaluate((b) => { localStorage.setItem("ff6g:gear", JSON.stringify(b)); localStorage.setItem("ff6g:names", JSON.stringify([{ from: "Terra", to: "Prns Donut" }])); }, BAG);
  await page.goto(base + "#/party");
  await page.reload();
  await page.waitForSelector(".party");
  check(await page.locator(".pc-met").count() === 14 && await page.isDisabled("#ptOpt"), "[party] all 14 characters start unmet; Optimize waits for a party");
  for (const n of ["Terra", "Locke", "Sabin", "Gau"]) await page.click(`.pc-met[data-c="${n}"]`);
  for (const n of ["Terra", "Locke", "Sabin", "Gau"]) await page.click(`[data-c="${n}"] .pc-party`);
  check(await page.locator("article.pc").count() === 4 && (await page.textContent('article[data-c="Terra"] h3')).includes("Prns Donut"), "[party] four in the party, shown with your names");
  await page.click('.pc-met[data-c="Celes"]');
  await page.click('[data-c="Celes"] .pc-party');
  check(await page.locator("article.pc").count() === 4, "[party] a fifth member is refused");
  const hp1 = await page.textContent('article[data-c="Terra"] .pc-stats div:first-child dd');
  await page.click('article[data-c="Terra"] .pc-lvup');
  await page.fill('article[data-c="Terra"] .pc-lvn', "30");
  await page.press('article[data-c="Terra"] .pc-lvn', "Tab");
  const hp30 = await page.textContent('article[data-c="Terra"] .pc-stats div:first-child dd');
  check(+hp30 > +hp1 && (await page.inputValue('article[data-c="Terra"] .pc-lvn')) === "30", `[party] level changes HP (${hp1} → ${hp30})`);
  const nat = await page.locator('article[data-c="Terra"] .pc-magic .pc-spell').evaluateAll((l) => l.filter((x) => x.checked).map((x) => x.dataset.s + (x.disabled ? "" : "?")));
  check(nat.sort().join() === "Cure,Drain,Fira,Fire,Poisona,Raise,Teleport", `[party] Terra at level 30 knows her level-learned spells, locked (${nat.join(", ")})`);
  for (const n of ["Locke", "Sabin", "Gau"]) { await page.fill(`article[data-c="${n}"] .pc-lvn`, "28"); await page.press(`article[data-c="${n}"] .pc-lvn`, "Tab"); }
  await page.selectOption('article[data-c="Locke"] tr[data-slot="rh"] .pc-sel', "Mythril Knife");
  check(await page.evaluate(() => JSON.parse(localStorage.getItem("ff6g:gear"))["Mythril Knife"]) === 1, "[party] equipping takes the item out of the bag");
  await page.selectOption('article[data-c="Locke"] tr[data-slot="lh"] .pc-sel', "Mythril Knife");
  check(await page.inputValue('article[data-c="Locke"] tr[data-slot="lh"] .pc-sel') === "", "[party] two weapons without the Genji Glove are refused");
  await page.selectOption('article[data-c="Sabin"] tr[data-slot="r2"] .pc-sel', "Sprint Shoes");
  await page.click('article[data-c="Sabin"] tr[data-slot="r2"] .pc-lock');
  const before = await page.evaluate(() => { const g = JSON.parse(localStorage.getItem("ff6g:gear")); const p = JSON.parse(localStorage.getItem("ff6g:party")); const t = { ...g }; for (const c of Object.values(p.chars)) for (const n of Object.values(c.eq)) t[n] = (t[n] || 0) + 1; return t; });
  const t0 = Date.now();
  await page.click("#ptOpt");
  await page.waitForSelector("#ptApply");
  const ms = Date.now() - t0;
  await page.screenshot({ path: path.join(SHOTS, "25-party-optimize.png") });
  await page.click("#ptApply");
  await page.waitForSelector(".party");
  const after = await page.evaluate(() => ({ g: JSON.parse(localStorage.getItem("ff6g:gear")), p: JSON.parse(localStorage.getItem("ff6g:party")) }));
  const total = { ...after.g };
  for (const c of Object.values(after.p.chars)) for (const n of Object.values(c.eq)) total[n] = (total[n] || 0) + 1;
  const sameItems = Object.keys({ ...before, ...total }).every((n) => (before[n] || 0) === (total[n] || 0));
  check(sameItems, "[party] optimizing never creates or loses items");
  const EQ = await page.evaluate(async () => (await import("./js/party-data.js")).EQUIP);
  const ok = Object.entries(after.p.chars).every(([, c]) => {
    const w = ["rh", "lh"].filter((h) => c.eq[h] && EQ[c.eq[h]].slot === "weapon").length;
    const genji = [c.eq.r1, c.eq.r2].includes("Genji Glove");
    return w < 2 || genji;
  });
  check(ok, "[party] two weapons only with the Genji Glove");
  check(after.p.chars.Sabin.eq.r2 === "Sprint Shoes", "[party] locked slot kept");
  check(after.p.chars.Locke.eq.rh === "Mythril Knife" || EQ[after.p.chars.Locke.eq.rh || "Mythril Knife"].slot === "weapon", "[party] weapons stay in the right hand (no pointless hand swaps)");
  const terra = after.p.chars.Terra.eq;
  check([terra.r1, terra.r2].filter((n) => n === "Earring").length + ([terra.r1, terra.r2].includes("Hero's Ring") ? 1 : 0) >= 1, `[party] Terra gets magic relics (${terra.r1}, ${terra.r2})`);
  check(ms < 5000, `[party] optimizer runs quickly (${ms} ms)`);
  const CODE = { Terra: "Te", Locke: "Lo", Sabin: "Sa", Gau: "Ga" };
  check(Object.entries(after.p.chars).every(([n, c]) => Object.values(c.eq).every((it) => EQ[it].who === "all" || EQ[it].who.split(" ").includes(CODE[n]))), "[party] only items each character can equip");
  check(await page.locator('article[data-c="Gau"] .pc-goalsel option[value="cmd"]').textContent() === "Rage" && await page.locator('article[data-c="Terra"] .pc-goalsel option[value="cmd"]').count() === 0, "[party] Gau can optimize for Rage; Terra has no command goal");
  const cmdPicks = await page.evaluate(async () => {
    const { optimizeOne, charByName } = await import("./js/optimizer.js");
    const pool = {};
    for (const n of ["Thief's Bracer", "Brigand's Glove", "Earring", "Gigas Glove", "Genji Glove", "Master's Scroll", "Kotetsu", "Thief's Knife", "Mythril Shield"]) pool[n] = 2;
    const relics = (c, g) => { const r = optimizeOne(charByName.get(c), 30, g, pool); return [r.r1, r.r2, r.rh]; };
    return { gau: relics("Gau", "cmd"), locke: relics("Locke", "cmd"), cyan: relics("Cyan", "cmd") };
  });
  check(cmdPicks.gau.includes("Earring") && !cmdPicks.gau.includes("Master's Scroll"), `[party] Rage goal favors Magic and Vigor relics over Fight ones (${cmdPicks.gau})`);
  check(cmdPicks.locke.includes("Thief's Bracer") && cmdPicks.locke.includes("Brigand's Glove"), `[party] Steal goal picks the Thief's Bracer and Brigand's Glove (${cmdPicks.locke})`);
  check(cmdPicks.cyan[2] === "Kotetsu", `[party] Bushido goal still holds a katana (${cmdPicks.cyan})`);
  await page.click("#ptClear");
  const cleared0 = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("ff6g:party")).chars).reduce((k, c) => k + Object.keys(c.eq).length, 0));
  await page.click("#ptClear");
  const cl = await page.evaluate(() => ({ g: JSON.parse(localStorage.getItem("ff6g:gear")), p: JSON.parse(localStorage.getItem("ff6g:party")) }));
  const clTotal = { ...cl.g };
  for (const c of Object.values(cl.p.chars)) for (const n of Object.values(c.eq)) clTotal[n] = (clTotal[n] || 0) + 1;
  check(cleared0 > 1 && Object.entries(cl.p.chars).every(([n, c]) => Object.keys(c.eq).length === (n === "Sabin" ? 1 : 0)) && cl.p.chars.Sabin.eq.r2 === "Sprint Shoes", "[party] Clear all gear needs a second tap, then empties every unlocked slot");
  check(Object.keys({ ...before, ...clTotal }).every((n) => (before[n] || 0) === (clTotal[n] || 0)), "[party] cleared gear goes back to the bag");
  await page.click("#ptOpt");
  await page.waitForSelector("#ptApply");
  await page.click("#ptApply");
  await page.waitForSelector(".party");
  // Espers
  check(await page.locator(".pt-howto").count() === 1 && await page.locator(".pt-esper").count() === 27, "[espers] explainer and all 27 Pixel Remaster espers listed");
  for (const n of ["Ramuh", "Kirin", "Siren", "Bismarck", "Golem"]) await page.click(`.pt-esper[data-e="${n}"]`);
  await page.selectOption('article[data-c="Terra"] .pc-esper', "Ramuh");
  await page.click('article[data-c="Terra"] .pc-spell[data-s="Thunder"]');
  check(await page.locator('article[data-c="Terra"] > .pc-spells .pc-spell:checked').count() === 1 && /teaches 2 spells/.test(await page.textContent('article[data-c="Terra"] > .pc-spells')), "[espers] equipped esper shows its spells; learned ones tick off");
  const ramuhOpt = await page.locator('article[data-c="Terra"] .pc-esper option[value="Ramuh"]').textContent();
  check(/Ramuh · 2 to learn/.test(ramuhOpt), `[espers] the esper menu counts spells left to learn (${ramuhOpt})`);
  await page.selectOption('article[data-c="Locke"] .pc-esper', "Ramuh");
  check(await page.inputValue('article[data-c="Terra"] .pc-esper') === "" && await page.inputValue('article[data-c="Locke"] .pc-esper') === "Ramuh", "[espers] an esper moves from one character to another");
  check(await page.locator('article[data-c="Terra"] .pc-magic .pc-spell[data-s="Thunder"]:checked').count() === 1 && /8 of 54 known/.test(await page.textContent('article[data-c="Terra"] .pc-magic summary')), "[magic] a spell stays in the character's Magic list after the esper moves on");
  await page.click('article[data-c="Terra"] .pc-magic summary');
  await page.click('article[data-c="Terra"] .pc-magic .pc-spell[data-s="Cura"]');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem("ff6g:party")).chars.Terra.spells.includes("Cura")) && await page.locator('article[data-c="Terra"] .pc-magic[open]').count() === 1, "[magic] ticking a spell in the Magic list saves it; the list stays open");
  await page.screenshot({ path: path.join(SHOTS, "27b-party-magic.png") });
  await page.click('article[data-c="Terra"] .pc-magic summary');
  check(await page.locator('article[data-c="Gau"] .pc-esper').count() === 1, "[espers] Gau can hold an esper");
  check(await page.locator('article[data-c="Gau"] .pc-esperfor').count() === 1, "[espers] each character has their own Espers for setting");
  for (const n of ["Terra", "Locke", "Sabin", "Gau"]) await page.selectOption(`article[data-c="${n}"] .pc-esperfor`, "bonus");
  await page.click("#ptOpt");
  await page.waitForSelector("#ptApply");
  await page.click("#ptApply");
  await page.waitForSelector(".party");
  const ep = await page.evaluate(() => JSON.parse(localStorage.getItem("ff6g:party")));
  const held = st => Object.values(ep.chars).map((c) => c.esper).filter(Boolean);
  check(new Set(held()).size === held().length && held().length === 4, `[espers] optimizer gives each party member a different esper (${held().join(", ")})`);
  check(["Locke", "Sabin"].some((n) => ep.chars[n].esper === "Bismarck"), "[espers] level-up mode gives Bismarck (Strength +2) to a fighter");
  const migrated = await page.evaluate(async () => {
    const keep = localStorage.getItem("ff6g:party");
    localStorage.setItem("ff6g:party", JSON.stringify({ party: ["Mog"], esperMode: "bonus", chars: { Mog: { met: true, level: 5 } } }));
    const { loadParty } = await import("./js/party.js");
    const p = loadParty();
    localStorage.setItem("ff6g:party", keep);
    return p.chars.Mog.esperFor;
  });
  check(migrated === "bonus", "[espers] an older party-wide Espers for setting carries over to each character");
  await page.screenshot({ path: path.join(SHOTS, "27-espers.png"), fullPage: true });
  await page.reload();
  await page.waitForSelector(".party");
  check(await page.locator("article.pc").count() === 4 && (await page.inputValue('article[data-c="Terra"] .pc-lvn')) === "30", "[party] kept after reload");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.join(SHOTS, "26-party-phone-dark.png"), fullPage: false });
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "[party] no horizontal scroll at phone width");
  await ctx.close();
}

// Tool shortcuts: top bar on iPad, tab bar along the bottom on phones.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(base);
  await page.waitForSelector(".walk");
  const inBar = await page.evaluate(() => document.getElementById("shortcuts").getBoundingClientRect().top < 60);
  check(inBar && await page.locator("#shortcuts .sc").count() === 7, "[shortcuts] seven shortcuts in the top bar on iPad");
  for (const [id, title] of [["#wikiBtn", "Wiki"], ["#partyBtn", "Party"], ["#ragesBtn", "Gau's Rages"], ["#gearBtn", "Inventory"], ["#monsterBtn", "Monster intel"]]) {
    await page.click(id);
    await page.waitForFunction((t) => document.querySelector("main h1")?.textContent === t, title);
    check(await page.getAttribute(id, "aria-current") === "page", `[shortcuts] ${id} opens its page and is highlighted`);
  }
  await page.click("#mapsBtn");
  await page.waitForSelector(".wmap");
  check(await page.getAttribute("#mapsBtn", "aria-current") === "page", "[shortcuts] Map opens the world map");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "#/party");
  await page.waitForSelector(".party");
  const bottom = await page.evaluate(() => { const r = document.getElementById("shortcuts").getBoundingClientRect(); return Math.round(r.bottom) === innerHeight && r.top > innerHeight - 90; });
  check(bottom, "[shortcuts] tab bar along the bottom on phones");
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "[shortcuts] no horizontal scroll at phone width");
  await page.screenshot({ path: path.join(SHOTS, "30-tabbar-phone.png") });
  await page.click("#mapsBtn");
  await page.waitForSelector(".wmap");
  check(await noScroll(page), "[shortcuts] world map fits a phone");
  await page.screenshot({ path: path.join(SHOTS, "31-tabbar-map.png") });
  await ctx.close();
}

// Walkthrough.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base);
  await page.waitForSelector(".walk");
  await page.evaluate(() => localStorage.setItem("ff6g:names", JSON.stringify([{ from: "Terra", to: "Prns Donut" }])));
  await page.reload();
  await page.click("#walkBtn");
  await page.waitForSelector(".walk .wt-list");
  const chapters = await page.locator(".wt-list li").count();
  check(chapters >= 10, `[walk] index lists the chapters (${chapters})`);
  await page.click('.wt-list a[href="#/walk/1"]');
  await page.waitForSelector(".walk-ch .wt-boss");
  const body = await page.textContent(".walk-ch");
  check(/Prns Donut/.test(body) && !/\bTerra\b/.test(body.replace(/Prns Donut/g, "")), "[walk] chapters use your character names");
  check(await page.locator('.walk-ch a.wt-mon[href="#/monsters/Ymir"]').count() >= 1, "[walk] bosses link to Monster intel");
  await page.screenshot({ path: path.join(SHOTS, "32-walk-chapter.png") });
  await page.click("#walkDone");
  await page.click('.pager a[rel="next"]');
  await page.waitForFunction(() => /#\/walk\/2$/.test(location.hash));
  await page.click('.walk-ch a.wt-mon >> nth=0');
  await page.waitForSelector(".mn-card");
  check(true, "[walk] a monster link opens its card");
  await page.goto(base + "#/walk");
  await page.waitForSelector(".wt-list");
  check(await page.locator('.wt-list a.done[href="#/walk/1"]').count() === 1 && /Continue/.test(await page.textContent(".walk .continue")), "[walk] done marks and Continue are kept");
  await ctx.close();
}

// Monster intel.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(base);
  await page.waitForSelector(".walk");
  await page.click("#monsterBtn");
  await page.waitForSelector(".monsters");
  const cols = await page.evaluate(() => getComputedStyle(document.getElementById("mnGrid")).gridTemplateColumns.split(" ").length);
  const cards = await page.locator(".mn-pick").count();
  check(cols === 3 && cards > 300, `[monsters] 3-column picture grid of ${cards} monsters`);
  check(await page.locator(".mn-pick", { hasText: "Ymir" }).count() === 1 && await page.locator(".mn-pick", { hasText: "Kaiser Dragon" }).count() === 0, "[monsters] Pixel Remaster monsters only (no GBA-only ones)");
  check(await page.locator(".mn-pic").first().getAttribute("referrerpolicy") === "no-referrer", "[monsters] pictures load without a referrer");
  await page.fill("#mnQ", "leaf");
  check(await page.locator("li:not([hidden]) > .mn-pick").count() >= 1 && await page.locator("li:not([hidden]) > .mn-pick", { hasText: "Guard" }).count() === 0, "[monsters] typing filters the grid");
  await page.fill("#mnQ", "Leaf Bunny");
  await page.waitForSelector(".mn-card");
  const leaf = await page.textContent(".mn-card");
  check(/Weak to\s*Fire\s*Water/.test(leaf) && /Absorbs\s*Ice/.test(leaf) && /HP\s*33/.test(leaf), "[monsters] exact name opens its card with weaknesses and stats");
  check(/#\/monsters\/Leaf%20Bunny$/.test(page.url()), "[monsters] selected monster kept in the URL");
  await page.fill("#mnQ", "vomammoth");
  await page.waitForFunction(() => /Megalodoth/.test(document.getElementById("mnName")?.textContent || ""));
  check(/Steal\s*Potion common · Hi-Potion rare/.test(await page.textContent(".mn-card")), "[monsters] SNES name finds the monster; steals show odds");
  await page.fill("#mnQ", "ultr");
  await page.press("#mnQ", "Enter");
  await page.waitForFunction(() => /Ultros/.test(document.getElementById("mnName")?.textContent || ""));
  const tabs = await page.locator(".mn-forms button").count();
  await page.locator(".mn-forms button").nth(1).click();
  check(tabs >= 2 && await page.locator('.mn-forms button[aria-selected="true"]').textContent() !== (await page.locator(".mn-forms button").first().textContent()), `[monsters] Enter picks the first match; forms switch (${tabs})`);
  await page.screenshot({ path: path.join(SHOTS, "23-monsters.png") });
  await page.evaluate(() => localStorage.setItem("ff6g:rages", JSON.stringify(["Templar", "Stray Cat", "Guard", "Imperial Soldier"])));
  await page.fill("#mnQ", "");
  await page.fill("#mnQ", "Leaf Bunny");
  await page.waitForSelector(".mn-rages");
  const adv = await page.textContent(".mn-rages");
  await page.locator(".mn-card").screenshot({ path: path.join(SHOTS, "28-monster-rages.png") });
  check(/Templar · Fira weak ×2/.test(adv) && adv.indexOf("Templar") < adv.indexOf("Stray Cat"), "[monsters] Gau's best Rages put a weakness (Fire) first");
  await page.fill("#mnQ", "");
  await page.fill("#mnQ", "Bomb");
  await page.waitForFunction(() => /^Bomb/.test(document.getElementById("mnName")?.textContent || ""));
  check(/Avoid: .*Templar \(Fira, absorbed\)/.test(await page.textContent(".mn-card")), "[monsters] Rages a monster absorbs are flagged (Bomb absorbs Fire)");
  await page.evaluate(() => localStorage.removeItem("ff6g:rages"));
  await page.fill("#mnQ", "Stray Cat");
  await page.waitForSelector("#mnRage");
  await page.check("#mnRage");
  check((await page.evaluate(() => localStorage.getItem("ff6g:rages"))).includes("Stray Cat") && (await page.textContent("#rageCnt")) === "1/252", "[monsters] Rage checkbox updates Gau's Rages");
  await page.reload();
  await page.waitForSelector(".mn-card");
  check((await page.textContent("#mnName")).includes("Stray Cat") && await page.isChecked("#mnRage"), "[monsters] reload reopens the monster");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(SHOTS, "24-monsters-phone-dark.png") });
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "[monsters] no horizontal scroll at phone width");
  await ctx.close();
}

// Inventory tracker.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base);
  await page.waitForSelector(".walk");
  await page.click('.toc-tracker[href="#/gear"]');
  await page.waitForSelector(".gear");
  const total = await page.locator(".gr").count();
  check(total > 250 && await page.locator('.gr:has-text("Zanmato")').count() === 0, `[gear] lists every Pixel Remaster item, without GBA-only gear (${total})`);
  const dagger = page.locator(".gr", { has: page.locator(".rg-name", { hasText: /^Dagger/ }) }).first();
  await dagger.locator('input[type="checkbox"]').check();
  check(await dagger.locator(".gr-n").inputValue() === "1" && (await page.textContent("#grKinds")) === "1", "[gear] checking an item sets a count of 1");
  await dagger.locator(".gr-inc").click();
  check(await dagger.locator(".gr-n").inputValue() === "2" && /150 gil/.test(await page.textContent("#grValue")), "[gear] + raises the count and the sell total");
  await dagger.locator(".gr-open").click();
  const more = await dagger.locator(".gr-more").textContent();
  check(/Buy\s*150 gil/.test(more) && /Sell\s*75 gil/.test(more) && /Sold at\s*South Figaro/.test(more) && /150 gil for 2/.test(more), "[gear] details show buy, sell, shops and the total for your count");
  await page.screenshot({ path: path.join(SHOTS, "21-gear.png") });
  await dagger.locator(".gr-n").fill("12");
  await dagger.locator(".gr-n").press("Tab");
  check(/900 gil/.test(await page.textContent("#grValue")), "[gear] typing a count updates the total");
  await page.selectOption("#grCat", "relic");
  check(await dagger.isHidden(), "[gear] kind filter hides other kinds");
  await page.selectOption("#grCat", "all");
  await page.click('#grSeg [data-v="owned"]');
  check(await page.locator(".gr:not([hidden])").count() === 1, "[gear] Have filter shows only what you have");
  await page.click('#grSeg [data-v="all"]');
  await page.fill("#grQ", "dirk");
  check(await dagger.isVisible(), "[gear] search matches SNES names");
  await page.fill("#grQ", "");
  await dagger.locator(".gr-dec").click();
  await page.reload();
  await page.waitForSelector(".gear");
  check(await page.locator(".gr", { has: page.locator(".rg-name", { hasText: /^Dagger/ }) }).first().locator(".gr-n").inputValue() === "11", "[gear] counts kept after reload");
  check((await page.textContent("#gearCnt")) === "1 kind", "[gear] panel shows how many kinds you have");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(SHOTS, "22-gear-phone-dark.png") });
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "[gear] no horizontal scroll at phone width");
  await page.evaluate(() => {
    localStorage.setItem("ff6g:gear", JSON.stringify({ "Hero's Ring": 1 }));
    localStorage.setItem("ff6g:party", JSON.stringify({ party: ["Terra"], espers: [], chars: { Terra: { met: true, level: 20, eq: { r1: "Hero's Ring" } } } }));
  });
  await page.reload();
  await page.waitForSelector(".gear");
  const ring = page.locator(".gr", { has: page.locator(".rg-name", { hasText: /^Hero's Ring/ }) }).first();
  check(await ring.locator(".gr-n").inputValue() === "2" && /worn by Terra/.test(await ring.textContent()), "[gear] counts include what characters wear, and say who");
  await ring.locator(".gr-dec").click();
  const one = await page.evaluate(() => [JSON.parse(localStorage.getItem("ff6g:gear") || "{}")["Hero's Ring"] || 0, JSON.parse(localStorage.getItem("ff6g:party")).chars.Terra.eq.r1]);
  check(one[0] === 0 && one[1] === "Hero's Ring", "[gear] lowering the count takes from the bag first");
  await ring.locator(".gr-dec").click();
  const none = await page.evaluate(() => JSON.parse(localStorage.getItem("ff6g:party")).chars.Terra.eq.r1);
  check(!none && await ring.locator(".gr-n").inputValue() === "" && /Took Hero's Ring off Terra/.test(await page.textContent("#toast")), "[gear] lowering below what's worn takes it off the character");
  await ctx.close();
}

// Color coding: names from the app's data, corrections, and the on/off switch.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base);
  const unit = await page.evaluate(async () => {
    const { buildTerms, matcher } = await import("./js/tags.js");
    const terms = buildTerms({ boss: ["Phantom Train"], enemy: ["Leaf Bunny (2)"], place: ["Veldt", "Mobliz"] }, [{ from: "Terra", to: "Prns Donut" }], [{ text: "Mobliz", kind: "none" }]);
    const m = matcher(terms);
    const hits = ("Shadow and shadow, SHADOW, Prns Donut, Kefka's, Veldt, Mobliz, the Phantom Train, Leaf Bunny".match(m.re) || []).map((h) => h + "=" + m.kindOf(h));
    return hits.join(" ");
  });
  check(unit === "Shadow=party SHADOW=party Prns Donut=party Kefka=boss Veldt=place Phantom Train=boss Leaf Bunny=enemy", `[colors] matching rules (${unit})`);

  await page.goto(base + "#/walk/1");
  await page.waitForSelector(".walk-ch");
  const kinds = await page.evaluate(() => Object.fromEntries(["party", "enemy", "boss", "place"].map((k) => [k, [...new Set([...document.querySelectorAll(".walk-ch .ent-" + k)].map((e) => e.textContent))]])));
  check(kinds.place.includes("Narshe") && kinds.party.includes("Terra"), `[colors] places and characters colored (${kinds.place.join(", ")}; ${kinds.party.join(", ")})`);
  check(kinds.boss.includes("Ymir") && kinds.enemy.includes("Guard"), "[colors] monster links colored as boss or monster");
  await page.click("#settingsBtn");
  check(/Bosses\s*\d+/.test(await page.textContent("#tagLegend")), "[colors] legend counts the names");
  await page.click("#tagAdd");
  await page.fill("#tagList li:last-child .tg-text", "Heal Force");
  await page.selectOption("#tagList li:last-child .tg-kind", "party");
  await page.click("#tagAdd");
  await page.fill("#tagList li:last-child .tg-text", "Narshe");
  await page.selectOption("#tagList li:last-child .tg-kind", "none");
  await page.screenshot({ path: path.join(SHOTS, "14-colors-settings.png") });
  await page.click("#settingsSheet [data-close]");
  await page.waitForFunction(() => document.querySelectorAll(".walk-ch .ent-party").length && [...document.querySelectorAll(".walk-ch .ent-party")].some((e) => e.textContent === "Heal Force"));
  check(true, "[colors] word added as a character");
  check(await page.locator(".walk-ch .ent", { hasText: "Narshe" }).count() === 0, "[colors] word set to Not colored");
  await page.screenshot({ path: path.join(SHOTS, "15-colors-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.join(SHOTS, "16-colors-dark.png") });
  await page.click("#settingsBtn");
  await page.click("#colorNames");
  await page.click("#settingsSheet [data-close]");
  await page.waitForFunction(() => !document.querySelector(".walk-ch .body .ent:not(.wt-mon)"));
  check(true, "[colors] switch turns colors off");
  await ctx.close();
}

// Wiki: colored names link to articles, summaries pop up, later story stays folded.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base + "#/walk/19");
  await page.waitForSelector(".walk-ch .body");
  const mog = page.locator('.walk-ch .body a.ent-party[href="#/wiki/party/mog"]').first();
  check(await mog.count() === 1, "[wiki] Mog in the walkthrough links to his article");
  check(await page.locator('.walk-ch .body a.ent-item[href="#/wiki/item/gold-hairpin"]').count() >= 1, "[wiki] items are colored and linked");
  check(!(await page.evaluate(() => [...document.querySelectorAll("#view .ent")].some((e) => e.textContent === "Don"))), "[wiki] \"Don't\" isn't colored as a monster");
  await mog.scrollIntoViewIfNeeded();
  await mog.hover();
  await page.waitForSelector("#peek:not([hidden])");
  check(/Mog/.test(await page.textContent("#peek .pk-name")) && (await page.textContent("#peek .pk-sum")).length > 20, "[wiki] hovering shows a summary");
  await page.screenshot({ path: path.join(SHOTS, "40-wiki-peek.png") });
  const y = await page.evaluate(() => scrollY);
  await mog.click();
  await page.waitForFunction(() => document.querySelector(".wk-art h1")?.textContent === "Mog");
  check(await page.locator('.wk-refs a[href="#/walk/19"]').count() === 1, "[wiki] article lists the chapters that mention it");
  check(await page.locator('.wk-body a.ent-party').count() > 0 && await page.locator('.wk-body a[href="#/wiki/party/mog"]').count() === 0, "[wiki] an article links others but not itself");
  check(await page.locator(".wk-later").count() >= 1 && !(await page.locator(".wk-later").first().evaluate((d) => d.open)), "[wiki] later story is folded");
  await page.screenshot({ path: path.join(SHOTS, "41-wiki-article.png"), fullPage: true });
  await page.click(".wk-back");
  await page.waitForSelector(".walk-ch .body");
  await page.waitForFunction((y0) => Math.abs(scrollY - y0) < 40, y);
  check(true, "[wiki] back to the chapter, at the same place");
  // The monster links get a summary too.
  await page.goto(base + "#/walk/1");
  await page.waitForSelector(".walk-ch a.wt-mon");
  await page.hover('.walk-ch a.wt-mon[href="#/monsters/Ymir"]');
  await page.waitForSelector("#peek:not([hidden])");
  check(/Ymir/.test(await page.textContent("#peek")) && /HP/.test(await page.textContent("#peek")), "[wiki] monster links show their stats");
  // Index and filter.
  await page.goto(base + "#/wiki");
  await page.waitForSelector(".wk-group");
  check(await page.locator(".wk-group").count() >= 8, "[wiki] index lists the groups");
  await page.fill("#wkQ", "narshe");
  check(await page.locator('.wk-list li:not([hidden]) a[href="#/wiki/place/narshe"]').count() === 1, "[wiki] filter finds a place");
  await page.press("#wkQ", "Enter");
  await page.waitForFunction(() => /#\/wiki\/place\//.test(location.hash));
  check(true, "[wiki] Enter opens the first match");
  // Reached the end: nothing folded.
  await page.evaluate(() => localStorage.setItem("ff6g:walkLast", JSON.stringify("the-final-battle")));
  await page.goto(base + "#/wiki/party/mog");
  await page.reload();
  await page.waitForSelector(".wk-art");
  check(await page.locator(".wk-later").count() === 0, "[wiki] later story shows once you've reached it");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.join(SHOTS, "42-wiki-article-dark.png"), fullPage: true });
  // Search finds articles.
  await page.click("#searchBtn");
  await page.fill("#q", "gold hair");
  await page.waitForSelector('.results a[href="#/wiki/item/gold-hairpin"]');
  check(true, "[wiki] search finds wiki articles");
  await ctx.close();
}
// Wiki on a phone with touch: the first tap shows the summary, its button opens the article.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base + "#/walk/19");
  await page.waitForSelector(".walk-ch .body");
  const mog = page.locator('.walk-ch .body a[href="#/wiki/party/mog"]').first();
  await mog.scrollIntoViewIfNeeded();
  await mog.tap();
  await page.waitForSelector("#peek:not([hidden])");
  check(/#\/walk\/19$/.test(page.url()), "[wiki] a tap shows the summary and stays on the page");
  await page.screenshot({ path: path.join(SHOTS, "43-wiki-peek-phone.png") });
  await page.tap("#peek .pk-open");
  await page.waitForSelector(".wk-art");
  check(await noScroll(page), "[wiki] article fits a phone");
  await page.goto(base + "#/wiki");
  await page.waitForSelector(".wk-group");
  check(await noScroll(page), "[wiki] index fits a phone");
  await ctx.close();
}

// Backup: save on one device, restore on a fresh one, and restore over existing data.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base);
  await page.waitForSelector(".walk");
  await page.goto(base + "#/walk/2");
  await page.waitForSelector("#walkDone");
  await page.click("#walkDone");
  await page.click("#settingsBtn");
  await page.click("#nameAdd");
  await page.fill("#nameList li:last-child .nm-from", "Terra");
  await page.fill("#nameList li:last-child .nm-to", "Prns Donut");
  await page.press("#nameList li:last-child .nm-to", "Tab");
  await page.click("#tagAdd");
  await page.fill("#tagList li:last-child .tg-text", "Heal Force");
  await page.press("#tagList li:last-child .tg-text", "Tab");
  await page.evaluate(() => localStorage.setItem("ff6g:rages", JSON.stringify(["Stray Cat", "Leaf Bunny"])));
  await page.evaluate(() => localStorage.setItem("ff6g:gear", JSON.stringify({ Dagger: 3, Potion: 14 })));
  await page.evaluate(() => localStorage.setItem("ff6g:party", JSON.stringify({ party: ["Terra"], chars: { Terra: { met: true, level: 12, goal: "magic", eq: { rh: "Mythril Knife" }, lock: {} } } })));
  await page.screenshot({ path: path.join(SHOTS, "12-backup-settings.png") });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#backupBtn")]);
  const backup = path.join(SHOTS, "backup.zip");
  await dl.saveAs(backup);
  check(/^FF6 Guide backup \d{4}-\d\d-\d\d\.zip$/.test(dl.suggestedFilename()), `[backup] saved as ${dl.suggestedFilename()}`);
  const manifest = await page.evaluate(async (bytes) => { const { unzip } = await import("./js/zip.js"); const e = await unzip(new Uint8Array(bytes).buffer); return JSON.parse(new TextDecoder().decode(e.find((x) => x.name === "backup.json").data)); }, [...fs.readFileSync(backup)]);
  check(!("guide" in manifest) && !("maps" in manifest) && JSON.stringify(manifest.progress.walkDone) === '["escape-from-narshe"]', "[backup] holds walkthrough progress, no guide or maps");
  await page.click("#settingsSheet [data-close]");

  // Restore on a fresh device: nothing to replace, so no question.
  const ctx2 = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const p2 = await ctx2.newPage();
  watch(p2);
  await p2.goto(base);
  await p2.waitForSelector(".walk");
  await Promise.all([p2.waitForEvent("load"), p2.setInputFiles("#backupFile", backup)]);
  await p2.waitForSelector(".walk-ch");
  check(/Escape from Narshe/.test(await p2.textContent(".walk-ch .sec-h")), "[backup] restore resumes at the last chapter read");
  check(JSON.stringify(await doneKeys(p2)) === "[2]", "[backup] restored done marks");
  check((await p2.textContent(".walk-ch")).includes("Prns Donut"), "[backup] restored character names");
  check(/Heal Force/.test(await p2.evaluate(() => localStorage.getItem("ff6g:tags"))), "[backup] restored color-coding fixes");
  check(JSON.stringify(await p2.evaluate(() => JSON.parse(localStorage.getItem("ff6g:rages")))) === '["Stray Cat","Leaf Bunny"]', "[backup] restored Gau's Rages");
  check(JSON.stringify(await p2.evaluate(() => JSON.parse(localStorage.getItem("ff6g:gear")))) === '{"Dagger":3,"Potion":14}', "[backup] restored inventory counts");
  check(await p2.evaluate(() => { const p = JSON.parse(localStorage.getItem("ff6g:party")); return p.party[0] === "Terra" && p.chars.Terra.level === 12 && p.chars.Terra.eq.rh === "Mythril Knife"; }), "[backup] restored party, levels and load-outs");

  // Restore over existing data asks first; Cancel keeps things, Replace restores.
  await p2.click("#settingsBtn");
  await p2.fill("#nameList .nm-to", "Someone Else");
  await p2.press("#nameList .nm-to", "Tab");
  await p2.setInputFiles("#backupFile", backup);
  await p2.waitForSelector("#restoreDialog[open]");
  check(/1 chapter done/.test(await p2.textContent("#restoreWhat")), `[backup] dialog lists the contents (${await p2.textContent("#restoreWhat")})`);
  await p2.screenshot({ path: path.join(SHOTS, "13-restore-dialog.png") });
  await p2.click("#restoreNo");
  check((await p2.textContent(".walk-ch")).includes("Someone Else"), "[backup] Cancel keeps current data");
  await p2.click("#settingsBtn");
  await p2.setInputFiles("#backupFile", backup);
  await p2.waitForSelector("#restoreDialog[open]");
  await Promise.all([p2.waitForEvent("load"), p2.click("#restoreYes")]);
  await p2.waitForSelector(".walk-ch");
  check((await p2.textContent(".walk-ch")).includes("Prns Donut"), "[backup] Replace restores the backup");

  // Some other .zip chosen as a backup is explained.
  const other = await p2.evaluate(async () => { const { zip } = await import("./js/zip.js"); return [...new Uint8Array(await zip([{ name: "maps.json", data: "{}" }]).arrayBuffer())]; });
  await p2.setInputFiles("#backupFile", { name: "pack.zip", mimeType: "application/zip", buffer: Buffer.from(other) });
  await p2.waitForFunction(() => /isn't a backup/.test(document.getElementById("toast").textContent));
  check(true, "[backup] another .zip chosen as a backup is explained");

  // A backup from before 0.20.0 (with the imported guide) still restores everything else.
  const old = await p2.evaluate(async () => {
    const { zip } = await import("./js/zip.js");
    const m = { format: "ff6-guide-backup", version: 1, app: "0.19.0", createdAt: new Date().toISOString(),
      guide: { file: "guide/guide.txt", format: "text", name: "guide.txt", source: "text", importedAt: 1 },
      names: [{ from: "Terra", to: "Old Name" }], tags: [], rages: ["Guard"], gear: {}, party: null,
      progress: { done: ["4.1.1"], last: "4.1.1", walkDone: ["the-raid-on-narshe"] },
      maps: [{ id: "m1", file: "maps/m1.png", title: "Old map", type: "image/png" }], links: [{ id: "l1", title: "Old link", url: "https://example.com" }] };
    return [...new Uint8Array(await zip([{ name: "backup.json", data: JSON.stringify(m) }, { name: "guide/guide.txt", data: "old guide text" }, { name: "maps/m1.png", data: "png" }]).arrayBuffer())];
  });
  await p2.click("#settingsBtn");
  await p2.setInputFiles("#backupFile", { name: "old.zip", mimeType: "application/zip", buffer: Buffer.from(old) });
  await p2.waitForSelector("#restoreDialog[open]");
  await Promise.all([p2.waitForEvent("load"), p2.click("#restoreYes")]);
  await p2.waitForSelector(".walk");
  const left = await p2.evaluate(async () => ({ guide: await (await import("./js/store.js")).idbGet("guide"), done: localStorage.getItem("ff6g:done"), names: localStorage.getItem("ff6g:names"), walk: localStorage.getItem("ff6g:walkDone") }));
  check(!left.guide && left.done === null && /Old Name/.test(left.names) && /raid-on-narshe/.test(left.walk), "[backup] an older backup restores without its guide or maps");
  await ctx2.close();
  await ctx.close();
}

// Google Drive sync, against a stand-in for Google sign-in and the Drive API.
{
  const drive = { file: null, bytes: null, n: 0 };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,OPTIONS", "access-control-expose-headers": "Location" };
  const fakeGoogle = async (ctx, device) => {
    await ctx.route("https://accounts.google.com/**", (route) => {
      const u = new URL(route.request().url());
      route.fulfill({ status: 302, headers: { location: `${u.searchParams.get("redirect_uri")}#access_token=tok&token_type=Bearer&expires_in=3600&state=${u.searchParams.get("state")}` } });
    });
    await ctx.route("https://www.googleapis.com/**", async (route) => {
      const req = route.request(), u = new URL(req.url());
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const json = (o, extra = {}) => route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json", ...extra }, body: JSON.stringify(o) });
      if (u.pathname === "/drive/v3/files" && req.method() === "GET") return json({ files: drive.file ? [drive.file] : [] });
      if (u.pathname.startsWith("/upload/drive/v3/files") && (req.method() === "POST" || req.method() === "PATCH")) return json({}, { location: "https://www.googleapis.com/upload/session/1" });
      if (u.pathname === "/upload/session/1" && req.method() === "PUT") {
        drive.bytes = req.postDataBuffer();
        drive.n++;
        drive.file = { id: "f1", modifiedTime: new Date(Date.now() + drive.n * 1000).toISOString(), size: String(drive.bytes.length), appProperties: { device } };
        return json(drive.file);
      }
      if (u.pathname === "/drive/v3/files/f1" && u.searchParams.get("alt") === "media") return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/zip" }, body: drive.bytes });
      return route.fulfill({ status: 404, headers: cors });
    });
  };
  const setup = async (device) => {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    await fakeGoogle(ctx, device);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return { ctx, page };
  };

  const A = await setup("Chrome on Linux");
  await A.page.goto(base);
  await A.page.waitForSelector(".walk");
  await A.page.evaluate(() => localStorage.setItem("ff6g:names", JSON.stringify([{ from: "Terra", to: "Prns Donut" }])));
  await A.page.click("#settingsBtn");
  await A.page.click("#gdSave");
  check(await A.page.locator("#gdSetup[open]").count() === 1 && /client ID/.test(await A.page.textContent("#toast")), "[drive] without a client ID, Save explains the setup");
  await A.page.fill("#gdClient", "test-client.apps.googleusercontent.com");
  await A.page.press("#gdClient", "Tab");
  await Promise.all([A.page.waitForURL(/ember|#\/|\/$/), A.page.click("#gdSave")]);
  await A.page.waitForFunction(() => /Saved to Google Drive/.test(document.getElementById("toast").textContent), null, { timeout: 15000 });
  check(drive.bytes && drive.bytes.length > 200 && !/access_token/.test(A.page.url()), "[drive] signs in, saves the backup to Drive, and cleans up the address");

  const B = await setup("Safari on iPad");
  await B.page.goto(base);
  await B.page.evaluate(() => localStorage.setItem("ff6g:gdriveClient", JSON.stringify("test-client.apps.googleusercontent.com")));
  await B.page.reload();
  await B.page.click("#settingsBtn");
  await B.page.click("#gdRestore");
  // The page signs in, comes back, restores and reloads: poll through the navigations.
  let restored = false;
  for (let t = Date.now(); !restored && Date.now() - t < 20000;) {
    restored = await B.page.evaluate(() => (localStorage.getItem("ff6g:names") || "").includes("Prns Donut")).catch(() => false);
    if (!restored) await new Promise((r) => setTimeout(r, 200));
  }
  await B.page.waitForLoadState();
  await B.page.waitForSelector(".walk, .walk-ch");
  check(restored, "[drive] a fresh browser restores everything from Drive");
  await B.page.click("#settingsBtn");
  await B.page.click("#gdSave");
  await B.page.waitForFunction(() => /Saved to Google Drive/.test(document.getElementById("toast").textContent), null, { timeout: 15000 });

  await A.page.click("#settingsBtn");
  await A.page.click("#gdSave");
  await A.page.waitForSelector("#cloudDialog[open]");
  check(/Safari on iPad/.test(await A.page.textContent("#cloudFrom")), "[drive] warns before overwriting a newer copy saved elsewhere");
  await A.page.screenshot({ path: path.join(SHOTS, "29-drive-conflict.png") });
  await A.page.click("#cloudNo");
  check(drive.file.appProperties.device === "Safari on iPad", "[drive] Cancel leaves the Drive copy alone");
  await A.ctx.close();
  await B.ctx.close();

  // Auto-save, with a fake clock so the 30-second wait doesn't slow the test.
  drive.file = null;
  const C = await setup("Firefox on Mac");
  await C.page.clock.install();
  await C.page.goto(base);
  await C.page.evaluate(() => localStorage.setItem("ff6g:gdriveClient", JSON.stringify("test-client.apps.googleusercontent.com")));
  await C.page.reload();
  await C.page.waitForSelector(".walk");
  await C.page.click("#settingsBtn");
  await C.page.click("#gdAuto");
  check(/Paused until you sign in/.test(await C.page.textContent("#gdAutoStatus")) && await C.page.locator("#settingsBtn.has-dot").count() === 1, "[autosave] turned on before signing in, it asks you to sign in and marks the menu");
  await Promise.all([C.page.waitForURL(/#\/|\/$/), C.page.click("#gdSave")]);
  await C.page.waitForFunction(() => /Saved to Google Drive/.test(document.getElementById("toast").textContent), null, { timeout: 15000 });
  const n0 = drive.n;
  const edit = (to) => C.page.evaluate(async (to) => (await import("./js/names.js")).saveNames([{ from: "Terra", to }]), to);
  const uploaded = async (n) => { for (let t = Date.now(); Date.now() - t < 5000;) { if (drive.n >= n) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  await edit("Quick One");
  await C.page.clock.fastForward(10000);
  await edit("Quick Two");
  await C.page.clock.fastForward(25000);
  await new Promise((r) => setTimeout(r, 500));
  check(drive.n === n0 && /Waiting/.test(await C.page.textContent("#gdAutoStatus")), "[autosave] edits close together wait for a pause");
  await C.page.click("#settingsBtn");
  await C.page.clock.runFor(1000);
  const next = await C.page.textContent("#gdAutoNext");
  check(/Next auto-save in [1-5] s/.test(next), `[autosave] Settings counts down to the next save (${next})`);
  await C.page.clock.fastForward(5000);
  check(await uploaded(n0 + 1) && drive.n === n0 + 1 && drive.bytes.includes("Quick Two"), "[autosave] one upload 30 seconds after the last edit");
  await C.page.waitForFunction(() => /On\./.test(document.getElementById("gdAutoStatus").textContent));
  const synced = await C.page.evaluate(() => { const t = new Date(JSON.parse(localStorage.getItem("ff6g:gdriveSync")).modifiedTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); return [t, document.getElementById("gdStatus").textContent, document.getElementById("gdAutoStatus").textContent]; });
  check(synced[1].includes(synced[0]) && synced[2].includes(synced[0]), `[autosave] both Drive status lines show the auto-save time (${synced[0]})`);
  await C.page.waitForFunction(() => /On\./.test(document.getElementById("gdAutoStatus").textContent));
  for (let i = 0; i < 12; i++) { await edit("Busy " + i); await C.page.clock.fastForward(25000); }
  check(await uploaded(n0 + 2) && drive.n === n0 + 2, "[autosave] steady edits still save within 5 minutes");
  await C.page.waitForFunction(() => !/Waiting/.test(document.getElementById("gdAutoStatus").textContent));
  await edit("Hidden");
  await C.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  check(await uploaded(n0 + 3) && drive.bytes.includes("Hidden"), "[autosave] saves right away when the app goes to the background");
  await C.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); });
  await C.page.waitForFunction(() => /On\./.test(document.getElementById("gdAutoStatus").textContent));
  drive.file = { ...drive.file, modifiedTime: new Date(Date.now() + 99000).toISOString(), appProperties: { device: "Safari on iPad" } };
  await edit("Conflict");
  await C.page.clock.fastForward(31000);
  await C.page.waitForFunction(() => /Stopped/.test(document.getElementById("gdAutoStatus").textContent), null, { timeout: 5000 }).catch(() => {});
  check(/Stopped/.test(await C.page.textContent("#gdAutoStatus")) && drive.n === n0 + 3 && await C.page.locator("#settingsBtn.has-dot").count() === 1, "[autosave] stops instead of overwriting a newer copy from another browser");
  await C.page.screenshot({ path: path.join(SHOTS, "30-autosave.png") });
  check(/stopped/.test(await C.page.textContent("#gdAutoNext")), "[autosave] the countdown says auto-save is stopped");
  await C.page.keyboard.press("Escape");
  await C.page.click("#syncBtn");
  await C.page.waitForSelector("#cloudDialog[open]");
  await C.page.click("#cloudYes");
  check(await uploaded(n0 + 4) && drive.bytes.includes("Conflict"), "[sync] the top bar button saves to Drive, after warning about a newer copy");
  await C.ctx.close();
}

await browser.close();
server.close();
console.log(errors.length ? `\n${errors.length} problem(s):\n` + errors.join("\n") : "\nAll checks passed.");
process.exit(errors.length ? 1 : 0);
