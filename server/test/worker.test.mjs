// The whole server against fakes: an in-memory KV, a fake GitHub, and fake push endpoints.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { tick } from "../src/worker.js";
import { makeVapidKeys, b64u } from "../src/webpush.js";

const TOKEN = "gh-good-token";
const REPO = "me/one-thing-data";
let env, gh, pushes, realFetch = globalThis.fetch;

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
  };
}
async function fakeSub(endpoint) {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { endpoint, keys: { p256dh: b64u(pub), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
}
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

beforeEach(async () => {
  const v = await makeVapidKeys();
  env = { OT: fakeKV(), GH_REPO: REPO, APP_ORIGIN: "https://cfmartin2025-collab.github.io", VAPID_PUBLIC: v.publicKey, VAPID_PRIVATE: JSON.stringify(v.privateJwk) };
  gh = { S: { tasks: [], projects: [{ id: "p1", name: "Pump skid upgrade", sequential: true }], settings: {} }, sha: "s1", n: 1, conflictOnce: false };
  pushes = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || "";
    if (u.startsWith("https://api.github.com/")) {
      if (auth !== "Bearer " + TOKEN) return new Response("{}", { status: 401 });
      if (u.endsWith(`/repos/${REPO}`)) return new Response(JSON.stringify({ private: true }), { status: 200 });
      if (u.endsWith("/contents/data.json")) {
        if ((init.method || "GET") === "GET") return new Response(JSON.stringify({ sha: gh.sha, content: b64(JSON.stringify(gh.S)) }), { status: 200 });
        const body = JSON.parse(init.body);
        if (gh.conflictOnce) { gh.conflictOnce = false; gh.sha = "moved"; return new Response("{}", { status: 409 }); }
        if (body.sha !== gh.sha) return new Response("{}", { status: 409 });
        gh.S = JSON.parse(Buffer.from(body.content, "base64").toString("utf8")); gh.sha = "s" + (++gh.n);
        return new Response("{}", { status: 200 });
      }
    }
    if (u.startsWith("https://push.example/")) { pushes.push({ url: u, init }); return new Response(null, { status: u.includes("dead") ? 410 : 201 }); }
    throw new Error("unexpected fetch " + u);
  };
});
process.on("exit", () => { globalThis.fetch = realFetch; });

const call = (path, opt = {}) => worker.fetch(new Request("https://push.one/" + path.replace(/^\//, ""), opt), env);
const post = (path, body, headers = {}) => call(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://cfmartin2025-collab.github.io", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("subscribe needs a token that opens the data repo, then says hello", async () => {
  const sub = await fakeSub("https://push.example/dev1");
  let r = await post("/subscribe", { subscription: sub, tz: "America/Chicago", token: "wrong" });
  assert.equal(r.status, 401);
  r = await post("/subscribe", { subscription: sub, tz: "America/Chicago", token: TOKEN });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://cfmartin2025-collab.github.io");
  assert.equal(JSON.parse(await env.OT.get("subs")).length, 1);
  assert.equal(await env.OT.get("gh"), TOKEN);
  assert.equal(pushes.length, 1); // "Alerts are on"
  // Same device again replaces, not duplicates.
  await post("/subscribe", { subscription: sub, tz: "America/Chicago", token: TOKEN });
  assert.equal(JSON.parse(await env.OT.get("subs")).length, 1);
});

test("every-minute job sends a due reminder once, to every device, and drops dead ones", async () => {
  await post("/subscribe", { subscription: await fakeSub("https://push.example/phone"), tz: "America/Chicago", token: TOKEN });
  await post("/subscribe", { subscription: await fakeSub("https://push.example/dead-ipad"), tz: "America/Chicago", token: TOKEN });
  pushes = [];
  const when = Date.UTC(2026, 10, 4, 16, 45); // 10:45 Chicago
  gh.S.tasks.push({ id: "t1", title: "pick up girls", remind: when, done: false, plan: "2026-11-04" });
  gh.S.tasks.push({ id: "t2", title: "already done", remind: when, done: true });
  let r = await tick(env, when + 20000);
  assert.equal(r.sent, 1);
  assert.equal(pushes.length, 2); // tried both
  assert.deepEqual(JSON.parse(await env.OT.get("subs")).map((s) => s.endpoint), ["https://push.example/phone"]);
  pushes = [];
  r = await tick(env, when + 80000); // next minute: not again
  assert.equal(pushes.length, 0);
});

test("capture adds tasks with times read in your time zone, as Siri would send them", async () => {
  await post("/subscribe", { subscription: await fakeSub("https://push.example/phone"), tz: "America/Chicago", token: TOKEN });
  let r = await post("/capture", "call the shop at 3pm", { "Content-Type": "text/plain", Authorization: "Bearer " + TOKEN });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /^Added call the shop\. I'll remind you /);
  const t = gh.S.tasks.find((x) => x.title === "call the shop");
  assert.ok(t.remind);
  assert.equal(new Date(t.remind).toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }), "3:00 PM");
  assert.equal(t.inbox, false);
  assert.ok(t.mod > 0); // so devices merge it in

  r = await post("/capture", { text: "Random thought\nTest alarms #pump", tz: "America/Chicago" }, { Authorization: "Bearer " + TOKEN });
  assert.equal(await r.text(), "Added 2 things.");
  assert.equal(gh.S.tasks.find((x) => x.title === "Random thought").inbox, true);
  assert.equal(gh.S.tasks.find((x) => x.title === "Test alarms").project, "p1"); // matched the existing project
});

test("capture survives someone else writing first, and rejects a bad token", async () => {
  gh.conflictOnce = true;
  let r = await post("/capture", "Order fittings", { "Content-Type": "text/plain", Authorization: "Bearer " + TOKEN });
  assert.equal(r.status, 200);
  assert.ok(gh.S.tasks.find((x) => x.title === "Order fittings"));
  r = await post("/capture", "Sneaky", { "Content-Type": "text/plain", Authorization: "Bearer nope" });
  assert.equal(r.status, 401);
});

test("vapid key is public", async () => {
  const r = await call("/vapid");
  assert.equal((await r.json()).publicKey, env.VAPID_PUBLIC);
});

test("keys stored with a byte-order mark or newline still work", async () => {
  const pub = env.VAPID_PUBLIC;
  env.VAPID_PUBLIC = "﻿" + pub + "\r\n";
  env.VAPID_PRIVATE = "﻿" + env.VAPID_PRIVATE + "\r\n";
  assert.equal((await (await call("/vapid")).json()).publicKey, pub);
  await post("/subscribe", { subscription: await fakeSub("https://push.example/phone"), tz: "America/Chicago", token: TOKEN });
  assert.equal(pushes.length, 1); // the hello push was signed and sent
  assert.match(pushes[0].init.headers.Authorization, new RegExp("k=" + pub + "$"));
});
