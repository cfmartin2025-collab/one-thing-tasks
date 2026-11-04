import { test } from "node:test";
import assert from "node:assert/strict";
import { clockIn } from "../src/when.js";
import { dueNotifications } from "../src/plan.js";

const TZ = "America/Chicago";
const at = (h, m = 0) => Date.UTC(2026, 10, 4, h + 6, m); // Nov 4 2026, Chicago local h:m
const T = (o) => Object.assign({ id: Math.random().toString(36).slice(2), title: "x", done: false, someday: false, plan: null, due: null, remind: null, defer: null }, o);

test("a reminder fires at its minute, not before, not 20 minutes late, and not when done", () => {
  const S = { tasks: [T({ id: "a", title: "pick up girls", remind: at(10, 45) }), T({ id: "b", title: "done one", remind: at(10, 45), done: true })] };
  assert.equal(dueNotifications(S, clockIn(TZ, at(10, 44))).length, 0);
  const n = dueNotifications(S, clockIn(TZ, at(10, 45)));
  assert.deepEqual(n.map((x) => x.payload.body), ["pick up girls"]);
  assert.equal(n[0].key, `r:a:${at(10, 45)}`);
  assert.equal(dueNotifications(S, clockIn(TZ, at(10, 55))).length, 1); // still inside the window, same key -> deduped by the caller
  assert.equal(dueNotifications(S, clockIn(TZ, at(11, 5))).length, 0);
});

test("due today gets a heads-up from 9:00", () => {
  const S = { tasks: [T({ title: "Submit timesheet", due: "2026-11-04" }), T({ title: "Later due", due: "2026-11-05" })] };
  assert.equal(dueNotifications(S, clockIn(TZ, at(8, 30))).filter((n) => n.payload.title === "Due today").length, 0);
  const n = dueNotifications(S, clockIn(TZ, at(9, 1))).filter((n) => n.payload.title === "Due today");
  assert.deepEqual(n.map((x) => x.payload.body), ["Submit timesheet"]);
});

test("morning summary counts today and from earlier; silent when empty", () => {
  const S = { tasks: [T({ plan: "2026-11-04" }), T({ plan: "2026-11-04" }), T({ plan: "2026-11-03" }), T({ plan: "2026-11-05" })] };
  const m = dueNotifications(S, clockIn(TZ, at(8, 0))).find((n) => n.key.startsWith("m:"));
  assert.equal(m.payload.body, "2 things planned today · 1 from earlier.");
  assert.equal(dueNotifications({ tasks: [] }, clockIn(TZ, at(8, 0))).length, 0);
});

test("end of day: open count, opens the wrap-up", () => {
  const S = { tasks: [T({ plan: "2026-11-04" }), T({ plan: "2026-11-04", done: true })] };
  const e = dueNotifications(S, clockIn(TZ, at(17, 0))).find((n) => n.key.startsWith("e:"));
  assert.equal(e.payload.body, "1 thing is still open. Tap to move to tomorrow.");
  assert.equal(e.payload.url, "./?wrap=1");
});

test("hours can come from settings", () => {
  const S = { settings: { morningHour: 7 }, tasks: [T({ plan: "2026-11-04" })] };
  assert.equal(dueNotifications(S, clockIn(TZ, at(7, 10))).filter((n) => n.key.startsWith("m:")).length, 1);
  assert.equal(dueNotifications(S, clockIn(TZ, at(8, 10))).filter((n) => n.key.startsWith("m:")).length, 0);
});
