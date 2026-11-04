# One Thing Tasks

A calm, low-friction personal task app. One self-contained file: `index.html` (inline CSS and JS).

## Run it

Open `index.html` in a browser. With no `window.claude`, data stays in this browser's
localStorage (key `onething.v1`), and the Claude buttons (Sort it out, I am stuck) are hidden.

On claude.ai it runs as an artifact. There it also:
- syncs state through the `db` capability to `data/users/<id>/app` as `{json, updated}` (newest `updated` wins)
- uses `sample` for "Sort it out" and Focus's "I am stuck"

## Installable app (PWA)

`manifest.webmanifest`, `sw.js`, and `icons/` make it installable when served over HTTPS
(for example GitHub Pages). On iPhone/iPad: open the URL in Safari → Share → Add to Home Screen.
The service worker caches the app for offline use. It does not register inside claude.ai or on `file://`.
Regenerate icons with `powershell -File tools/make-icons.ps1`.

Local preview: `powershell -ExecutionPolicy Bypass -File tools/serve.ps1` then open http://localhost:8765/.

Note: an installed home-screen app has its own storage, separate from Safari and from claude.ai.
Deleting the home-screen icon deletes that device's copy.

## Sync across devices

Outside claude.ai the app can sync through a private GitHub repo `<you>/one-thing-data` (file `data.json`).
Settings → Sync across devices → paste a fine-grained token that can only read and write that one repo.
The token is kept in that device's localStorage (`onething.sync`), never in the data or in backups.

- The page calls `api.github.com` only after you connect (see also Sort it out below).
- Each round reads `data.json`, merges item by item (newest change wins; deletions are remembered for
  90 days), and writes back only if something is new. The file's `sha` prevents blind overwrites.
- Syncs on open, when you come back to the app, 2 s after a change, every minute while on screen,
  and when the connection returns.
- A device's own example tasks are not uploaded when it joins.

## Reminders

Quick-add reads a time from the end of a line: `in 45 mins`, `in an hour`, `in half an hour`, `in 2 hrs`,
`at 3pm`, `9:30am`, `at 3` (afternoon), combined with a day (`tomorrow at 9`, `fri at 2:30pm`).
Days also accept `in a few days` (3), `in a couple days` (2), `in a week`. A day after `due`, `is due`,
or `by` sets the deadline instead of the do-date. Keep as text undoes any of it.

- Stored per task as `remind` (epoch ms). Data version 3; `norm()` adds `remind: null` to older data.
- Anything due today gets one heads-up at 9:00. Finished tasks never fire.
- Fires while the app is open (checked every 20 s and on reopen), as a system notification if allowed
  (Settings → Reminders), otherwise as an in-app message. Each device remembers what it already showed
  (`onething.notified`).
- Not yet: alerts while the app is fully closed. That needs Web Push from a small server.

## Sort it out (Claude)

The **Sort** tab turns a paragraph into projects, ordered steps, do-dates, deadlines, and loose
tasks. You check the result before anything is added. Focus's **I am stuck** uses the same plumbing.

- Inside claude.ai it uses the artifact's `sample` capability.
- As an installed app it calls the Anthropic Messages API directly from the page with your own key
  (Settings → Claude for Sort it out). The key is kept in that device's localStorage (`onething.ai`),
  never in the synced data or backups. Saving the key checks it against the free `/v1/models` endpoint.
- Model `claude-opus-5-5`, effort `medium`, structured outputs (`output_config.format` JSON schema),
  `anthropic-version: 2026-10-21`, server-side refusal fallback (`fallbacks: "default"`, retried once
  without it if the API rejects the option). Plain `fetch`, since the page has no build step for the SDK.
- One request per tap; nothing runs in the background. Roughly a few cents per Sort it out.
- Second network endpoint the page can call: `api.anthropic.com`, only when you tap Sort it out or I am stuck.

Data version 2 adds `mod` (last change time) to tasks, projects, and templates, plus `gone` (deleted
id → time) and `settingsMod`. `norm()` migrates older data.

## Data

One object `S`: `tasks[]`, `projects[]`, `templates[]`, `settings.todayLimit`, `updated`.
Any change to its shape needs a migration in `norm()`.

## Constraints

- One HTML file.
- External loads limited to Google Fonts and cdnjs scripts pinned to an exact version. No other network calls.
- Must work at phone width (390px), iPad mini, and desktop, in light and dark mode.

## Tests

Playwright smoke test in `tests/smoke.spec.js` covers capture, scheduling, project creation,
break-into-steps, and Focus, plus screenshots at 390px and 1100px wide (light and dark).

```
npm install
npx playwright install chromium
npx playwright test
```

Screenshots are written to `tests/shots/`.
