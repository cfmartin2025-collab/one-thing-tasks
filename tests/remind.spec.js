// Reminders: reading times from what you type, and firing them on time.
const { test, expect } = require("@playwright/test");
const path = require("path");

const APP = "file://" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");
// Wednesday 2026-11-04, 10:00 local.
const NOW = new Date("2026-11-04T10:00:00");
const at = (day, h, m = 0) => new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime();
const TODAY = "2026-11-04", TMR = "2026-11-05", FRI = "2026-11-06";
const MIN = 60000;

const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)));
const byTitle = async (page, title) => (await state(page)).tasks.find((t) => t.title === title);

let pageErrors = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.clock.install({ time: NOW });
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Today");
  await page.evaluate(() => { const s = window.__app.state; s.tasks = []; s.projects = []; window.__app.render(); });
});
test.afterEach(async () => { expect(pageErrors, "uncaught page errors").toEqual([]); });

async function add(page, text) {
  await page.locator("#cap").fill(text);
  await page.locator("#cap").press("Enter");
}
async function inbox(page, text) {
  await page.locator('.nav[data-view="inbox"]').first().click();
  await page.locator("#ask-in").fill(text);
  await page.locator("#ask-in").press("Enter");
}

test("reads relative times, clock times, and days", async ({ page }) => {
  const cases = [
    ["pick up girls in 45 mins", "pick up girls", { remind: NOW.getTime() + 45 * MIN, plan: TODAY }],
    ["Call shop in an hour", "Call shop", { remind: NOW.getTime() + 60 * MIN, plan: TODAY }],
    ["Stretch in half an hour", "Stretch", { remind: NOW.getTime() + 30 * MIN }],
    ["Rebuild image in 3 hrs", "Rebuild image", { remind: NOW.getTime() + 180 * MIN }],
    ["Team call at 3pm", "Team call", { remind: at(TODAY, 15), plan: TODAY }],
    ["Coffee at 9am", "Coffee", { remind: at(TMR, 9), plan: TMR }],          // 9am already passed today
    ["Dentist tomorrow at 2:30pm", "Dentist", { remind: at(TMR, 14, 30), plan: TMR }],
    ["Call Matt fri at 3", "Call Matt", { remind: at(FRI, 15), plan: FRI }],
    ["Order parts in a couple days", "Order parts", { plan: "2026-11-06", remind: null }],
    ["Room 3 walkthrough", "Room 3 walkthrough", { remind: null }],          // numbers in a title stay put
  ];
  for (const [typed, title, want] of cases) {
    await add(page, typed);
    const t = await byTitle(page, title);
    expect(t, typed).toBeTruthy();
    for (const k of Object.keys(want)) {
      // Relative reminders are "from now"; the test clock keeps moving a little, so allow one minute.
      if (k === "remind" && want[k] && /\bin\b/.test(typed)) expect(Math.abs(t[k] - want[k]), `${typed} -> remind`).toBeLessThanOrEqual(MIN);
      else expect(t[k], `${typed} -> ${k}`).toBe(want[k]);
    }
  }
  await expect(page.locator("li.task", { hasText: "Team call" }).locator(".rem")).toContainText("3:00");
});

test("'my report is due in a few days' in the Inbox sets a deadline 3 days out", async ({ page }) => {
  await inbox(page, "my report is due in a few days");
  const t = await byTitle(page, "my report");
  expect(t.due).toBe("2026-11-07");
  expect(t.plan).toBeNull();
  expect(t.inbox).toBe(false);
  await expect(page.locator("#toast")).toContainText("Reminder that morning");
  await inbox(page, "Send invoice due fri at 9am");
  const u = await byTitle(page, "Send invoice");
  expect(u.due).toBe(FRI);
  expect(u.remind).toBe(at(FRI, 9));
});

test("'in 45 mins' typed in the Inbox lands on Today and fires once, 45 minutes later", async ({ page }) => {
  await inbox(page, "pick up girls in 45 mins");
  await expect(page.locator("#toast")).toContainText("Reminder at");
  const t = await byTitle(page, "pick up girls");
  expect(t.inbox).toBe(false);
  expect(t.plan).toBe(TODAY);
  await page.locator('.nav[data-view="today"]').first().click();
  await expect(page.locator("li.task", { hasText: "pick up girls" })).toHaveCount(1);

  await page.clock.fastForward("44:00");
  await expect(page.locator("#toast")).not.toContainText("pick up girls");
  await page.clock.fastForward("01:30");
  await expect(page.locator("#toast")).toContainText("pick up girls");
  // Only once.
  const sent = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("onething.notified") || "{}")).length);
  await page.clock.fastForward("02:00");
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("onething.notified") || "{}")).length)).toBe(sent);
});

test("a finished task never fires; Keep as text removes the reminder", async ({ page }) => {
  await add(page, "Already did it in 5 mins");
  await page.locator("li.task", { hasText: "Already did it" }).locator('[data-act="toggle"]').click();
  await add(page, "Read the label in 10 mins");
  await page.locator("#undo").click(); // Keep as text
  const k = await byTitle(page, "Read the label in 10 mins");
  expect(k.remind).toBeNull();
  await page.clock.fastForward("15:00");
  await expect(page.locator("#toast")).not.toContainText("Already did it");
  await expect(page.locator("#toast")).not.toContainText("Read the label");
});

test("something due today gets a heads-up after 9:00", async ({ page }) => {
  await page.evaluate((d) => {
    window.__app.state.tasks.push({ id: "d1", title: "Submit timesheet", notes: "", project: null, tags: [], energy: null, due: d, defer: null, est: null, plan: null, remind: null, someday: false, done: false, doneAt: null, inbox: false, created: 1, order: 1, mod: 1 });
  }, TODAY);
  await page.clock.fastForward("00:30");
  await expect(page.locator("#toast")).toContainText("Due today: Submit timesheet");
});

test("set and clear a reminder in the edit sheet", async ({ page }) => {
  await add(page, "Wire the panel");
  await page.locator("li.task", { hasText: "Wire the panel" }).locator('[data-act="open"]').click();
  await page.locator("#f-remind").fill("2026-11-05T08:15");
  await page.locator('[data-act="savetask"]').click();
  expect((await byTitle(page, "Wire the panel")).remind).toBe(at(TMR, 8, 15));
  await page.locator("li.task", { hasText: "Wire the panel" }).locator('[data-act="open"]').click();
  await page.locator("#f-remind").fill("");
  await page.locator('[data-act="savetask"]').click();
  expect((await byTitle(page, "Wire the panel")).remind).toBeNull();
});

test("older saved data gets an empty reminder field", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("onething.v1", JSON.stringify({ tasks: [{ id: "x1", title: "Old", created: 5, done: false, order: 1 }], projects: [], templates: [], settings: { todayLimit: 5 }, updated: 9 }));
  });
  await page.reload();
  expect((await state(page)).tasks[0].remind).toBeNull();
});

test("Settings shows a Reminders section", async ({ page }) => {
  await page.locator('[data-act="settings"]').first().click();
  await expect(page.locator("#notibox")).toBeVisible();
});
