# Logbook

A Chrome extension that tracks how you spend time on the web — visits, total
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
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` directory

## Development

```sh
npm run dev        # rebuild on file changes
npm run typecheck  # TypeScript checks
```

After a rebuild, click the reload button on the extension card in
`chrome://extensions`.

## How it works

The background service worker (`src/background.ts`) listens to tab, window,
and idle events, plus a 30-second heartbeat alarm. On every tick it credits
elapsed time to the domain that had attention, splitting at local midnight.
State survives service-worker restarts because it is persisted to storage on
each tick, and a credit cap prevents phantom time after suspend/resume.

The popup (`popup.html`, `src/popup/`) reads today's record and renders it.

## Project structure

```
public/manifest.json   Extension manifest (MV3)
public/icons/          Extension icons (rendered from assets/logo.svg)
assets/logo.svg        Logo source
src/background.ts      Tracking engine + limit notifications (service worker)
src/popup/             Popup UI
src/dashboard/         Dashboard page (charts, limits, export)
src/lib/               Shared: domain folding, storage, formatting
```

## Permissions

`tabs` (which site is active), `storage` (local stats), `idle` (stop the
clock when away), `alarms` (heartbeat), `notifications` (daily limit
alerts). No host permissions, no network access.

## License

[MIT](LICENSE)
