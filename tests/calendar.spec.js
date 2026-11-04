// Calendar (week + month + Not scheduled tray) and the 4-tab layout.
const { test, expect } = require("@playwright/test");
const path = require("path");

const APP = "file://" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)));
const byTitle = async (page, title) => (await state(page)).tasks.find((t) => t.title === title);
const row = (page, title) => page.locator("li.task", { hasText: title });

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

// Fixed sample week, relative to the real today.
async function load(page) {
  return page.evaluate(() => {
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    const add = (n) => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + n); return ymd(d); };
    const s = window.__app.state;
    s.tasks = []; s.projects = [];
    let k = 1;
    const T = (o) => s.tasks.push(Object.assign({ id: "t" + k, title: "", notes: "", project: null, tags: [], energy: null, due: null, defer: null, est: null, plan: null, someday: false, done: false, doneAt: null, inbox: false, created: k, order: k++, mod: 1 }, o));
    T({ title: "Today job", plan: add(0) });
    T({ title: "Tomorrow job", plan: add(1) });
    T({ title: "Due Friday-ish", due: add(3) });
    T({ title: "Loose job" });
    T({ title: "Someday idea", someday: true });
    T({ title: "Done yesterday", done: true, doneAt: Date.now() - 86400000 });
    window.__app.render();
    return { today: add(0), d1: add(1), d2: add(2), d3: add(3), d5: add(5) };
  });
}

test("four tabs, old screen names still land somewhere sensible", async ({ page }) => {
  await expect(page.locator(".nav")).toHaveText([/Today/, /Calendar/, /Inbox/, /Projects/]);
  await page.evaluate(() => window.__app.setView("plan"));
  await expect(page.locator("h1")).toHaveText("Calendar");
  await page.evaluate(() => window.__app.setView("sort"));
  await expect(page.locator("h1")).toHaveText("Inbox");
  await page.evaluate(() => window.__app.setView("later"));
  await expect(page.locator(".tray")).toContainText("Later");
});

test("Today links to the Inbox, the week, and what you finished", async ({ page }) => {
  await load(page);
  await page.evaluate(() => { window.__app.state.tasks.push({ id: "in1", title: "Unsorted", notes: "", project: null, tags: [], energy: null, due: null, defer: null, est: null, plan: null, someday: false, done: false, doneAt: null, inbox: true, created: 1, order: 1, mod: 1 }); window.__app.render(); });
  const inboxLine = page.locator(".banner", { hasText: "in Inbox to sort" });
  await expect(inboxLine).toContainText("1 in Inbox to sort");
  await inboxLine.locator("[data-view=inbox]").click();
  await expect(page.locator("h1")).toHaveText("Inbox");
  await page.locator('.nav[data-view="today"]').first().click();
  await page.locator('[data-act="plantomorrow"]').click();
  await expect(page.locator("h1")).toHaveText("Calendar");
});

for (const width of [390, 1280]) {
  test(`week shows each day and adds to the day you tap (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const d = await load(page);
    await page.locator('.nav[data-view="cal"]').first().click();
    await expect(page.locator(".week .dcol")).toHaveCount(7);
    await expect(page.locator(".week .dcol").nth(0).locator(".cnt")).toHaveText("1 task");
    await expect(page.locator(".week .dcol").nth(2).locator(".cnt")).toHaveCount(0); // empty day: no count at all
    await expect(page.locator(".week .dcol").nth(0)).toContainText("Today job");
    await expect(page.locator(".week .dcol").nth(1)).toContainText("Tomorrow job");
    await expect(page.locator(".week .dcol").nth(3)).toContainText("Due Friday-ish");
    await page.locator(`[data-act="dayadd"][data-v="${d.d5}"]`).click();
    await page.locator("#cap").fill("Added on day five");
    await page.locator("#cap").press("Enter");
    expect((await byTitle(page, "Added on day five")).plan).toBe(d.d5);
    await expect(page.locator(".week .dcol").nth(5)).toContainText("Added on day five");
    await page.keyboard.press("Escape");
    await expect(page.locator("#cap")).toHaveCount(0);
    // Next week and back.
    await page.locator('[data-act="calstep"][data-v="1"]').click();
    await expect(page.locator(".week .dcol").nth(0)).not.toContainText("Today");
    await page.locator('[data-act="calnow"]').click();
    await expect(page.locator(".week .dcol").nth(0)).toContainText("Today");
  });
}

test("drag a task to another day, to Later, and undo", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const d = await load(page);
  await page.locator('.nav[data-view="cal"]').first().click();
  await row(page, "Today job").dragTo(page.locator(`.week [data-drop="${d.d2}"]`));
  expect((await byTitle(page, "Today job")).plan).toBe(d.d2);
  await expect(page.locator(".week .dcol").nth(2)).toContainText("Today job");
  await page.locator("#undo").click();
  expect((await byTitle(page, "Today job")).plan).toBe(d.today);

  await page.locator('[data-act="tray"][data-v="later"]').click();
  await row(page, "Tomorrow job").dragTo(page.locator('[data-drop="later"]'));
  const t = await byTitle(page, "Tomorrow job");
  expect(t.someday).toBe(true);
  expect(t.plan).toBeNull();
  await expect(page.locator(".tray")).toContainText("Tomorrow job");
});

test("month shows counts, deadlines, finished days, and the picked day", async ({ page }) => {
  const d = await load(page);
  await page.locator('.nav[data-view="cal"]').first().click();
  await page.locator('[data-act="calmode"][data-v="month"]').click();
  const cell = (day) => page.locator(`.mday[data-v="${day}"]`);
  // The only number in a cell is the date: tasks are dots, due is an amber dot.
  if (await cell(d.d1).count()) {
    await expect(cell(d.d1)).toHaveText(String(+d.d1.slice(8)));
    await expect(cell(d.d1).locator(".mdots i")).toHaveCount(1);
    await expect(cell(d.d1)).toHaveAttribute("aria-label", /1 task/);
  }
  if (await cell(d.d3).count()) await expect(cell(d.d3).locator(".mdots i.due")).toHaveCount(1);
  await expect(page.locator(".mlegend")).toContainText("due");
  await expect(cell(d.today)).toHaveClass(/sel/);
  if (await cell(d.d1).count()) {
    await cell(d.d1).click();
    await expect(page.locator(".monthwrap .dcol")).toContainText("Tomorrow job");
  }
  await page.locator('[data-act="calstep"][data-v="1"]').click();
  await expect(page.locator('[data-act="calnow"]')).toBeVisible();
});

test("left over from earlier: grouped on Today, red dot on past day, drag it forward from last week", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const d = await page.evaluate(() => {
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (x) => x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
    const add = (n) => { const x = new Date(); x.setHours(12); x.setDate(x.getDate() + n); return ymd(x); };
    const s = window.__app.state; s.tasks = []; s.projects = [];
    s.tasks.push({ id: "old", title: "Missed one", notes: "", project: null, tags: [], energy: null, due: null, defer: null, est: null, plan: add(-2), someday: false, done: false, doneAt: null, inbox: false, created: 1, order: 1, mod: 1 });
    s.tasks.push({ id: "new", title: "Fresh one", notes: "", project: null, tags: [], energy: null, due: null, defer: null, est: null, plan: add(0), someday: false, done: false, doneAt: null, inbox: false, created: 2, order: 2, mod: 1 });
    window.__app.render();
    return { today: add(0), old: add(-2), d2: add(2) };
  });
  await page.locator('.nav[data-view="cal"]').first().click();
  const todayCol = page.locator(".week .dcol").nth(0);
  await expect(todayCol.locator(".dsub").first()).toContainText("From earlier · 1");
  await expect(todayCol).toContainText("Missed one");
  await expect(todayCol.locator(".carry")).toContainText("From");

  // Last week: the past day shows it as left over, and you can drag it to a future day.
  await page.locator('[data-act="calstep"][data-v="-1"]').click();
  const pastCol = page.locator(".week .dcol.past", { hasText: "Missed one" });
  await expect(pastCol.locator(".cnt.left")).toHaveText("1 left over");
  await page.locator('[data-act="calnow"]').click();
  await row(page, "Missed one").dragTo(page.locator(`.week [data-drop="${d.d2}"]`));
  expect((await byTitle(page, "Missed one")).plan).toBe(d.d2);

  // Month: the past day gets a red left-over dot only while something is left there.
  await page.evaluate((old) => { const t = window.__app.state.tasks.find((x) => x.id === "old"); t.plan = old; window.__app.render(); }, d.old);
  await page.locator('[data-act="calmode"][data-v="month"]').click();
  const cell = page.locator(`.mday[data-v="${d.old}"]`);
  if (await cell.count()) {
    await expect(cell.locator("i.left")).toHaveCount(1);
    await expect(cell).toHaveAttribute("aria-label", /1 left over/);
  }
  await expect(page.locator(".mlegend")).toContainText("left over");
});

test("Not scheduled tray: Anytime and Later, and parking an idea", async ({ page }) => {
  await load(page);
  await page.locator('.nav[data-view="cal"]').first().click();
  await expect(page.locator('[data-act="tray"][data-v="any"]')).toContainText("1");
  await page.locator('[data-act="tray"][data-v="any"]').click();
  await expect(page.locator(".tray")).toContainText("Loose job");
  await expect(page.locator(".tray")).not.toContainText("Due Friday-ish"); // shown on its day instead
  await page.locator('[data-act="tray"][data-v="later"]').click();
  await page.locator('[data-act="dayadd"][data-v="later"]').click();
  await page.locator("#cap").fill("Parked thought");
  await page.locator("#cap").press("Enter");
  expect((await byTitle(page, "Parked thought")).someday).toBe(true);
});
