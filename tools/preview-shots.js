// Renders preview screenshots with a sample week into tests/shots/preview/.
// Run: node tools/preview-shots.js
const { chromium } = require("@playwright/test");
const path = require("path");

const APP = "file://" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");
const OUT = path.resolve(__dirname, "..", "tests", "shots", "preview");

function sample() {
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const add = (n) => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + n); return ymd(d); };
  const s = window.__app.state;
  s.tasks = [];
  s.projects = [{ id: "p1", name: "Pump skid upgrade", sequential: true, mod: 1 }, { id: "p2", name: "Panel build", sequential: false, mod: 1 }];
  let k = 1;
  const T = (o) => s.tasks.push(Object.assign({ id: "t" + k, title: "", notes: "", project: null, tags: [], energy: null, due: null, defer: null, est: null, plan: null, someday: false, done: false, doneAt: null, inbox: false, created: k, order: k++, mod: 1 }, o));
  T({ title: "Order fittings", plan: add(-1) });
  T({ title: "Review P&ID and I/O list", project: "p1", plan: add(0), est: 30 });
  T({ title: "Call Matt about the truck", plan: add(0), est: 10 });
  T({ title: "Build the pump AOI", project: "p1", plan: add(1), est: 90 });
  T({ title: "Team meeting", plan: add(1) });
  T({ title: "Print panel drawings", project: "p2", plan: add(2), est: 5 });
  T({ title: "Send FAT report", due: add(3) });
  T({ title: "Mount PLC and I/O cards", project: "p2", plan: add(4), est: 60 });
  T({ title: "Renew site badge", plan: add(6) });
  T({ title: "Ship skid", project: "p1", due: add(9) });
  T({ title: "Clean up the shop bench" });
  T({ title: "Look at new HMI software", someday: true });
  T({ title: "Random idea from the field", inbox: true });
  T({ title: "Fixed the conveyor sensor", done: true, doneAt: Date.now() - 86400000 });
  window.__app.render();
}

(async () => {
  const browser = await chromium.launch();
  const shots = [
    ["1-phone-week", 390, 844, "light", "cal", "week"],
    ["2-phone-month", 390, 844, "light", "cal", "month"],
    ["3-phone-inbox", 390, 844, "light", "inbox"],
    ["4-phone-today", 390, 844, "light", "today"],
    ["5-desktop-week", 1180, 760, "light", "cal", "week"],
    ["6-desktop-month-dark", 1180, 760, "dark", "cal", "month"],
  ];
  for (const [name, w, h, scheme, view, mode] of shots) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme });
    await page.goto(APP);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("onething.ai", JSON.stringify({ key: "sk-ant-preview" })); });
    await page.reload();
    await page.evaluate(sample);
    await page.evaluate((v) => window.__app.setView(v), view);
    if (mode === "month") await page.click('[data-act="calmode"][data-v="month"]');
    if (name === "5-desktop-week") await page.click('[data-act="tray"][data-v="any"]');
    await page.screenshot({ path: path.join(OUT, name + ".png") });
    await page.close();
  }
  await browser.close();
  console.log("Wrote previews to " + OUT);
})();
