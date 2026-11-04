// Same cases as the app's tests/remind.spec.js, run in a real time zone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clockIn, offsetFor, parseLine } from "../src/when.js";

const TZ = "America/Chicago";
// Wednesday 2026-11-04 10:00 in Chicago (CST, UTC-6) = 16:00 UTC.
const NOW = Date.UTC(2026, 10, 4, 16, 0);
const c = clockIn(TZ, NOW);
const local = (day, h, m = 0) => { const [y, mo, d] = day.split("-").map(Number); return Date.UTC(y, mo - 1, d, h + 6, m); }; // CST
const MIN = 60000;

test("time zone basics", () => {
  assert.equal(offsetFor(TZ, NOW), -360);
  assert.equal(offsetFor(TZ, Date.UTC(2026, 6, 1, 12)), -300); // summer, CDT
  assert.equal(c.today, "2026-11-04");
  assert.equal(c.addDays(1), "2026-11-05");
  assert.equal(c.nextDow(5), "2026-11-06");
  assert.equal(c.hour(), 10);
  assert.equal(c.at("2026-11-04", 15), local("2026-11-04", 15));
});

test("late evening in Chicago is still 'today' there, not UTC's tomorrow", () => {
  const evening = clockIn(TZ, Date.UTC(2026, 10, 5, 3, 30)); // 9:30 PM Nov 4 in Chicago
  assert.equal(evening.today, "2026-11-04");
  const t = parseLine("Call shop at 9am", evening);
  assert.equal(t.plan, "2026-11-05");
  assert.equal(t.remind, local("2026-11-05", 9));
});

test("same readings as the app", () => {
  const cases = [
    ["pick up girls in 45 mins", "pick up girls", { remind: NOW + 45 * MIN, plan: "2026-11-04" }],
    ["Call shop in an hour", "Call shop", { remind: NOW + 60 * MIN }],
    ["Stretch in half an hour", "Stretch", { remind: NOW + 30 * MIN }],
    ["Rebuild image in 3 hrs", "Rebuild image", { remind: NOW + 180 * MIN }],
    ["Team call at 3pm", "Team call", { remind: local("2026-11-04", 15), plan: "2026-11-04" }],
    ["Coffee at 9am", "Coffee", { remind: local("2026-11-05", 9), plan: "2026-11-05" }],
    ["Dentist tomorrow at 2:30pm", "Dentist", { remind: local("2026-11-05", 14, 30), plan: "2026-11-05" }],
    ["Call Matt fri at 3", "Call Matt", { remind: local("2026-11-06", 15), plan: "2026-11-06" }],
    ["Order parts in a couple days", "Order parts", { plan: "2026-11-06", remind: null }],
    ["my report is due in a few days", "my report", { due: "2026-11-07", plan: null }],
    ["Send invoice due fri at 9am", "Send invoice", { due: "2026-11-06", remind: local("2026-11-06", 9) }],
    ["Room 3 walkthrough", "Room 3 walkthrough", { remind: null, plan: null }],
    ["Fix pump #Skid @field ~30 tomorrow", "Fix pump", { plan: "2026-11-05", est: 30 }],
  ];
  for (const [typed, title, want] of cases) {
    const t = parseLine(typed, c);
    assert.equal(t.title, title, typed);
    for (const k of Object.keys(want)) assert.equal(t[k], want[k], `${typed} -> ${k}`);
  }
  assert.equal(parseLine("Fix pump #Skid @field ~30 tomorrow", c).pname, "Skid");
});
