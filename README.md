# Logbook

A browser extension (Chrome and Firefox) that tracks how you spend time on the web — visits, total
time, and average time per session for every site, styled like a page from a
real ledger.

All data stays on your machine. Nothing is ever sent anywhere.

## Features

- **Honest time tracking** — time counts only while the tab is active, the
  window is focused, and you are not idle (2 minutes without input stops the
  clock). Audio playing in the active tab keeps the clock running, so watching
  a video still counts.
- **Sessions, not tab switches** — returning to a site within 5 minutes
  continues the same session; a longer gap starts a new one. "Visits" means
  sessions, not raw tab activations.
- **Per-domain stats** — subdomains fold into the main domain
  (`music.youtube.com` counts as `youtube.com`).
- **Toolbar badge** — the extension icon shows how long you have been on the
  current site today ("42m", "1h05"). It turns red once the site is over its
  daily limit.
- **Daily popup** — today's sites sorted by time, with visits, total time,
  and average time per session.
- **Dashboard** — a full page with a weekly summary (this week vs last week,
  overall and for your top sites), a time-per-day bar chart (7 or 30 days),
  and a per-site drill-down with each site's daily history.
- **Daily limits** — set a per-site limit in minutes and get a notification
  at 80% and at 100% of it, once per site per day.
- **Export** — download everything stored as CSV or JSON, one row per site
  per day.
- **Ignore list** — ignored sites are never recorded; adding one also deletes
  its stored data.
- **Local only** — data lives in `chrome.storage.local`, kept per-day for
  90 days, then pruned automatically.

## Install

```sh
npm install
npm run build   # builds dist/chrome and dist/firefox
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/chrome/` directory

Or in Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and select `dist/firefox/manifest.json`

(Temporary add-ons are removed when Firefox closes. For a permanent
install, submit the zipped `dist/firefox/` to addons.mozilla.org — free,
with a self-distribution option.)

## Development

```sh
npm run dev            # rebuild Chrome build on file changes
npm run dev:firefox    # same, for the Firefox build
npm run build:chrome   # one-off Chrome build
npm run build:firefox  # one-off Firefox build
npm run typecheck      # TypeScript checks
```

After a rebuild, click the reload button on the extension card in
`chrome://extensions`, or **Reload** in `about:debugging` for Firefox.

## How it works

The background script (`src/background.ts` — a service worker in Chrome, an
event page in Firefox) listens to tab, window, and idle events, plus a
30-second heartbeat alarm. On every tick it credits
elapsed time to the domain that had attention, splitting at local midnight.
State survives service-worker restarts because it is persisted to storage on
each tick, and a credit cap prevents phantom time after suspend/resume.

The popup (`popup.html`, `src/popup/`) reads today's record and renders it.

## Project structure

```
manifest/base.json     Shared extension manifest (MV3)
manifest/chrome.json   Chrome-only manifest keys (service worker background)
manifest/firefox.json  Firefox-only manifest keys (event page, gecko id)
public/icons/          Extension icons (rendered from assets/logo.svg)
assets/logo.svg        Logo source
src/background.ts      Tracking engine + limit notifications (background script)
src/popup/             Popup UI
src/dashboard/         Dashboard page (charts, limits, export)
src/lib/               Shared: domain folding, storage, formatting
```

The build merges `manifest/base.json` with the per-browser overlay and
writes the result into `dist/chrome/` or `dist/firefox/`. All source code
is shared; the only browser difference in code is one optional call
(`idle.setDetectionInterval`, Chrome-only).

## Permissions

`tabs` (which site is active), `storage` (local stats), `idle` (stop the
clock when away), `alarms` (heartbeat), `notifications` (daily limit
alerts). No host permissions, no network access.

## License

[MIT](LICENSE)
