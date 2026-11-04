// Regression tests for the cleanup list.
const { test, expect } = require("@playwright/test");
const path = require("path");

const APP = "file://" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)));
const byTitle = async (page, title) => (await state(page)).tasks.find((t) => t.title === title);

let pageErrors = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Today");
});
test.afterEach(async () => { expect(pageErrors, "uncaught page errors").toEqual([]); });

async function capture(page, text) {
  await page.locator("#cap").fill(text);
  await page.locator("#cap").press("Enter");
  await page.locator("#cap").blur(); // TEMP: remove with the click-shift fix
}
const row = (page, title) => page.locator("li.task", { hasText: title });

test("deleting a task can be undone, and the undo is synced as a re-add", async ({ page }) => {
  await capture(page, "Keep me");
  await row(page, "Keep me").locator('[data-act="open"]').click();
  await page.locator('[data-act="deltask"]').click();
  await expect(row(page, "Keep me")).toHaveCount(0);
  const s1 = await state(page);
  const id = Object.keys(s1.gone)[0];
  expect(id).toBeTruthy();
  await page.locator("#undo").click();
  await expect(row(page, "Keep me")).toHaveCount(1);
  const s2 = await state(page);
  expect(s2.gone[id]).toBeUndefined();          // no longer marked deleted
  expect(s2.tasks.find((t) => t.id === id).mod).toBeGreaterThan(0);
});

test("break into steps inside a project keeps the steps there, in place, with the notes", async ({ page }) => {
  await page.locator('.nav[data-view="projects"]').first().click();
  await page.locator('[data-act="togglenewp"]').click();
  await page.locator("#newp").fill("Site job\nPack tools\nWrite the FAT\nShip it");
  await page.locator('[data-act="newproject"]').click();
  await row(page, "Write the FAT").locator('[data-act="open"]').click();
  await page.locator("#f-notes").fill("Use the 2024 template");
  await page.locator('[data-act="savetask"]').click();
  await row(page, "Write the FAT").locator('[data-act="open"]').click();
  await page.locator('[data-act="breakdown"]').click();
  await page.locator("#b-steps").fill("Open the template\nFill in the I/O");
  await page.locator('[data-act="dobreak"]').click();
  await expect(page.locator("h1")).toHaveText("Site job");
  await expect(page.locator("li.task .title")).toHaveText(["Pack tools", "Open the template", "Fill in the I/O", "Ship it"]);
  expect((await byTitle(page, "Open the template")).notes).toBe("Use the 2024 template");
  expect((await state(page)).projects.map((p) => p.name)).not.toContain("Write the FAT");
});

test("break into steps on a loose task still makes a project and keeps notes", async ({ page }) => {
  await capture(page, "Loose big job");
  await row(page, "Loose big job").locator('[data-act="open"]').click();
  await page.locator("#f-notes").fill("Call Dave first");
  await page.locator('[data-act="breakdown"]').click();
  await page.locator("#b-steps").fill("Step one\nStep two");
  await page.locator('[data-act="dobreak"]').click();
  await expect(page.locator("h1")).toHaveText("Loose big job");
  expect((await byTitle(page, "Step one")).notes).toBe("Call Dave first"); // edits typed before tapping "Too big?" are kept
});

test("adding in Later with a date schedules it instead of hiding it", async ({ page }) => {
  await page.evaluate(() => window.__app.setView("later"));
  await capture(page, "Idea with a date tomorrow");
  await capture(page, "Plain idea");
  const dated = await byTitle(page, "Idea with a date");
  expect(dated.someday).toBe(false);
  expect(dated.plan).toBeTruthy();
  expect((await byTitle(page, "Plain idea")).someday).toBe(true);
  await expect(page.locator("#toast")).toContainText("Added");
});

test("deleting a project can be undone and its steps return", async ({ page }) => {
  await page.locator('.nav[data-view="projects"]').first().click();
  await page.locator('[data-act="togglenewp"]').click();
  await page.locator("#newp").fill("Panel build\nCut rails\nMount PLC");
  await page.locator('[data-act="newproject"]').click();
  await page.locator('[data-act="editproject"]').click();
  await page.locator('[data-act="delproject"]').click();
  expect((await byTitle(page, "Cut rails")).inbox).toBe(true);
  await page.locator("#undo").click();
  await expect(page.locator("h1")).toHaveText("Panel build");
  await expect(page.locator("li.task .title")).toHaveText(["Cut rails", "Mount PLC"]);
  expect((await byTitle(page, "Cut rails")).inbox).toBe(false);
});
