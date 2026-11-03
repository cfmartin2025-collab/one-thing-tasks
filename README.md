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

- This is the only network endpoint the page calls (`api.github.com`), and only after you connect.
- Each round reads `data.json`, merges item by item (newest change wins; deletions are remembered for
  90 days), and writes back only if something is new. The file's `sha` prevents blind overwrites.
- Syncs on open, when you come back to the app, 2 s after a change, every minute while on screen,
  and when the connection returns.
- A device's own example tasks are not uploaded when it joins.

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
