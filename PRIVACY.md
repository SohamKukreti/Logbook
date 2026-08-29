# Logbook Privacy Policy

_Last updated: 2026-08-29_

Logbook is a browser extension that shows you how you spend time on the
web. It is built around one rule: **your data never leaves your
machine.**

## What Logbook stores

For each site you actively use, Logbook stores on your device:

- the domain name (for example `youtube.com` — never full URLs, page
  titles, or page content),
- total active time per day,
- number of sessions per day,
- your own settings: ignored sites, pinned sites, and daily limits.

Time is only counted while the tab is active, the window is focused, and
you are not idle.

## What Logbook does NOT do

- It does **not** collect, transmit, or share any data. There is no
  server, no account, no analytics, no telemetry, and the extension makes
  no network requests of any kind.
- It does **not** read page content. The script that runs in pages exists
  only to display the daily-limit banner and overlay; it reads nothing
  from the page and sends nothing anywhere.
- It does **not** record full URLs, searches, form input, or browsing
  history beyond the per-day, per-domain totals described above.
- It does **not** use cookies or any third-party services.

## Where the data lives, and for how long

All data is stored locally in your browser's extension storage
(`chrome.storage.local`). Daily records older than 365 days are deleted
automatically. At most 200 distinct sites are kept by name; beyond that,
the smallest are merged into an anonymous "everything else" bucket.

## Your controls

- **Ignore a site**: it is never recorded again, and everything already
  stored about it is deleted immediately.
- **Export**: you can download all of your data as CSV or JSON at any
  time from the dashboard.
- **Delete everything**: uninstalling the extension removes all stored
  data.

## Changes

If this policy ever changes, the change will appear in this file's
version history in the public source repository.

## Contact

Questions about this policy: Soham Kukreti —
kukretisoham@gmail.com
