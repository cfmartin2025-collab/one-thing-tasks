// App side of closed-app alerts and the end-of-day wrap-up.
// The browser's push service is faked: a real one cannot run in a headless test.
const { test, expect } = require("@playwright/test");
const path = require("path");

const APP = "file://" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");
const SERVER = "https://push.test";
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)));

let pageErrors = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
});
test.afterEach(async () => { expect(pageErrors, "uncaught page errors").toEqual([]); });

async function fakeBrowserPush(page) {
  await page.addInitScript(() => {
    window.__subscribed = null;
    const sub = { endpoint: "https://push.example/dev1", toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "BP", auth: "AU" } }; }, unsubscribe: async () => true };
    const reg = { pushManager: { subscribe: async (o) => { window.__subscribed = o; return sub; }, getSubscription: async () => sub }, showNotification: async () => {} };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve(reg), register: async () => reg, addEventListener() {} } });
    window.PushManager = function () {};
    window.Notification = { permission: "default", requestPermission: async () => { window.Notification.permission = "granted"; return "granted"; } };
  });
}

test("allow notifications = one tap: also signs this device up for closed-app alerts", async ({ page }) => {
  await fakeBrowserPush(page);
  const calls = [];
  await page.route(SERVER + "/**", async (route) => {
    const r = route.request();
    calls.push({ url: r.url(), body: r.postData() });
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (r.url().endsWith("/vapid")) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ publicKey: "BPublicKeyAAAA" }) });
    if (r.url().endsWith("/subscribe")) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: '{"ok":true}' });
    return route.fulfill({ status: 404, headers: cors });
  });
  await page.goto(APP);
  await page.evaluate((u) => {
    localStorage.clear();
    localStorage.setItem("onething.pushurl", u);
    localStorage.setItem("onething.sync", JSON.stringify({ token: "gh-token", repo: "me/one-thing-data", joined: true }));
  }, SERVER);
  await page.route("https://api.github.com/**", (route) => route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "{}" }));
  await page.reload();
  await page.locator('[data-act="settings"]').first().click();
  await page.locator('[data-act="notion"]').click();
  await expect(page.locator("#notibox")).toContainText("Alerts with the app closed: on");
  const sub = calls.find((c) => c.url.endsWith("/subscribe"));
  const body = JSON.parse(sub.body);
  expect(body.token).toBe("gh-token");
  expect(body.subscription.endpoint).toBe("https://push.example/dev1");
  expect(body.tz).toBeTruthy();
  expect(await page.evaluate(() => window.__subscribed.userVisibleOnly)).toBe(true);
});

test("without a push server, nothing about closed-app alerts shows", async ({ page }) => {
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('[data-act="settings"]').first().click();
  await expect(page.locator("#notibox")).not.toContainText("app is closed: on");
  await expect(page.locator('[data-act="pushon"]')).toHaveCount(0);
});

test("end of day: after 5 PM, move what is open to tomorrow in one tap, or keep it", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-04T17:30:00") });
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => {
    const s = window.__app.state; s.tasks = []; s.projects = [];
    const T = (id, title, plan, done) => s.tasks.push({ id, title, notes: "", project: null, tags: [], energy: null, due: null, defer: null, est: null, plan, remind: null, someday: false, done: !!done, doneAt: done ? Date.now() : null, inbox: false, created: 1, order: 1, mod: 1 });
    T("a", "Open one", "2026-11-04"); T("b", "From yesterday", "2026-11-03"); T("c", "Finished", "2026-11-04", true);
    window.__app.render();
  });
  await expect(page.locator(".banner.wrap")).toContainText("End of day · 2 still open");
  await page.locator('[data-act="wraptomorrow"]').click();
  let s = await state(page);
  expect(s.tasks.filter((t) => t.plan === "2026-11-05").map((t) => t.id).sort()).toEqual(["a", "b"]);
  expect(s.tasks.find((t) => t.id === "c").plan).toBe("2026-11-04");
  await page.locator("#undo").click();
  s = await state(page);
  expect(s.tasks.find((t) => t.id === "b").plan).toBe("2026-11-03");
  // Keep hides it for the rest of today.
  await page.locator('[data-act="wrapkeep"]').click();
  await expect(page.locator(".banner.wrap")).toHaveCount(0);
});

test("before 5 PM there is no wrap-up, unless opened from the evening alert", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-04T11:00:00") });
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(".banner.wrap")).toHaveCount(0); // seeded examples are on Today, but it is morning
  await page.goto(APP + "?wrap=1");
  await expect(page.locator(".banner.wrap")).toBeVisible();
});
