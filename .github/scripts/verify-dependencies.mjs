import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const [toolDirectory, outputDirectory, phase] = process.argv.slice(2);
assert.ok(toolDirectory && outputDirectory && ["baseline", "candidate"].includes(phase));
const require = createRequire(join(toolDirectory, "package.json"));
const { chromium } = require("playwright");
const application = process.cwd();
const results = { phase, routes: [], interactions: [] };
await mkdir(outputDirectory, { recursive: true });

const server = spawn(process.execPath, [join(application, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "0"], {
  cwd: application,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
let logs = "";
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not become ready: ${logs}`)), 60_000);
    const receive = (chunk) => {
      logs = (logs + chunk.toString()).slice(-16_384);
      const match = logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match && /Ready|ready|started server/i.test(logs)) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    server.stdout.on("data", receive);
    server.stderr.on("data", receive);
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}: ${logs}`));
    });
  });
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    try {
      await context.addInitScript(() => {
        window.__metrics = { lcp: 0, cls: 0, maxObservedInteractionMs: 0 };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__metrics.lcp = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__metrics.cls += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) if (entry.interactionId) window.__metrics.maxObservedInteractionMs = Math.max(window.__metrics.maxObservedInteractionMs, entry.duration);
        }).observe({ type: "event", buffered: true, durationThreshold: 16 });
      });
      const page = await context.newPage();
      let errors = [];
      page.on("pageerror", (error) => {
        if (errors.length < 20) errors.push(error.message);
      });
      page.on("console", (message) => {
        if (message.type() === "error" && errors.length < 20) errors.push(message.text());
      });
      for (const [name, path] of [
        ["home", "/"],
        ["song", "/song/malovani-divokej-bill/"],
        ["author", "/author/Divokej%20Bill/"],
        ["form", "/form/"],
      ]) {
        errors = [];
        const response = await page.goto(origin + path, { waitUntil: "load" });
        assert.equal(response.status(), 200, `${name} HTTP`);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        });
        const snapshot = await page.evaluate(() => ({
          title: document.title,
          text: document.body.innerText,
          links: [...document.querySelectorAll("a")].map((item) => [item.textContent.trim(), item.getAttribute("href")]),
          geometry: [...document.querySelectorAll("h1,h2,section,input,textarea,button")].map((item) => {
            const rect = item.getBoundingClientRect();
            const style = getComputedStyle(item);
            return [item.tagName, item.textContent.trim().slice(0, 80), [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100), style.color, style.fontSize, style.fontFamily];
          }),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          brokenImages: [...document.images].filter((image) => !image.naturalWidth && image.getBoundingClientRect().width > 0).map((image) => image.getAttribute("src")),
          metrics: window.__metrics,
          transferBytes: performance.getEntriesByType("resource").reduce((sum, entry) => sum + entry.transferSize, 0),
        }));
        results.routes.push({ name, width, ...snapshot, errors: [...errors] });
        await page.screenshot({ path: join(outputDirectory, `${name}-${width}.png`), fullPage: name !== "home", animations: "disabled" });
        assert.equal(errors.length, 0, `${name}: ${errors.join("; ")}`);
        assert.equal(snapshot.brokenImages.length, 0, `${name}: broken images`);
      }

      await page.goto(origin + "/");
      await page.emulateMedia({ colorScheme: "dark" });
      assert.equal(await page.getByPlaceholder("Prohledávej zpěvníček").evaluate((input) => getComputedStyle(input).backgroundColor), "rgb(36, 41, 46)");
      await page.screenshot({ path: join(outputDirectory, `home-dark-${width}.png`), animations: "disabled" });
      await page.emulateMedia({ colorScheme: "light" });
      assert.equal(await page.getByPlaceholder("Prohledávej zpěvníček").evaluate((input) => getComputedStyle(input).backgroundColor), "rgb(255, 255, 255)");
      await page.getByPlaceholder("Prohledávej zpěvníček").fill("Malování");
      await page.locator(".react-search-box-dropdown-list-item").filter({ hasText: "Malování" }).first().waitFor();
      await page.screenshot({ path: join(outputDirectory, `search-${width}.png`), animations: "disabled" });
      await page.locator(".react-search-box-dropdown-list-item").filter({ hasText: "Malování" }).first().click();
      await page.waitForURL("**/song/malovani-divokej-bill/");
      await page.waitForFunction(() => document.title.includes("Malování"));
      assert.match(await page.title(), /Malování/);
      await page.getByText("Divokej Bill", { exact: false }).first().click();
      await page.waitForURL("**/author/Divokej%20Bill/");
      await page.getByPlaceholder("Prohledávej autora").fill("Malování");
      await page.locator(".react-search-box-dropdown-list-item").filter({ hasText: "Malování" }).first().click();
      await page.waitForURL("**/song/malovani-divokej-bill/");
      await page.getByRole("link", { name: "STC Zpěvníček", exact: true }).click();
      await page.waitForURL(origin + "/");
      await page.getByPlaceholder("Prohledávej zpěvníček").fill("zzzz-no-matching-song");
      await page.waitForFunction(() => document.querySelectorAll(".react-search-box-dropdown-list-item").length === 0);
      await page.getByPlaceholder("Prohledávej zpěvníček").fill("");
      await page.waitForFunction(() => document.querySelectorAll(".react-search-box-dropdown-list-item").length === 0);
      await page.getByPlaceholder("Prohledávej zpěvníček").fill("Malování");
      await page.locator(".react-search-box-dropdown-list-item").first().waitFor();
      await page.getByRole("heading", { name: "STC Zpěvníček", exact: true }).first().click();
      await page.waitForFunction(() => document.querySelector('.searchBox input').value === "" && document.querySelectorAll(".react-search-box-dropdown-list-item").length === 0);
      await page.getByPlaceholder("Prohledávej zpěvníček").fill("Malování");
      await page.locator(".react-search-box-dropdown-list-item").first().waitFor();
      await page.keyboard.press("Tab");
      await page.waitForFunction(() => document.activeElement.closest(".react-search-box-dropdown-list-item") !== null);
      await page.screenshot({ path: join(outputDirectory, `search-keyboard-${width}.png`), animations: "disabled" });
      await page.keyboard.press("Enter");
      await page.waitForURL("**/song/malovani-divokej-bill/");
      await page.getByRole("link", { name: "STC Zpěvníček", exact: true }).click();
      await page.waitForURL(origin + "/");
      await page.getByPlaceholder("Prohledávej zpěvníček").fill("Malování");
      await page.locator(".react-search-box-dropdown-list-item").first().waitFor();
      await page.getByPlaceholder("Prohledávej zpěvníček").press("Enter");
      await page.waitForURL("**/song/malovani-divokej-bill/");
      await page.getByRole("link", { name: "STC Zpěvníček", exact: true }).click();
      await page.waitForURL(origin + "/");
      await page.locator('a[href="/form/"]').click();
      await page.waitForURL("**/form/");
      await page.getByRole("button", { name: "Stáhnout JSON" }).click();
      await page.getByRole("heading", { name: "Chyba!" }).waitFor();
      await page.getByRole("button", { name: "OK", exact: true }).click();
      await page.locator("#fname").fill("Zkušební píseň");
      await page.locator("#fauthor").fill("Testovací autor");
      await page.locator("#fnote").fill("Místní test");
      await page.locator("#ftext").fill("[Ami]Český text\n[G]Další řádek");
      assert.equal(await page.locator('input[aria-label="Okénko pro zobrazení URL adresy písně"]').inputValue(), "zkusebni-pisen-testovaci-autor");
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Stáhnout JSON" }).click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), "zkusebni-pisen-testovaci-autor.json");
      assert.deepEqual(JSON.parse(await readFile(await download.path(), "utf8")), {
        name: "Zkušební píseň", slug: "zkusebni-pisen-testovaci-autor", author: "Testovací autor", note: "Místní test", text: "[Ami]Český text\n[G]Další řádek",
      });
      results.interactions.push({ width, search: "home and author passed", navigation: "passed", exportValidation: "passed", download: "passed", labMetrics: await page.evaluate(() => window.__metrics) });

      await page.goto(origin + "/");
      await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active));
      const worker = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return { scope: registration.scope, active: registration.active?.scriptURL };
      });
      assert.equal(worker.active, origin + "/sw.js");
      await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await page.goto(origin + "/song/malovani-divokej-bill/");
      await page.waitForFunction(async () => Boolean(await caches.match(location.href)));
      await context.setOffline(true);
      await page.reload({ waitUntil: "load" });
      assert.match(await page.title(), /Malování/);
      assert.ok(await page.locator(".chord").count());
      await page.getByRole("link", { name: "STC Zpěvníček", exact: true }).click();
      await page.waitForURL(origin + "/");
      await page.getByPlaceholder("Prohledávej zpěvníček").fill("Malování");
      await page.locator(".react-search-box-dropdown-list-item").filter({ hasText: "Malování" }).first().click();
      await page.waitForURL("**/song/malovani-divokej-bill/");
      assert.ok(await page.locator(".chord").count());
      const fallbackPage = await context.newPage();
      const fallbackResponse = await fallbackPage.goto(origin + "/never-cached-test-route/");
      assert.ok(fallbackResponse, "The uncached offline navigation must return a response");
      results.lastFallback = {
        width,
        url: fallbackPage.url(),
        status: fallbackResponse.status(),
        responseHasOfflineMessage: /offline|připojen/i.test(await fallbackResponse.text()),
        title: await fallbackPage.title(),
      };
      await fallbackPage.waitForFunction(() => /offline|připojen/i.test(document.body.innerText));
      assert.match(await fallbackPage.locator("body").innerText(), /offline|připojen/i);
      await fallbackPage.close();
      await context.setOffline(false);
      const missingPage = await context.newPage();
      assert.equal((await missingPage.goto(origin + "/never-existing-test-song/")).status(), 404);
      await missingPage.close();
      results.interactions.push({ width, serviceWorker: worker, cachedSongOffline: "passed", offlineSearchAndNavigation: "passed", offlineFallback: "passed", missingRoute: 404 });
    } finally {
      await context.close();
    }
  }
} catch (error) {
  results.failure = error.stack;
  throw error;
} finally {
  try {
    await writeFile(join(outputDirectory, "browser.json"), JSON.stringify(results, null, 2));
  } finally {
    try {
      await browser?.close();
    } finally {
      if (server.exitCode === null) {
        const exited = once(server, "exit");
        server.kill();
        const deadline = setTimeout(() => server.kill("SIGKILL"), 5_000);
        deadline.unref();
        await exited;
        clearTimeout(deadline);
      }
    }
  }
}
