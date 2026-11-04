// One Thing push server (Cloudflare Worker).
//
//   GET  /vapid        -> { publicKey }                      the key the app subscribes with
//   POST /subscribe    { subscription, tz, token }            turn on alerts for one device
//   POST /unsubscribe  { endpoint, token }                    turn them off
//   POST /capture      text or { text, tz? }  + Bearer token  Siri / Shortcut brain dump into the tasks
//   every minute       read data.json, send what is due, once each
//
// Who may use it: anyone holding a GitHub token that can open GH_REPO (your private one-thing-data).
// The newest verified token is kept in KV so the every-minute job can read the tasks.
//
// KV (binding OT), kept small for the free tier:
//   "subs"        [{ endpoint, keys, tz, added }]   one read per minute
//   "gh"          the GitHub token
//   "sent:<key>"  marks a notification as sent (expires after 2 days)

import { sendPush } from "./webpush.js";
import { clockIn, parseLine } from "./when.js";
import { dueNotifications } from "./plan.js";

const GH = "https://api.github.com";
const FILE = "data.json";

function cors(env, req) {
  const origin = req.headers.get("Origin") || "";
  const allowed = [env.APP_ORIGIN, "http://localhost:8765"].filter(Boolean);
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : env.APP_ORIGIN || "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}
const json = (obj, status, h) => new Response(JSON.stringify(obj), { status: status || 200, headers: { ...h, "Content-Type": "application/json" } });

const ghHeaders = (token) => ({ Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "User-Agent": "one-thing-push" });

/** Does this token open the private data repo? Remembers the newest good one. */
async function verifyToken(env, token) {
  if (!token || typeof token !== "string") return false;
  const known = await env.OT.get("gh");
  if (known && known === token) return true;
  const r = await fetch(`${GH}/repos/${env.GH_REPO}`, { headers: ghHeaders(token) });
  if (!r.ok) return false;
  await env.OT.put("gh", token);
  return true;
}

function utf8b64(str) { const b = new TextEncoder().encode(str); let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); }
function b64utf8(b64) { const s = atob(b64.replace(/\s/g, "")); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new TextDecoder().decode(b); }

async function readData(env, token) {
  const r = await fetch(`${GH}/repos/${env.GH_REPO}/contents/${FILE}`, { headers: ghHeaders(token) });
  if (r.status === 404) return { S: null, sha: null };
  if (!r.ok) throw new Error("GitHub read " + r.status);
  const f = await r.json();
  return { S: JSON.parse(b64utf8(f.content)), sha: f.sha };
}

async function getSubs(env) { try { return JSON.parse((await env.OT.get("subs")) || "[]"); } catch { return []; } }
async function putSubs(env, subs) { await env.OT.put("subs", JSON.stringify(subs)); }

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const sameName = (a, b) => a.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(b.toLowerCase().replace(/[^a-z0-9]/g, ""));

/** Add captured lines to data.json, the way the app's Inbox would. Retries if someone writes first. */
async function capture(env, token, text, tz) {
  const lines = String(text || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
  if (!lines.length) return { added: [] };
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now();
    const c = clockIn(tz, now);
    const { S: S0, sha } = await readData(env, token);
    const S = S0 || { tasks: [], projects: [], templates: [], settings: { todayLimit: 5 }, updated: 0, gone: {}, settingsMod: 0 };
    S.tasks = S.tasks || []; S.projects = S.projects || [];
    const added = [];
    lines.forEach((line, i) => {
      const p = parseLine(line, c);
      if (!p.title) return;
      let project = null;
      if (p.pname) {
        project = S.projects.find((x) => sameName(x.name, p.pname));
        if (!project) { project = { id: uid(), name: p.pname, sequential: false, mod: now }; S.projects.push(project); }
      }
      const t = {
        id: uid(), title: p.title, notes: "", project: project ? project.id : null, tags: p.tags, energy: null,
        due: p.due, defer: null, est: p.est, plan: p.plan, remind: p.remind, someday: false, done: false, doneAt: null,
        inbox: !project && !p.plan && !p.due, created: now, order: now + i, mod: now,
      };
      S.tasks.push(t); added.push(t);
    });
    S.updated = now;
    const body = { message: "Capture " + new Date(now).toISOString(), content: utf8b64(JSON.stringify(S)) };
    if (sha) body.sha = sha;
    const w = await fetch(`${GH}/repos/${env.GH_REPO}/contents/${FILE}`, { method: "PUT", headers: { ...ghHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (w.ok) return { added };
    if (w.status !== 409 && w.status !== 422) throw new Error("GitHub write " + w.status);
  }
  throw new Error("GitHub kept changing; try again");
}

function spoken(added, tz) {
  if (!added.length) return "Nothing to add.";
  if (added.length > 1) return `Added ${added.length} things.`;
  const t = added[0];
  if (t.remind) {
    const when = new Date(t.remind).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" });
    return `Added ${t.title}. I'll remind you ${when}.`;
  }
  if (t.due) return `Added ${t.title}, due ${t.due}.`;
  if (t.plan) return `Added ${t.title} for ${t.plan}.`;
  return `Added ${t.title} to your Inbox.`;
}

// Secrets set from a Windows shell can arrive with a byte-order mark or a trailing newline.
const clean = (s) => String(s || "").replace(/^﻿/, "").trim();
async function vapidFrom(env) {
  return { publicKey: clean(env.VAPID_PUBLIC), privateJwk: JSON.parse(clean(env.VAPID_PRIVATE)), subject: env.APP_ORIGIN || "https://example.com/" };
}

/** The every-minute job. */
export async function tick(env, now = Date.now()) {
  const subs = await getSubs(env);
  if (!subs.length) return { sent: 0 };
  const token = await env.OT.get("gh");
  if (!token) return { sent: 0 };
  const { S } = await readData(env, token);
  if (!S) return { sent: 0 };
  const vapid = await vapidFrom(env);
  let sent = 0, dead = new Set();
  const byTz = {};
  for (const s of subs) (byTz[s.tz || "UTC"] = byTz[s.tz || "UTC"] || []).push(s);
  for (const tz of Object.keys(byTz)) {
    for (const n of dueNotifications(S, clockIn(tz, now))) {
      const mark = "sent:" + tz + ":" + n.key;
      if (await env.OT.get(mark)) continue;
      await env.OT.put(mark, "1", { expirationTtl: 172800 });
      for (const s of byTz[tz]) {
        try {
          const r = await sendPush(s, n.payload, vapid);
          if (r.gone) dead.add(s.endpoint); else if (r.ok) sent++;
        } catch (e) { /* one bad device should not stop the rest */ }
      }
    }
  }
  if (dead.size) await putSubs(env, subs.filter((s) => !dead.has(s.endpoint)));
  return { sent };
}

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && url.pathname === "/vapid") return json({ publicKey: clean(env.VAPID_PUBLIC) }, 200, h);
      if (req.method === "GET" && url.pathname === "/") return new Response("One Thing push server is running.", { headers: h });

      if (req.method === "POST" && url.pathname === "/subscribe") {
        const b = await req.json();
        if (!(await verifyToken(env, b.token))) return json({ error: "That token cannot open your task data." }, 401, h);
        const s = b.subscription;
        if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: "Missing subscription." }, 400, h);
        const subs = (await getSubs(env)).filter((x) => x.endpoint !== s.endpoint);
        subs.push({ endpoint: s.endpoint, keys: s.keys, tz: b.tz || "UTC", added: Date.now() });
        await putSubs(env, subs.slice(-10));
        try { await sendPush(s, { title: "One Thing", body: "Alerts are on for this device.", tag: "hello", url: "./" }, await vapidFrom(env)); } catch (e) {}
        return json({ ok: true }, 200, h);
      }

      if (req.method === "POST" && url.pathname === "/unsubscribe") {
        const b = await req.json();
        if (!(await verifyToken(env, b.token))) return json({ error: "Not allowed." }, 401, h);
        await putSubs(env, (await getSubs(env)).filter((x) => x.endpoint !== b.endpoint));
        return json({ ok: true }, 200, h);
      }

      if (req.method === "POST" && url.pathname === "/capture") {
        const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
        if (!(await verifyToken(env, token))) return new Response("That token cannot open your task data.", { status: 401, headers: h });
        const type = req.headers.get("Content-Type") || "";
        let text = "", tz = null;
        if (type.includes("json")) { const b = await req.json(); text = b.text; tz = b.tz; } else text = await req.text();
        if (!tz) { const subs = await getSubs(env); tz = (subs[subs.length - 1] && subs[subs.length - 1].tz) || "UTC"; }
        const { added } = await capture(env, token, text, tz);
        return new Response(spoken(added, tz), { headers: { ...h, "Content-Type": "text/plain; charset=utf-8" } });
      }
      return json({ error: "Not found" }, 404, h);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, h);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env, event.scheduledTime || Date.now()));
  },
};
