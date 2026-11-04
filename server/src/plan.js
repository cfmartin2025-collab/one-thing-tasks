// Decides which notifications are due right now, from the synced task data (S) and a local clock.
// Each one has a stable key so it is sent once, however often this runs.

const WINDOW = 15 * 60000; // a reminder is still sent if the job runs up to 15 minutes late

function hourSetting(S, name, dflt) {
  const v = S && S.settings && S.settings[name];
  return Number.isInteger(v) && v >= 0 && v <= 23 ? v : dflt;
}

/** Tasks that belong on Today, the same rule as the app's listToday(). */
function todayList(S, today) {
  return (S.tasks || []).filter((t) => {
    if (t.done || t.someday || (t.defer && t.defer > today)) return false;
    return (t.plan && t.plan <= today) || (t.due && t.due <= today);
  });
}
function isLeftover(t, today) {
  return (t.plan && t.plan < today) || (!t.plan && t.due && t.due < today);
}
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

export function dueNotifications(S, c) {
  const out = [];
  const tasks = S && Array.isArray(S.tasks) ? S.tasks : [];
  const morning = hourSetting(S, "morningHour", 8);
  const dueHour = hourSetting(S, "dueHour", 9);
  const evening = hourSetting(S, "eveningHour", 17);
  const h = c.hour();

  // 1. A task's own reminder.
  for (const t of tasks) {
    if (t.done || !t.remind) continue;
    if (t.remind <= c.now && t.remind > c.now - WINDOW) {
      out.push({ key: `r:${t.id}:${t.remind}`, payload: { title: "One Thing", body: t.title, tag: t.id, url: "./" } });
    }
  }
  // 2. Due today: one heads-up, from the morning on.
  if (h >= dueHour && h < 22) {
    for (const t of tasks) {
      if (t.done || t.someday || t.due !== c.today) continue;
      out.push({ key: `d:${t.id}:${c.today}`, payload: { title: "Due today", body: t.title, tag: t.id, url: "./" } });
    }
  }
  // 3. Morning summary, during that hour, once a day, only if there is something.
  if (h === morning) {
    const list = todayList(S, c.today);
    if (list.length) {
      const early = list.filter((t) => isLeftover(t, c.today)).length;
      const body = plural(list.length - early, "thing", "things") + " planned today" + (early ? " · " + early + " from earlier" : "") + ".";
      out.push({ key: `m:${c.today}`, payload: { title: "Good morning", body, tag: "morning", url: "./" } });
    }
  }
  // 4. End of day: what is still open, with one tap to move it on.
  if (h === evening) {
    const open = todayList(S, c.today).length;
    if (open) {
      out.push({ key: `e:${c.today}`, payload: { title: "End of day", body: plural(open, "thing is", "things are") + " still open. Tap to move to tomorrow.", tag: "evening", url: "./?wrap=1" } });
    }
  }
  return out;
}
