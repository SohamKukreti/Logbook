# <img src="assets/logo.svg" width="56" alt="Logbook logo" align="top"> Logbook

A browser extension for Chrome and Firefox that tracks how you spend time
on the web. Visits, total time, and average time per session for every
site, styled like a page from a real ledger.

I built this because I wanted to know where my hours go without handing my
browsing history to yet another analytics service. So the rule is simple:
all data stays on your machine. There is no server, no account, no network
access at all. You can check, the extension does not even ask for host
permissions.

## What it does

- **Honest time tracking.** Time counts only while the tab is active, the
  window is focused, and you are not idle (2 minutes without input stops
  the clock). Audio in the active tab keeps the clock running, so watching
  a video still counts.
- **Sessions, not tab switches.** Coming back to a site within 5 minutes
  continues the same session. A longer gap starts a new one. "Visits"
  means sessions, not raw tab activations, which keeps the numbers sane.
- **Per-domain stats.** Subdomains fold into the main domain, so
  `music.youtube.com` counts as `youtube.com`.
- **Toolbar badge.** The icon shows how long you have been on the current
  site today ("42m", "1h05"), and turns red once the site is over its
  daily limit.
- **Daily popup.** Today's sites sorted by time, with visits, total time,
  and average time per session.
- **Dashboard.** A full page with a weekly summary (this week vs last
  week, overall and for your top sites), a time-per-day bar chart over 7
  or 30 days, and a per-site drill-down with daily history.
- **Daily limits.** Set a per-site limit in minutes and get a notification
  at 80% and at 100% of it, once per site per day.
- **Export.** Download everything as CSV or JSON, one row per site per
  day. It is your data.
- **Ignore list.** Ignored sites are never recorded, and adding one also
  deletes everything already stored about it.
- **Local only.** Data lives in `chrome.storage.local`, kept per day for
  90 days, then pruned automatically.

## Installing

There is no store listing yet, so you build it yourself. It takes a
minute:

```sh
npm install
npm run build   # builds dist/chrome and dist/firefox
```

**Chrome:**

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and pick the `dist/chrome/` directory

**Firefox:**

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** and pick `dist/firefox/manifest.json`

Heads up: Firefox removes temporary add-ons when it closes. For a
permanent install you need to run the zipped `dist/firefox/` through
addons.mozilla.org signing, which is free and has a self-distribution
option.

## Hacking on it

```sh
npm run dev            # rebuild the Chrome build on file changes
npm run dev:firefox    # same, for the Firefox build
npm run typecheck      # TypeScript checks
```

After a rebuild, hit the reload button on the extension card in
`chrome://extensions`, or **Reload** in `about:debugging` for Firefox.

### How it works

The background script (`src/background.ts`, a service worker in Chrome and
an event page in Firefox) listens to tab, window, and idle events, plus a
30-second heartbeat alarm. On every tick it credits the elapsed time to
the domain that had your attention, splitting at local midnight. State is
persisted to storage on each tick, so it survives the browser killing the
background script, and a credit cap prevents phantom hours after a laptop
suspend.

The popup reads today's record and renders it. The dashboard renders
everything stored and live-updates as the background script writes.

### Layout

```
manifest/base.json     Shared extension manifest (MV3)
manifest/chrome.json   Chrome-only keys (service worker background)
manifest/firefox.json  Firefox-only keys (event page, gecko id)
public/icons/          Extension icons (rendered from assets/logo.svg)
assets/logo.svg        Logo source
src/background.ts      Tracking engine and limit notifications
src/popup/             Popup UI
src/dashboard/         Dashboard page (charts, limits, export)
src/lib/               Shared: domain folding, storage, formatting
```

Both browsers build from the same code. The build merges
`manifest/base.json` with the per-browser overlay and writes the result
into `dist/chrome/` or `dist/firefox/`. The only browser-specific line of
code in the whole project is an optional call to
`idle.setDetectionInterval`, which Firefox does not have.

## Permissions, and why

- `tabs`: to know which site is active
- `storage`: to keep your stats locally
- `idle`: to stop the clock when you walk away
- `alarms`: the heartbeat tick
- `notifications`: daily limit alerts

No host permissions and no network access. The extension cannot read page
content and has nowhere to send anything.

## Contributing

Issues and pull requests are welcome. If you are planning something
bigger than a bug fix, open an issue first so we can talk it through.
Please run `npm run typecheck` before sending a PR.

## License

[MIT](LICENSE)
