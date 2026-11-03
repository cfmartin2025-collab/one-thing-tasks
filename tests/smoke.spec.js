// Smoke test for One Thing Tasks. Runs index.html from disk with no window.claude,
// so it exercises the localStorage-only path.
const { test, expect } = require("@playwright/test");
const path = require("path");

const URL = "file://" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");
// Wednesday 2026-11-04, 10:00 local. Fixed so "tomorrow" and "fri" are predictable.
const NOW = new Date("2026-11-04T10:00:00");
const TODAY = "2026-11-04", TOMORROW = "2026-11-05", FRI = "2026-11-06";

const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)));
const byTitle = async (page, title) => (await state(page)).tasks.find((t) => t.title === title);

// Any uncaught page error fails the test it happened in.
let pageErrors = [];
test.beforeEach(async ({ page }) => { pageErrors = []; page.on("pageerror", (e) => pageErrors.push(e.message)); });
test.afterEach(async () => { expect(pageErrors, "uncaught page errors").toEqual([]); });

async function fresh(page, opts = {}) {
  await page.clock.setFixedTime(NOW);
  if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height || 900 });
  if (opts.dark) await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Today");
}

async function capture(page, text) {
  const cap = page.locator("#cap");
  await cap.fill(text);
  await cap.press("Enter");
  // Known issue: blurring the capture box hides its hint and shifts the list up mid-click,
  // so the first click after typing can miss. Blur first so tests click where they aim.
  await cap.blur();
}

test("loads, seeds examples, hides Claude buttons without window.claude", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fresh(page);
  const s = await state(page);
  expect(s.tasks.length).toBeGreaterThan(0);
  await expect(page.locator('[data-act="ask"]')).toHaveCount(0);
  await expect(page.locator("#sync")).toContainText("This device only");
  expect(errors).toEqual([]);
});

test("capture parses dates, project, context, minutes", async ({ page }) => {
  await fresh(page);
  await capture(page, "Call Matt about valves #Pumps @phone ~15 tomorrow");
  let t = await byTitle(page, "Call Matt about valves");
  expect(t.plan).toBe(TOMORROW);
  expect(t.tags).toEqual(["phone"]);
  expect(t.est).toBe(15);
  const s = await state(page);
  expect(s.projects.find((p) => p.id === t.project).name).toBe("Pumps");

  await capture(page, "Send report by fri");
  t = await byTitle(page, "Send report");
  expect(t.due).toBe(FRI);

  await capture(page, "Check alarm list in 3 days");
  t = await byTitle(page, "Check alarm list");
  expect(t.plan).toBe("2026-11-07");

  // Captured on Today with no date lands on today.
  await capture(page, "Order fittings");
  await expect(page.locator(".task .title", { hasText: "Order fittings" })).toBeVisible();
  expect((await byTitle(page, "Order fittings")).plan).toBe(TODAY);

  // Inbox capture stays in the inbox.
  await page.locator('.nav[data-view="inbox"]').first().click();
  await capture(page, "Random thought");
  expect((await byTitle(page, "Random thought")).inbox).toBe(true);
});

test("scheduling with the calendar button", async ({ page }) => {
  await fresh(page);
  await capture(page, "Move me");
  const row = page.locator("li.task", { hasText: "Move me" });
  await row.locator('[data-act="when"]').click();
  await expect(page.locator("#sheet h2")).toHaveText("When?");
  await page.locator('#sheet [data-act="setday"][data-v="tomorrow"]').click();
  expect((await byTitle(page, "Move me")).plan).toBe(TOMORROW);
  await expect(row).toHaveCount(0);

  // Plan view shows it on tomorrow, then park it in Later.
  await page.locator('.nav[data-view="plan"]').first().click();
  const prow = page.locator("li.task", { hasText: "Move me" });
  await expect(prow).toBeVisible();
  await prow.locator('[data-act="when"]').click();
  await page.locator('#sheet [data-act="setday"][data-v="later"]').click();
  expect((await byTitle(page, "Move me")).someday).toBe(true);

  // Inbox triage one-tap Today.
  await page.locator('.nav[data-view="inbox"]').first().click();
  await capture(page, "Triage me");
  await page.locator("li.task", { hasText: "Triage me" }).locator('[data-v="today"]').click();
  const t = await byTitle(page, "Triage me");
  expect(t.plan).toBe(TODAY);
  expect(t.inbox).toBe(false);
});

test("project creation: paste a list and from a template", async ({ page }) => {
  await fresh(page);
  await page.locator('.nav[data-view="projects"]').first().click();
  await page.locator('[data-act="togglenewp"]').click();
  await page.locator("#newp").fill("Site visit\n1. Pack tools\n- Drive out\n[ ] Test loops");
  await page.locator('[data-act="newproject"]').click();
  await expect(page.locator("h1")).toHaveText("Site visit");
  const items = page.locator("li.task .title");
  await expect(items).toHaveText(["Pack tools", "Drive out", "Test loops"]);
  await expect(page.locator("li.task.next-up .title")).toHaveText("Pack tools");

  // Sequential: finishing the first makes the second next.
  await page.locator("li.task", { hasText: "Pack tools" }).locator('[data-act="toggle"]').click();
  await expect(page.locator("#toast")).toContainText("Next: Drive out");

  // Template.
  await page.locator('[data-act="back"]').click();
  await page.locator('[data-act="togglenewp"]').click();
  await page.locator('[data-act="tpl"][data-tpl="b0"]').click();
  await expect(page.locator("h1")).toHaveText("Commissioning visit");
  await expect(page.locator("li.task")).toHaveCount(8);
});

test("break a task into steps", async ({ page }) => {
  await fresh(page);
  await capture(page, "Write the FAT procedure");
  await page.locator("li.task", { hasText: "Write the FAT procedure" }).locator('[data-act="open"]').click();
  await page.locator('[data-act="breakdown"]').click();
  await page.locator("#b-steps").fill("Open last job's FAT\nList the changes\nDraft section 1");
  await page.locator('[data-act="dobreak"]').click();
  await expect(page.locator("h1")).toHaveText("Write the FAT procedure");
  await expect(page.locator("li.task .title")).toHaveText(["Open last job's FAT", "List the changes", "Draft section 1"]);
  expect(await byTitle(page, "Write the FAT procedure")).toBeUndefined();
  // First step keeps the original day.
  expect((await byTitle(page, "Open last job's FAT")).plan).toBe(TODAY);
});

test("focus mode: done, not now, shrink it, timer", async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => { const s = window.__app.state; s.tasks = []; s.projects = []; window.__app.render(); });
  await capture(page, "First thing");
  await capture(page, "Second thing");
  await page.locator('[data-act="focus"]').click();
  const title = page.locator("#focus .ftitle");
  await expect(title).toHaveText("First thing");

  await page.locator('[data-act="fskip"]').click();
  await expect(title).toHaveText("Second thing");

  await page.locator('[data-act="fsmall"]').click();
  await page.locator("#smallin").fill("Open the file");
  await page.locator("#smallin").press("Enter");
  await expect(title).toHaveText("Open the file");

  await page.locator('[data-act="tm"][data-m="5"]').click();
  await expect(page.locator("#ftimer")).toHaveText("05:00");

  await page.locator('[data-act="fdone"]').click();
  expect((await byTitle(page, "Open the file")).done).toBe(true);
  await expect(title).toHaveText("Second thing");
  await expect(page.locator('[data-act="stuck"]')).toHaveCount(0);

  await page.locator('#focus [data-act="exitfocus"]').first().click();
  await expect(page.locator("#focus")).not.toBeVisible();
});

test("carried over: an unfinished past-day task shows on Today", async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const s = window.__app.state;
    s.tasks.push({ id: "old1", title: "Yesterday's job", notes: "", project: null, tags: [], energy: null, due: null, defer: null, est: null, plan: "2026-11-03", someday: false, done: false, doneAt: null, inbox: false, created: 1, order: 1 });
    window.__app.render();
  });
  await expect(page.locator("li.task", { hasText: "Yesterday's job" }).locator(".carry")).toHaveText("Carried over");
});

test("PWA: manifest and icons are linked and valid", async ({ page }) => {
  const fs = require("fs");
  const root = path.resolve(__dirname, "..");
  await fresh(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const m = JSON.parse(fs.readFileSync(path.join(root, href), "utf8"));
  expect(m.display).toBe("standalone");
  for (const ic of m.icons) expect(fs.existsSync(path.join(root, ic.src))).toBe(true);
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(fs.existsSync(path.join(root, touch))).toBe(true);
  expect(fs.existsSync(path.join(root, "sw.js"))).toBe(true);
});

for (const width of [390, 1100]) {
  for (const dark of [false, true]) {
    test(`screenshot ${width}px ${dark ? "dark" : "light"}`, async ({ page }) => {
      await fresh(page, { width, height: width < 760 ? 860 : 800, dark });
      await page.screenshot({ path: `tests/shots/today-${width}-${dark ? "dark" : "light"}.png` });
      await page.locator('.nav[data-view="projects"]').first().click();
      await page.screenshot({ path: `tests/shots/projects-${width}-${dark ? "dark" : "light"}.png` });
      await page.locator('[data-act="focus"]').click();
      await page.screenshot({ path: `tests/shots/focus-${width}-${dark ? "dark" : "light"}.png` });
    });
  }
}
