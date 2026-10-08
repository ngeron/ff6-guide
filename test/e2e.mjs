// Headless smoke test: serves the app, imports a PDF and a text file, and checks the main views.
// Usage: node test/e2e.mjs [path-to-pdf] [screenshot-dir]
// Make a test PDF with: python3 test/make_fixture.py --pdf test/output/ember-crown.pdf
// Requires Playwright (npm i -D playwright) and a Chromium build.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PDF = process.argv[2];
const SHOTS = process.argv[3] || path.join(ROOT, "test/output");
fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
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

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base);
  await page.waitForSelector(".import");
  check(true, `[${scheme}] import view shown with no guide`);
  if (scheme === "light") await page.screenshot({ path: path.join(SHOTS, "1-import.png") });

  const file = scheme === "light" && PDF ? PDF : path.join(ROOT, "test/fixtures/ember-crown-guide.txt");
  await page.setInputFiles("#file", file);
  await page.waitForSelector(".home", { timeout: 60000 });
  check(true, `[${scheme}] imported ${path.basename(file)}`);
  const secs = await page.locator(".toc-list a, .toc-list summary").count();
  check(secs >= 4, `[${scheme}] contents sidebar lists sections (${secs})`);
  await page.screenshot({ path: path.join(SHOTS, `2-home-${scheme}.png`) });

  await page.click('.chapters a[href="#/s/3.0"]');
  await page.waitForSelector("article.sec .toc");
  await page.click('.body .toc a[href="#/s/3.1.1"]');
  await page.waitForFunction(() => /Harrowgate/.test(document.querySelector(".sec-h")?.textContent || ""));
  const h = await page.textContent(".sec-h");
  check(/Harrowgate/.test(h), `[${scheme}] section page renders heading (${h.trim()})`);
  check(await page.locator(".body .pre pre").count() >= 1, `[${scheme}] shop table kept as monospace`);
  check(await page.locator(".body .meta").count() >= 1, `[${scheme}] Opponents box rendered`);
  await page.screenshot({ path: path.join(SHOTS, `3-section-${scheme}.png`), fullPage: true });

  await page.click("#doneBtn");
  check(await page.locator('.toc-list a.done[data-key="3.1.1"]').count() === 1, `[${scheme}] mark done updates contents`);

  await page.click("#searchBtn");
  await page.fill("#q", "clockwork vault puzzle");
  await page.waitForSelector(".results li");
  if (scheme === "light") await page.screenshot({ path: path.join(SHOTS, "4-search.png") });
  await page.click(".results li a");
  await page.waitForSelector("mark.hit");
  check((await page.textContent(".sec-h")).includes("Clockwork Vault puzzle"), `[${scheme}] search result opens section with highlight`);

  await page.reload();
  await page.waitForSelector("article.sec");
  check((await page.textContent(".sec-h")).includes("Clockwork Vault puzzle"), `[${scheme}] reload resumes last section from storage`);

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

// Phone-width drawer behaviour.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.goto(base);
await page.setInputFiles("#file", path.join(ROOT, "test/fixtures/ember-crown-guide.txt"));
await page.waitForSelector(".home");
check(await page.locator("#toc").isHidden(), "[phone] contents hidden by default");
await page.click("#tocBtn");
check(await page.locator("#toc").isVisible(), "[phone] contents drawer opens");
await page.screenshot({ path: path.join(SHOTS, "6-phone-drawer.png") });
await page.click('details[data-group="3.0"] summary');
await page.click('.toc-list a[data-key="3.1.2"]');
await page.waitForSelector("article.sec");
check(await page.locator("#toc").isHidden(), "[phone] drawer closes after picking a section");
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
check(!overflow, "[phone] no horizontal page scroll");
await page.screenshot({ path: path.join(SHOTS, "7-phone-section.png"), fullPage: true });
await ctx.close();

// Reset from the contents panel.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(base);
  await page.setInputFiles("#file", path.join(ROOT, "test/fixtures/ember-crown-guide.txt"));
  await page.waitForSelector(".home");
  await page.goto(base + "#/s/3.1.1");
  await page.waitForSelector("#doneBtn");
  await page.click("#doneBtn");
  check(await page.locator("#resetBtn").isVisible(), "[reset] button shown at the bottom of the contents panel");
  await page.click("#resetBtn");
  check(await page.locator("#resetDialog").isVisible(), "[reset] confirmation dialog opens");
  check(await page.evaluate(() => document.activeElement && document.activeElement.id) === "resetNo", "[reset] 'No' is focused by default");
  await page.screenshot({ path: path.join(SHOTS, "8-reset-dialog.png") });
  await page.keyboard.press("Enter");
  check(await page.locator("#resetDialog").isHidden(), "[reset] pressing Enter chooses No and closes");
  check(await page.locator("article.sec").count() === 1, "[reset] guide still loaded after No");
  await page.click("#resetBtn");
  await page.keyboard.press("Escape");
  check(await page.locator("#resetDialog").isHidden(), "[reset] Escape cancels");
  await page.click("#resetBtn");
  await Promise.all([page.waitForEvent("load"), page.click("#resetYes")]);
  await page.waitForSelector(".import");
  check(true, "[reset] Yes reloads to the import page");
  check(await page.evaluate(() => location.hash) === "", "[reset] URL reset to the start page");
  const left = await page.evaluate(async () => {
    const m = await import("./js/store.js");
    return { guide: await m.loadGuide(), done: localStorage.getItem("ff6g:done"), last: localStorage.getItem("ff6g:last") };
  });
  check(!left.guide && left.done === null && left.last === null, "[reset] guide, done marks and last section purged");
  check(await page.locator("#tocBtn").isHidden(), "[reset] contents button hidden with no guide");
  await ctx.close();
}

// Maps: import a map pack, view, zoom, section chips, links.
for (const vp of [{ width: 1180, height: 820, tag: "ipad" }, { width: 390, height: 844, tag: "phone" }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.tag === "phone" ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base);
  await page.setInputFiles("#file", path.join(ROOT, "test/fixtures/ember-crown-guide.txt"));
  await page.waitForSelector(".home");
  if (vp.tag === "phone") await page.click("#tocBtn");
  await page.click("#tabMaps");
  check(await page.locator(".mp-empty").count() === 2, `[maps ${vp.tag}] empty states shown before import`);
  await page.setInputFiles("#mapFile", path.join(ROOT, "test/fixtures/ember-crown-maps.zip"));
  await page.waitForFunction(() => document.querySelectorAll(".mp-item").length === 4, null, { timeout: 15000 });
  check(true, `[maps ${vp.tag}] map pack added 4 maps`);
  check(await page.locator(".mp-link").count() === 3, `[maps ${vp.tag}] map pack added 3 links`);
  const titles = await page.locator(".mp-item .mp-t").allTextContents();
  check(/^World map/.test(titles[0]) && /Clockwork Vault/.test(titles[3]), `[maps ${vp.tag}] titles and order come from maps.json`);
  await page.screenshot({ path: path.join(SHOTS, `9-maps-panel-${vp.tag}.png`) });
  await page.click(".mp-item >> nth=0");
  await page.waitForSelector("#mapImg");
  await page.waitForFunction(() => document.getElementById("mapImg").naturalWidth > 0);
  check(await page.evaluate(() => document.getElementById("mapImg").naturalWidth) === 2400, `[maps ${vp.tag}] world map image loads at full size`);
  if (vp.tag === "phone") check(await page.locator("#toc").isHidden(), "[maps phone] drawer closes when a map is opened");
  const pct1 = await page.textContent("#zPct");
  await page.click("#zIn");
  const pct2 = await page.textContent("#zPct");
  check(parseInt(pct2) > parseInt(pct1), `[maps ${vp.tag}] zoom in (${pct1} -> ${pct2})`);
  await page.click("#zFit");
  check(await page.evaluate(() => { const st = document.getElementById("stage"); return st.scrollWidth <= st.clientWidth + 2 && st.scrollHeight <= st.clientHeight + 2; }), `[maps ${vp.tag}] Fit shows the whole map`);
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `[maps ${vp.tag}] no horizontal page scroll in viewer`);
  await page.screenshot({ path: path.join(SHOTS, `10-map-viewer-${vp.tag}.png`) });

  await page.goto(base + "#/s/3.1.3");
  await page.waitForSelector(".sec-maps");
  check((await page.textContent(".sec-maps")).includes("Old Quarry"), `[maps ${vp.tag}] section 3.1.3 shows its map chip`);
  await page.goto(base + "#/s/3.7.4");
  await page.waitForSelector(".sec-maps");
  check(await page.locator(".sec-maps a.ext").count() === 1, `[maps ${vp.tag}] section 3.7.4 shows its external link chip`);

  if (vp.tag === "ipad") {
    // Edit a map's section, add and remove a link, delete a map.
    await page.click(".mp-item >> nth=2");
    await page.waitForSelector(".map-edit summary");
    await page.click(".map-edit summary");
    await page.fill("#mapSec", "3.1.2");
    await page.click('#mapForm button[type="submit"]');
    await page.goto(base + "#/s/3.1.2");
    await page.waitForSelector(".sec-maps");
    check((await page.textContent(".sec-maps")).includes("Old Quarry"), "[maps ipad] changing a map's section moves its chip");
    const form = page.locator(".mp-form");
    if (!(await form.evaluate((d) => d.open))) await page.click(".mp-form summary");
    await page.fill("#linkTitle", "Fan wiki");
    await page.fill("#linkUrl", "wiki.example.com/ember");
    await page.click('#linkForm button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll(".mp-link").length === 4);
    check((await page.getAttribute(".mp-link >> nth=3", "href")) === "https://wiki.example.com/ember", "[maps ipad] link form adds https:// when missing");
    await page.click('[data-unlink] >> nth=3');
    await page.click('[data-unlink] >> nth=3');
    await page.waitForFunction(() => document.querySelectorAll(".mp-link").length === 3);
    check(true, "[maps ipad] link removed after a second tap");
    await page.click(".mp-item >> nth=3");
    await page.waitForSelector(".map-edit summary");
    await page.click(".map-edit summary");
    await page.click("#mapDel");
    await page.click("#mapDelYes");
    await page.waitForFunction(() => document.querySelectorAll(".mp-item").length === 3);
    check(true, "[maps ipad] map deleted after confirmation");
    await page.reload();
    await page.waitForSelector(".mp-item");
    check(await page.locator(".mp-item").count() === 3 && await page.locator(".mp-link").count() === 3, "[maps ipad] maps and links persist across reloads");
    // Reset removes the guide but keeps maps.
    await page.click("#tabContents");
    await page.click("#resetBtn");
    await Promise.all([page.waitForEvent("load"), page.click("#resetYes")]);
    await page.waitForSelector(".import");
    const left = await page.evaluate(async () => { const m = await import("./js/store.js"); return (await m.listMaps()).length; });
    check(left === 3, "[maps ipad] reset keeps maps");
  }
  await ctx.close();
}

// Every importer: the same guide as text, PDF-free web page, web archive, Markdown and a
// text guide wrapped in <pre> should give the same sections and working links.
{
  const V = path.join(ROOT, "test/fixtures/variants");
  // An old-style guide saved in Windows-1252 (curly quotes as single bytes).
  const cp = path.join(SHOTS, "cp1252-guide.txt");
  const body = "Old Guide\n\n 1.0  Start\n**********\n\nIt\u2019s \u201cquoted\u201d text from 1999, caf\u00e9 included.\n\n 2.0  End\n**********\n\nDone.\n" + "filler line\n".repeat(20);
  fs.writeFileSync(cp, Buffer.from(body.replace(/\u2019/g, "\x92").replace(/\u201c/g, "\x93").replace(/\u201d/g, "\x94"), "latin1"));
  const cases = [
    ["ember-crown-formatted.html", "html"],
    ["ember-crown.webarchive", "html"],
    ["ember-crown.md", "markdown"],
    ["ember-crown-pre.html", "text"],
  ];
  for (const [name, format] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror (${name}): ` + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console (${name}): ` + m.text()); });
    await page.goto(base);
    await page.setInputFiles("#file", path.join(V, name));
    await page.waitForSelector(".home", { timeout: 15000 }).catch(() => {});
    const stored = await page.evaluate(async () => { const m = await import("./js/store.js"); const g = await m.loadGuide(); return g ? { format: g.format, text: g.text } : null; });
    check(stored && stored.format === format, `[${name}] imported as ${format}`);
    check(await page.locator(".toc-list a").count() === 44, `[${name}] same 44 contents entries as the text guide`);
    if (format === "html") check(!/GuideSite|Advertisement|More guides/.test(stored.text), `[${name}] clean copy leaves out the site's menus and sidebar`);
    await page.goto(base + "#/s/3.0");
    await page.waitForSelector("article.sec");
    await page.click('.body a[href="#/s/3.9.3"]');
    await page.waitForFunction(() => /Clockwork Vault/.test(document.querySelector(".sec-h")?.textContent || ""));
    check(true, `[${name}] in-guide contents link opens the right section`);
    await page.goto(base + "#/s/3.1.1");
    await page.waitForFunction(() => /Harrowgate/.test(document.querySelector(".sec-h")?.textContent || ""));
    const shop = await page.locator(".body table, .body pre").count();
    check(shop >= 2, `[${name}] shop tables kept (${shop})`);
    await page.click("#searchBtn");
    await page.fill("#q", "porridge");
    await page.waitForSelector(".results li");
    check(await page.locator(".results li").count() >= 1, `[${name}] search finds text`);
    await ctx.close();
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base);
  await page.setInputFiles("#file", cp);
  await page.waitForSelector(".home");
  await page.goto(base + "#/s/1.0");
  await page.waitForSelector("article.sec");
  const txt = await page.textContent(".body");
  check(txt.includes("It\u2019s \u201cquoted\u201d text from 1999, caf\u00e9 included."), "[cp1252] Windows-1252 text decoded with curly quotes intact");
  await ctx.close();
}

// Character names: rename on display, persist, search, and undo.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base);
  const unit = await page.evaluate(async () => {
    const { renamer } = await import("./js/names.js");
    const r = renamer([{ from: "terra", to: "Prns Donut" }, { from: "Celes", to: "Terra" }]);
    return [r("Terra's TERRA terrapin Celes"), r.html('<a href="#terra">Terra</a> &amp; Celes'), r.pre("Terra      120  Celes   9")];
  });
  check(unit[0] === "Prns Donut's PRNS DONUT terrapin Terra", `[names] whole words, capitals and swaps (${unit[0]})`);
  check(unit[1] === '<a href="#terra">Prns Donut</a> &amp; Terra', `[names] HTML attributes untouched (${unit[1]})`);
  check(unit[2] === "Prns Donut  120  Terra   9", `[names] monospace column gap kept (${unit[2]})`);

  await page.setInputFiles("#file", path.join(ROOT, "test/fixtures/ember-crown-guide.txt"));
  await page.waitForSelector(".home");
  await page.goto(base + "#/s/3.1.1");
  await page.waitForSelector("article.sec");
  await page.click("#settingsBtn");
  await page.click("#nameAdd");
  await page.fill("#nameList li:last-child .nm-from", "corvin");
  await page.fill("#nameList li:last-child .nm-to", "Prns Donut");
  await page.press("#nameList li:last-child .nm-to", "Tab");
  await page.screenshot({ path: path.join(SHOTS, "11-names.png") });
  const body = await page.textContent("article.sec");
  check(body.includes("Prns Donut") && !/corvin/i.test(body), "[names] section re-rendered with the new name");
  check(await page.locator("#settingsSheet").isVisible(), "[names] settings stay open while renaming");
  await page.click("#settingsSheet [data-close]");

  await page.reload();
  await page.waitForSelector("article.sec");
  check((await page.textContent("article.sec")).includes("Prns Donut"), "[names] names kept after reload");
  await page.click("#searchBtn");
  await page.fill("#q", "prns donut");
  await page.waitForSelector(".results li");
  check(await page.locator(".results li").count() >= 2, "[names] search finds the new name");
  await page.click("#searchSheet [data-close]");

  await page.click("#settingsBtn");
  await page.click("#nameList .nm-x");
  check(/Corvin/.test(await page.textContent("article.sec")), "[names] removing a name restores the guide's name");
  await ctx.close();
}

// Color coding: names found from the guide, corrections, and the on/off switch.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base);
  const unit = await page.evaluate(async () => {
    const { buildTerms, matcher } = await import("./js/tags.js");
    const doc = { sections: [{ title: "Scenario Sabin: The battle with the Phantom Train", level: 3, blocks: [] },
      { title: "Traveling over the Veldt to Mobliz", level: 3, blocks: [] }, { title: "Version History", level: 2, blocks: [] }] };
    const terms = buildTerms(doc, [{ from: "Terra", to: "Prns Donut" }], [{ text: "Mobliz", kind: "none" }]);
    const m = matcher(terms);
    const hits = ("Shadow and shadow, SHADOW, Prns Donut, Kefka's, Veldt, Mobliz, the Phantom Train".match(m.re) || []).map((h) => h + "=" + m.kindOf(h));
    return hits.join(" ");
  });
  check(unit === "Shadow=party SHADOW=party Prns Donut=party Kefka=boss Veldt=place Phantom Train=boss", `[colors] matching rules (${unit})`);

  await page.setInputFiles("#file", path.join(ROOT, "test/fixtures/ember-crown-guide.txt"));
  await page.waitForSelector(".home");
  await page.goto(base + "#/s/3.1.1");
  await page.waitForSelector("article.sec");
  const kinds = await page.evaluate(() => Object.fromEntries(["party", "enemy", "boss", "place"].map((k) => [k, [...new Set([...document.querySelectorAll("article .ent-" + k)].map((e) => e.textContent))]])));
  check(kinds.enemy.includes("Hollowlurker") && kinds.enemy.includes("Wispgolem") && !kinds.enemy.some((t) => t.includes("(")), `[colors] monsters from opponents and formations (${kinds.enemy.join(", ")})`);
  check(kinds.place.includes("Harrowgate"), `[colors] places from headings (${kinds.place.join(", ")})`);
  await page.goto(base + "#/s/3.2.4");
  await page.waitForSelector("article.sec");
  check(await page.locator(".sec-h .ent-boss").textContent() === "Gloomlurker Queen", "[colors] boss from 'The battle with' heading");

  await page.goto(base + "#/s/3.1.1");
  await page.waitForSelector("article.sec");
  await page.click("#settingsBtn");
  await page.click("#tagAdd");
  await page.fill("#tagList li:last-child .tg-text", "Isolde");
  await page.selectOption("#tagList li:last-child .tg-kind", "party");
  await page.click("#tagAdd");
  await page.fill("#tagList li:last-child .tg-text", "Harrowgate");
  await page.selectOption("#tagList li:last-child .tg-kind", "none");
  await page.screenshot({ path: path.join(SHOTS, "14-colors-settings.png") });
  await page.click("#settingsSheet [data-close]");
  check(await page.locator(".ent-party", { hasText: "Isolde" }).count() >= 1, "[colors] word added as a character");
  check(await page.locator(".ent", { hasText: "Harrowgate" }).count() === 0, "[colors] word set to Not colored");
  await page.screenshot({ path: path.join(SHOTS, "15-colors-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.join(SHOTS, "16-colors-dark.png") });
  await page.click("#settingsBtn");
  await page.click("#colorNames");
  await page.click("#settingsSheet [data-close]");
  check(await page.locator("article.sec .ent").count() === 0, "[colors] switch turns colors off");
  await ctx.close();
}

// Backup: save on one device, restore on a fresh one, and restore over existing data.
{
  const watch = (page) => {
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base);
  await page.setInputFiles("#file", path.join(ROOT, "test/fixtures/ember-crown-guide.txt"));
  await page.waitForSelector(".home");
  await page.setInputFiles("#mapFile", path.join(ROOT, "test/fixtures/ember-crown-maps.zip"));
  await page.waitForFunction(() => document.querySelectorAll(".mp-item").length === 4, null, { timeout: 15000 });
  await page.goto(base + "#/s/3.1.1");
  await page.waitForSelector("#doneBtn");
  await page.click("#doneBtn");
  await page.click("#settingsBtn");
  await page.click("#nameAdd");
  await page.fill("#nameList li:last-child .nm-from", "Corvin");
  await page.fill("#nameList li:last-child .nm-to", "Prns Donut");
  await page.press("#nameList li:last-child .nm-to", "Tab");
  await page.click("#tagAdd");
  await page.fill("#tagList li:last-child .tg-text", "Isolde");
  await page.press("#tagList li:last-child .tg-text", "Tab");
  await page.screenshot({ path: path.join(SHOTS, "12-backup-settings.png") });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#backupBtn")]);
  const backup = path.join(SHOTS, "backup.zip");
  await dl.saveAs(backup);
  check(/^FF6 Guide backup \d{4}-\d\d-\d\d\.zip$/.test(dl.suggestedFilename()), `[backup] saved as ${dl.suggestedFilename()}`);
  await page.click("#settingsSheet [data-close]");

  // A backup zip added as maps is turned away rather than imported as loose images.
  await page.setInputFiles("#mapFile", backup);
  await page.waitForFunction(() => /full backup/.test(document.getElementById("toast").textContent));
  check(await page.locator(".mp-item").count() === 4, "[backup] maps picker refuses a backup");

  // Restore on a fresh device from the import page.
  const ctx2 = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const p2 = await ctx2.newPage();
  watch(p2);
  await p2.goto(base);
  await p2.waitForSelector(".import");
  await Promise.all([p2.waitForEvent("load"), p2.setInputFiles("#file", backup)]);
  await p2.waitForSelector("article.sec");
  check((await p2.textContent(".sec-h")).includes("Harrowgate"), "[backup] restore resumes at the last section read");
  check(await p2.locator('.toc-list a.done[data-key="3.1.1"]').count() === 1, "[backup] restored done marks");
  check(await p2.locator("#tocMaps .mp-item").count() === 4 && await p2.locator("#tocMaps .mp-link").count() === 3, "[backup] restored maps and links");
  await p2.goto(base + "#/s/3.1.1");
  await p2.waitForSelector("article.sec");
  check((await p2.textContent("article.sec")).includes("Prns Donut"), "[backup] restored character names");
  check(await p2.locator(".ent-party", { hasText: "Isolde" }).count() >= 1, "[backup] restored color-coding fixes");

  // Restore over existing data asks first; Cancel keeps things, Replace restores.
  await p2.click("#settingsBtn");
  await p2.fill("#nameList .nm-to", "Someone Else");
  await p2.press("#nameList .nm-to", "Tab");
  await p2.setInputFiles("#backupFile", backup);
  await p2.waitForSelector("#restoreDialog[open]");
  check(/Corvin|guide/.test(await p2.textContent("#restoreWhat")), `[backup] dialog lists the contents (${await p2.textContent("#restoreWhat")})`);
  await p2.screenshot({ path: path.join(SHOTS, "13-restore-dialog.png") });
  await p2.click("#restoreNo");
  check((await p2.textContent("article.sec")).includes("Someone Else"), "[backup] Cancel keeps current data");
  await p2.click("#settingsBtn");
  await p2.setInputFiles("#backupFile", backup);
  await p2.waitForSelector("#restoreDialog[open]");
  await Promise.all([p2.waitForEvent("load"), p2.click("#restoreYes")]);
  await p2.waitForSelector("article.sec");
  await p2.goto(base + "#/s/3.1.1");
  await p2.waitForSelector("article.sec");
  check((await p2.textContent("article.sec")).includes("Prns Donut"), "[backup] Replace restores the backup");

  // A map pack chosen as a backup is explained.
  await p2.goto(base + "#/import");
  await p2.setInputFiles("#file", path.join(ROOT, "test/fixtures/ember-crown-maps.zip"));
  await p2.waitForSelector("#importErr:not([hidden])");
  check(/isn't a backup/.test(await p2.textContent("#importErr")), "[backup] map pack on the import page is explained");
  await ctx2.close();
  await ctx.close();
}

await browser.close();
server.close();
console.log(errors.length ? `\n${errors.length} problem(s):\n` + errors.join("\n") : "\nAll checks passed.");
process.exit(errors.length ? 1 : 0);
