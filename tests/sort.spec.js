// Sort it out tab, against a fake Anthropic API. No real calls, no credit used.
const { test, expect } = require("@playwright/test");
const path = require("path");

const APP = "file://" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");
const KEY = "sk-ant-test-key-1234";
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)));
const ymd = (n) => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

function fakeClaude(reply) {
  const api = { calls: [], reply, mode: "ok" };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  api.handler = async (route) => {
    const req = route.request(), u = new URL(req.url()), h = req.headers();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (h["x-api-key"] !== KEY) return json(route, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    if (u.pathname === "/v1/models") return json(route, 200, { data: [{ id: "claude-opus-5-5" }] });
    if (u.pathname === "/v1/messages") {
      const body = JSON.parse(req.postData());
      api.calls.push({ headers: h, body });
      if (api.mode === "credit") return json(route, 400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } });
      if (api.mode === "nofallback" && body.fallbacks) return json(route, 400, { type: "error", error: { type: "invalid_request_error", message: "fallbacks: unknown beta" } });
      if (api.mode === "refusal") return json(route, 200, { content: [], stop_reason: "refusal" });
      return json(route, 200, { content: [{ type: "text", text: JSON.stringify(api.reply) }], stop_reason: "end_turn" });
    }
    return json(route, 404, { type: "error", error: { message: "not found" } });
  };
  return api;
}

let pageErrors = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
});
test.afterEach(async () => { expect(pageErrors, "uncaught page errors").toEqual([]); });

async function open(page, api) {
  await page.route("https://api.anthropic.com/**", api.handler);
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Today");
}
async function addKey(page, key = KEY, expectText = "Key saved") {
  await page.locator('[data-act="settings"]').first().click();
  await page.locator("#ai-key").fill(key);
  await page.locator('[data-act="aikey"]').click();
  await expect(page.locator("#aibox")).toContainText(expectText);
  await page.keyboard.press("Escape");
}
async function sortText(page, text) {
  await page.locator('.nav[data-view="inbox"]').first().click();
  await page.locator("#ask-in").fill(text);
  await page.locator('[data-act="askgo"]').click();
}

test("without a key: Inbox still saves, offers to turn Claude on, no Claude buttons anywhere", async ({ page }) => {
  const api = fakeClaude({ projects: [], tasks: [] });
  await open(page, api);
  await expect(page.locator('[data-act="ask"]')).toHaveCount(0);
  await page.locator('.nav[data-view="inbox"]').first().click();
  await expect(page.locator("#main")).toContainText("Turn on Claude");
  await expect(page.locator('[data-act="askgo"]')).toHaveCount(0);
  await page.locator("#ask-in").fill("Thought one\nThought two");
  await page.locator('[data-act="inboxsave"]').click();
  await expect(page.locator("li.task", { hasText: "Thought two" })).toHaveCount(1);
  await expect(page.locator("#ask-in")).toHaveValue("");
  expect(api.calls.length).toBe(0);
  await page.locator('[data-act="focus"]').click();
  await expect(page.locator('[data-act="stuck"]')).toHaveCount(0);
});

test("a wrong key is rejected and not stored; a good key is stored and checked for free", async ({ page }) => {
  const api = fakeClaude({ projects: [], tasks: [] });
  await open(page, api);
  await page.locator('[data-act="settings"]').first().click();
  await page.locator("#ai-key").fill("sk-ant-wrong");
  await page.locator('[data-act="aikey"]').click();
  await expect(page.locator("#aibox")).toContainText("did not accept");
  expect(await page.evaluate(() => localStorage.getItem("onething.ai"))).toBeNull();
  await page.locator("#ai-key").fill(KEY);
  await page.locator('[data-act="aikey"]').click();
  await expect(page.locator("#aibox")).toContainText("ends in 1234");
  expect(api.calls.length).toBe(0); // checking the key used the free models endpoint only
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-act="ask"]')).toHaveCount(1);
});

test("a paragraph becomes projects, steps, dates, and loose tasks after you check them", async ({ page }) => {
  const api = fakeClaude({
    projects: [
      { name: "Example: Pump skid upgrade", steps: [{ title: "Test the alarms", day: null, due: null, minutes: 30, energy: "med" }] },
      { name: "Panel build", steps: [
        { title: "Print the drawings", day: "tomorrow", due: null, minutes: 5, energy: "low" },
        { title: "Mount the PLC", day: null, due: null, minutes: 60, energy: "high" },
        { title: "Land the field wiring", day: null, due: ymd(6), minutes: null, energy: null } ] },
    ],
    tasks: [
      { title: "Call Matt about the truck", day: ymd(2), due: null, minutes: 10, energy: "low", project: null },
      { title: "Order fittings", day: null, due: null, minutes: null, energy: null, project: null },
      { title: "Skip me", day: null, due: null, minutes: null, energy: null, project: null },
    ],
  });
  await open(page, api);
  await addKey(page);
  await sortText(page, "Pump skid: test alarms. New panel build: print drawings tomorrow, mount PLC, land wiring by next week. Call Matt in 2 days. Order fittings.");

  // Request is built the way the API expects.
  expect(api.calls.length).toBe(1);
  const { headers, body } = api.calls[0];
  expect(headers["anthropic-version"]).toBe("2026-10-21");
  expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  expect(headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
  expect(body.model).toBe("claude-opus-5-5");
  expect(body.fallbacks).toBe("default");
  expect(body.output_config.format.type).toBe("json_schema");
  expect(body.output_config.effort).toBe("medium");
  expect(body.temperature).toBeUndefined();
  expect(body.messages[0].content).toContain("Example: Pump skid upgrade"); // existing projects are passed in

  // Review screen.
  await expect(page.locator("#main")).toContainText("Example: Pump skid upgrade · adds to this project");
  await expect(page.locator("#main")).toContainText("Panel build · new project");
  await expect(page.locator('[data-act="askadd"]')).toHaveText("Add 7 items");
  await page.locator("label.ai", { hasText: "Skip me" }).locator("input").uncheck();
  await expect(page.locator('[data-act="askadd"]')).toHaveText("Add 6 items");
  await page.locator('[data-act="askadd"]').click();
  await expect(page.locator("#toast")).toContainText("Added 6 items across 2 projects");
  await expect(page.locator("#ask-in")).toHaveValue(""); // ready for the next one

  const s = await state(page);
  const pump = s.projects.find((p) => p.name === "Example: Pump skid upgrade");
  const panel = s.projects.find((p) => p.name === "Panel build");
  expect(s.projects.filter((p) => p.name === "Example: Pump skid upgrade").length).toBe(1); // no duplicate
  const t = (title) => s.tasks.find((x) => x.title === title);
  expect(t("Test the alarms").project).toBe(pump.id);
  expect(panel.sequential).toBe(true);
  const steps = s.tasks.filter((x) => x.project === panel.id).sort((a, b) => a.order - b.order).map((x) => x.title);
  expect(steps).toEqual(["Print the drawings", "Mount the PLC", "Land the field wiring"]);
  expect(t("Print the drawings").plan).toBe(ymd(1));
  expect(t("Land the field wiring").due).toBe(ymd(6));
  expect(t("Call Matt about the truck").plan).toBe(ymd(2));
  expect(t("Order fittings").inbox).toBe(true);
  expect(t("Skip me")).toBeUndefined();
});

test("clear messages for no credit and for a declined request", async ({ page }) => {
  const api = fakeClaude({ projects: [], tasks: [] });
  await open(page, api);
  await addKey(page);
  api.mode = "credit";
  await sortText(page, "Anything");
  await expect(page.locator("#main")).toContainText("out of credit");
  await expect(page.locator("#ask-in")).toHaveValue("Anything"); // your text is kept
  api.mode = "refusal";
  await page.locator('[data-act="askgo"]').click();
  await expect(page.locator("#main")).toContainText("would not sort that one");
});

test("if the fallback option is not accepted, it retries once without it", async ({ page }) => {
  const api = fakeClaude({ projects: [], tasks: [{ title: "Do the thing", day: null, due: null, minutes: null, energy: null, project: null }] });
  await open(page, api);
  await addKey(page);
  api.mode = "nofallback";
  await sortText(page, "Do the thing");
  await expect(page.locator('[data-act="askadd"]')).toHaveText("Add 1 item");
  expect(api.calls.length).toBe(2);
  expect(api.calls[1].body.fallbacks).toBeUndefined();
});

test("a sync redraw while typing does not lose your text or focus", async ({ page }) => {
  const api = fakeClaude({ projects: [], tasks: [] });
  await open(page, api);
  await addKey(page);
  await page.locator('.nav[data-view="inbox"]').first().click();
  await page.locator("#ask-in").click();
  await page.keyboard.type("Half a thought");
  await page.evaluate(() => window.__app.render());
  await page.keyboard.type(" and the rest");
  await expect(page.locator("#ask-in")).toHaveValue("Half a thought and the rest");
});

test("I am stuck in Focus uses the key", async ({ page }) => {
  const api = fakeClaude({ steps: [{ title: "Open the file", minutes: 2 }, { title: "Write one line", minutes: 3 }] });
  await open(page, api);
  await addKey(page);
  await page.locator('[data-act="focus"]').click();
  await page.locator('[data-act="stuck"]').click();
  await expect(page.locator("#smallbox")).toContainText("Open the file");
  expect(api.calls[0].body.output_config.format.schema.properties.steps).toBeTruthy();
});
