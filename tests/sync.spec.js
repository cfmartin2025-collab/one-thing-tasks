// Two "devices" (separate browser contexts) syncing through a fake GitHub contents API.
const { test, expect } = require("@playwright/test");
const path = require("path");

const APP = "file://" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");
const TOKEN = "test-token";

function fakeGitHub() {
  const gh = { content: null, sha: null, n: 0, puts: 0, failNextPut: false };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,PUT,OPTIONS" };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  gh.handler = async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.headers()["authorization"] !== "Bearer " + TOKEN) return json(route, 401, { message: "Bad credentials" });
    if (u.pathname === "/user") return json(route, 200, { login: "tester" });
    if (u.pathname === "/repos/tester/one-thing-data") return json(route, 200, { private: true });
    if (u.pathname === "/repos/tester/one-thing-data/contents/data.json") {
      if (m === "GET") {
        if (gh.content === null) return json(route, 404, { message: "Not Found" });
        return json(route, 200, { sha: gh.sha, encoding: "base64", content: gh.content });
      }
      if (m === "PUT") {
        const b = JSON.parse(req.postData());
        if (gh.failNextPut) { gh.failNextPut = false; gh.sha = "moved" + (++gh.n); return json(route, 409, { message: "sha mismatch" }); }
        if ((b.sha || null) !== gh.sha) return json(route, 409, { message: "sha mismatch" });
        gh.content = b.content; gh.sha = "s" + (++gh.n); gh.puts++;
        return json(route, 200, { content: { sha: gh.sha } });
      }
    }
    return json(route, 404, { message: "Not Found" });
  };
  gh.data = () => JSON.parse(Buffer.from(gh.content, "base64").toString("utf8"));
  return gh;
}

async function device(browser, gh) {
  const ctx = await browser.newContext();
  await ctx.route("https://api.github.com/**", gh.handler);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.errors = errors;
  await page.goto(APP);
  await expect(page.locator("h1")).toHaveText("Today");
  return page;
}
const titles = (page) => page.evaluate(() => window.__app.state.tasks.map((t) => t.title).sort());
const sync = (page) => page.evaluate(() => window.__app.sync());
async function add(page, text) {
  await page.locator("#cap").fill(text);
  await page.locator("#cap").press("Enter");
  await page.locator("#cap").blur();
}
async function connect(page, token = TOKEN, expectText = "Last synced") {
  await page.locator('[data-act="settings"]').first().click();
  await page.locator("#gh-token").fill(token);
  await page.locator('[data-act="ghconnect"]').click();
  await expect(page.locator("#syncbox")).toContainText(expectText);
  await page.keyboard.press("Escape");
  await expect(page.locator("#veil")).not.toBeVisible();
}

test("two devices merge, delete, and survive a write race", async ({ browser }) => {
  const gh = fakeGitHub();
  const A = await device(browser, gh);
  const B = await device(browser, gh);

  // A connects first and uploads everything, examples included.
  await add(A, "From A");
  await connect(A);
  await expect(A.locator("#syncbox")).toContainText("Last synced");
  expect(gh.data().tasks.map((t) => t.title)).toContain("From A");
  const aCount = (await titles(A)).length;

  // B joins: its own examples are dropped, it receives A's data. Its real task is kept.
  await add(B, "From B");
  await connect(B);
  await expect(B.locator("#syncbox")).toContainText("Last synced");
  expect((await titles(B)).length).toBe(aCount + 1);
  await sync(A);
  expect(await titles(A)).toEqual(await titles(B));

  // Edits on both sides before either syncs: both survive.
  await A.evaluate(() => { const t = window.__app.state.tasks.find((x) => x.title === "From A"); t.title = "From A, renamed"; });
  await add(A, "Second from A"); // this save also stamps the rename above
  await B.locator("li.task", { hasText: "From B" }).locator('[data-act="toggle"]').click();
  await sync(A); await sync(B); await sync(A);
  const a = await A.evaluate(() => window.__app.state.tasks);
  const b = await B.evaluate(() => window.__app.state.tasks);
  for (const list of [a, b]) {
    expect(list.find((t) => t.title === "Second from A")).toBeTruthy();
    expect(list.find((t) => t.title === "From A, renamed")).toBeTruthy();
    expect(list.find((t) => t.title === "From B").done).toBe(true);
  }

  // Delete on B reaches A.
  await B.locator("li.task", { hasText: "Second from A" }).locator('[data-act="open"]').click();
  await B.locator('[data-act="deltask"]').click();
  await sync(B); await sync(A);
  expect(await titles(A)).not.toContain("Second from A");
  expect(await titles(B)).not.toContain("Second from A");

  // Someone else writes between our read and our write: we merge again and retry.
  gh.failNextPut = true;
  await add(A, "After a race");
  await sync(A);
  expect(gh.data().tasks.map((t) => t.title)).toContain("After a race");

  // Nothing new: no extra write.
  const before = gh.puts;
  await sync(A); await sync(B); await sync(B);
  expect(gh.puts).toBe(before); // B only pulls "After a race"; nobody has anything new to write
  expect(await titles(B)).toContain("After a race");
  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});

test("bad token shows a clear message and sync stays off", async ({ browser }) => {
  const gh = fakeGitHub();
  const A = await device(browser, gh);
  await connect(A, "wrong", "did not accept that token");
  expect(await A.evaluate(() => localStorage.getItem("onething.sync"))).toBeNull();
  await expect(A.locator("#sync")).toContainText("This device only");
});

test("old data without change stamps migrates", async ({ page }) => {
  await page.goto(APP);
  await page.evaluate(() => {
    localStorage.setItem("onething.v1", JSON.stringify({ tasks: [{ id: "x1", title: "Old task", created: 5, done: false, order: 1 }], projects: [{ id: "p1", name: "Old project", sequential: true }], templates: [], settings: { todayLimit: 4 }, updated: 9 }));
  });
  await page.reload();
  const s = await page.evaluate(() => window.__app.state);
  expect(s.tasks[0].mod).toBe(5);
  expect(s.projects[0].mod).toBe(0);
  expect(s.gone).toEqual({});
  expect(s.settings.todayLimit).toBe(4);
});
