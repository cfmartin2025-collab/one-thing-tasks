// Reads a task line the same way the app's quick-add does (index.html: parseLine / parseWhen),
// but in a given time zone, because the server runs in UTC.
// Keep the rules in step with the app; test/when.test.mjs runs the same cases as tests/remind.spec.js.

const pad = (n) => String(n).padStart(2, "0");

/** Minutes east of UTC for a time zone at an instant, e.g. -360 for America/Chicago in winter. */
export function offsetFor(tz, ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const v = {};
  for (const p of parts) v[p.type] = +p.value;
  const asUTC = Date.UTC(v.year, v.month - 1, v.day, v.hour % 24, v.minute, v.second);
  return Math.round((asUTC - (ms - (ms % 1000))) / 60000);
}

/** A clock in a time zone: today's date, adding days, a time on a day, all in local terms. */
export function clockIn(tz, now) {
  const off = (ms) => offsetFor(tz, ms);
  const local = (ms) => new Date(ms + off(ms) * 60000); // read with getUTC*
  const ymd = (ms) => { const d = local(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); };
  const today = ymd(now);
  const addDays = (n) => { const [y, m, d] = today.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.getUTCFullYear() + "-" + pad(x.getUTCMonth() + 1) + "-" + pad(x.getUTCDate()); };
  const dow = local(now).getUTCDay();
  const nextDow = (w) => { let diff = (w - dow + 7) % 7; if (diff === 0) diff = 7; return addDays(diff); };
  const at = (day, h, mi = 0) => {
    const [y, m, d] = day.split("-").map(Number);
    const guess = Date.UTC(y, m - 1, d, h, mi);
    return guess - off(guess - off(guess) * 60000) * 60000;
  };
  const hour = () => local(now).getUTCHours();
  return { now, tz, today, ymd, addDays, nextDow, at, hour };
}

const DOW = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };

export function parseWhen(s, c) {
  const out = { rest: s, plan: null, due: null, remind: null, words: null };
  let m, time = null;
  const take = (re) => { const mm = out.rest.match(re); if (mm) out.rest = out.rest.slice(0, mm.index); return mm; };
  if ((m = take(/\s+in\s+(\d+(?:\.\d+)?|an?|one|two|three|four|five|ten|half\s+an?)\s*(m|mins?|minutes?|h|hrs?|hours?)\.?$/i))) {
    const half = /^half/i.test(m[1]), n = half ? 0.5 : (NUMW[m[1].toLowerCase()] || +m[1]), hrs = half || /^h/i.test(m[2]);
    out.remind = Math.round((c.now + n * (hrs ? 60 : 1) * 60000) / 60000) * 60000;
    out.plan = c.ymd(out.remind);
  } else {
    if ((m = take(/\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)$/i))) {
      let h = +m[1] % 12; if (/^p/i.test(m[3])) h += 12; time = { h, mi: +(m[2] || 0) };
    } else if ((m = take(/\s+at\s+(\d{1,2})(?::(\d{2}))?$/i))) {
      let h = +m[1]; if (h >= 1 && h <= 6) h += 12;
      if (h < 24) time = { h, mi: +(m[2] || 0) };
    }
    let day = null, isDue = false, dm;
    if ((dm = take(/\s+(?:today|tonight)$/i))) day = c.today;
    else if ((dm = take(/\s+(?:tomorrow|tmrw|tmr)$/i))) day = c.addDays(1);
    else if ((dm = take(/\s+next week$/i))) day = c.nextDow(1);
    else if ((dm = take(/\s+in\s+(?:a\s+)?(\d+|a|an|one|two|three|four|five|six|seven|couple|few)(?:\s+of)?\s+(days?|weeks?)$/i))) {
      const k = NUMW[dm[1].toLowerCase()] || +dm[1]; day = c.addDays(/^w/i.test(dm[2]) ? 7 * k : k);
    } else if ((dm = take(/\s+(by\s+|due\s+|on\s+)?(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)$/i))) {
      day = c.nextDow(DOW[dm[2].toLowerCase()]); if (dm[1] && /^(by|due)/i.test(dm[1])) isDue = true;
    }
    if (day && !isDue && take(/\s+(?:is\s+)?(?:due|by)$/i)) isDue = true;
    if (day) { if (isDue) out.due = day; else out.plan = day; }
    if (time) {
      let when = day || c.today, at = c.at(when, time.h, time.mi);
      if (!day && at <= c.now) { when = c.addDays(1); at = c.at(when, time.h, time.mi); }
      out.remind = at;
      if (!out.plan) out.plan = when;
    }
  }
  out.rest = out.rest.replace(/\s+$/, "");
  if (out.rest.length < s.length) out.words = s.slice(out.rest.length).trim();
  return out;
}

/** Same as the app: #project, @context, ~minutes, a lone ! for today, then the "when". */
export function parseLine(line, c) {
  const t = { title: "", tags: [], est: null, today: false, pname: null, plan: null, due: null, remind: null };
  let s = " " + line + " ";
  s = s.replace(/\s#([^\s#@!~]+)/g, (m, n) => { t.pname = n; return " "; });
  s = s.replace(/\s@([^\s#@!~]+)/g, (m, n) => { t.tags.push(n.toLowerCase()); return " "; });
  s = s.replace(/\s~(\d+)m?(?=\s)/g, (m, n) => { t.est = +n; return " "; });
  s = s.replace(/\s!(?=\s)/g, () => { t.today = true; return " "; });
  s = s.replace(/\s+/g, " ").trim();
  const w = parseWhen(s, c);
  t.title = w.rest.trim(); t.plan = w.plan; t.due = w.due; t.remind = w.remind;
  if (t.today && !t.plan) t.plan = c.today;
  return t;
}
