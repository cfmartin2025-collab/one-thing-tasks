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
