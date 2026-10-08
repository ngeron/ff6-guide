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

await browser.close();
server.close();
console.log(errors.length ? `\n${errors.length} problem(s):\n` + errors.join("\n") : "\nAll checks passed.");
process.exit(errors.length ? 1 : 0);
