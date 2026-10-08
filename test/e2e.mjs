// Headless smoke test: serves the app, imports a PDF and a text file, and checks the main views.
// Usage: node test/e2e.mjs <path-to-pdf> [screenshot-dir]
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

  const file = scheme === "light" && PDF ? PDF : path.join(ROOT, "test/fixtures/sample-guide.txt");
  await page.setInputFiles("#file", file);
  await page.waitForSelector(".home", { timeout: 60000 });
  check(true, `[${scheme}] imported ${path.basename(file)}`);
  const secs = await page.locator(".toc-list a, .toc-list summary").count();
  check(secs >= 4, `[${scheme}] contents sidebar lists sections (${secs})`);
  await page.screenshot({ path: path.join(SHOTS, `2-home-${scheme}.png`) });

  await page.click('.chapters a[href="#/s/2.0"]');
  await page.waitForSelector("article.sec .toc");
  await page.click('.body .toc a[href="#/s/2.1.1"]');
  await page.waitForFunction(() => /opening town/i.test(document.querySelector(".sec-h")?.textContent || ""));
  const h = await page.textContent(".sec-h");
  check(/opening town/i.test(h), `[${scheme}] section page renders heading (${h.trim()})`);
  check(await page.locator(".body .pre pre").count() >= 1, `[${scheme}] shop table kept as monospace`);
  check(await page.locator(".body .meta").count() >= 1, `[${scheme}] Opponents box rendered`);
  await page.screenshot({ path: path.join(SHOTS, `3-section-${scheme}.png`), fullPage: true });

  await page.click("#doneBtn");
  check(await page.locator('.toc-list a.done[data-key="2.1.1"]').count() === 1, `[${scheme}] mark done updates contents`);

  await page.click("#searchBtn");
  await page.fill("#q", "megavolt");
  await page.waitForSelector(".results li");
  if (scheme === "light") await page.screenshot({ path: path.join(SHOTS, "4-search.png") });
  await page.click(".results li a");
  await page.waitForSelector("mark.hit");
  check((await page.textContent(".sec-h")).includes("Golem"), `[${scheme}] search result opens section with highlight`);

  await page.reload();
  await page.waitForSelector("article.sec");
  check((await page.textContent(".sec-h")).includes("Golem"), `[${scheme}] reload resumes last section from storage`);

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
await page.setInputFiles("#file", path.join(ROOT, "test/fixtures/sample-guide.txt"));
await page.waitForSelector(".home");
check(await page.locator("#toc").isHidden(), "[phone] contents hidden by default");
await page.click("#tocBtn");
check(await page.locator("#toc").isVisible(), "[phone] contents drawer opens");
await page.screenshot({ path: path.join(SHOTS, "6-phone-drawer.png") });
await page.click('details[data-group="2.0"] summary');
await page.click('.toc-list a[data-key="2.1.2"]');
await page.waitForSelector("article.sec");
check(await page.locator("#toc").isHidden(), "[phone] drawer closes after picking a section");
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
check(!overflow, "[phone] no horizontal page scroll");
await page.screenshot({ path: path.join(SHOTS, "7-phone-section.png"), fullPage: true });
await ctx.close();

await browser.close();
server.close();
console.log(errors.length ? `\n${errors.length} problem(s):\n` + errors.join("\n") : "\nAll checks passed.");
process.exit(errors.length ? 1 : 0);
