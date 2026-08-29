import { domainFromInput } from "../lib/domain";
import { formatDuration } from "../lib/format";
import {
  dateKey,
  defaultSettings,
  displayName,
  getAllDays,
  getSettings,
  setSettings,
  DAY_PREFIX,
  OTHER_DOMAIN,
  SETTINGS_KEY,
  type DayRecord,
  type Settings,
} from "../lib/storage";

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let days: Record<string, DayRecord> = {};
let settings: Settings = defaultSettings();
let range = 7;
let selectedSite: string | null = null;
let overviewScroll = 0;

/* ---- date helpers ---- */

/** The last n local dates, oldest first, ending today. */
function datesBack(n: number, endOffset = 0): string[] {
  const out: string[] = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  for (let i = n - 1 + endOffset; i >= endOffset; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(dateKey(d.getTime()));
  }
  return out;
}

function shortLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)}/${Number(m)}`;
}

/** Whole days from date a to date b (both "YYYY-MM-DD", a <= b). */
function daysBetween(a: string, b: string): number {
  // Noon-to-noon dodges DST shifts.
  return Math.round((Date.parse(`${b}T12:00`) - Date.parse(`${a}T12:00`)) / 86_400_000);
}

/** Weekday of a date key, Monday = 0 … Sunday = 6. */
function weekday(date: string): number {
  return (new Date(`${date}T12:00`).getDay() + 6) % 7;
}

function prettyDate(date: string): string {
  return new Date(`${date}T12:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ---- aggregation ---- */

function dayTotal(rec: DayRecord | undefined, site?: string): number {
  if (!rec) return 0;
  if (site) return rec[site]?.totalMs ?? 0;
  return Object.values(rec).reduce((sum, s) => sum + s.totalMs, 0);
}

function aggregate(dates: string[]): Record<string, { totalMs: number; sessions: number }> {
  const out: Record<string, { totalMs: number; sessions: number }> = {};
  for (const date of dates) {
    const rec = days[date];
    if (!rec) continue;
    for (const [site, s] of Object.entries(rec)) {
      const agg = out[site] ?? (out[site] = { totalMs: 0, sessions: 0 });
      agg.totalMs += s.totalMs;
      agg.sessions += s.sessions;
    }
  }
  return out;
}

/* ---- weekly summary ---- */

function renderSummary(): void {
  // The summary follows the selected range: today vs yesterday,
  // this week vs last week, or this month vs last month.
  const title = range === 1 ? "Today" : range === 7 ? "This week" : "This month";
  const cmpLabel = range === 1 ? "yesterday" : range === 7 ? "last week" : "last month";
  const current = datesBack(range);
  const previous = datesBack(range, range);
  const thisTotal = current.reduce((s, d) => s + dayTotal(days[d]), 0);
  const lastTotal = previous.reduce((s, d) => s + dayTotal(days[d]), 0);

  $("summary-label").textContent = title;
  $("week-total").textContent = formatDuration(thisTotal);
  $("week-compare").textContent = compareText(thisTotal, lastTotal, cmpLabel);

  const agg = aggregate(current);
  const lastAgg = aggregate(previous);
  const top = Object.entries(agg)
    .filter(([site]) => site !== OTHER_DOMAIN)
    .sort(([, a], [, b]) => b.totalMs - a.totalMs)
    .slice(0, 3);

  const wrap = $("summary-sites");
  wrap.replaceChildren();
  for (const [site, s] of top) {
    const card = document.createElement("div");
    card.className = "site-card";
    const name = document.createElement("p");
    name.className = "label";
    name.textContent = site;
    const val = document.createElement("p");
    val.className = "mid";
    val.textContent = formatDuration(s.totalMs);
    const cmp = document.createElement("p");
    cmp.className = "compare";
    cmp.textContent = compareText(s.totalMs, lastAgg[site]?.totalMs ?? 0, cmpLabel);
    card.append(name, val, cmp);
    wrap.appendChild(card);
  }
}

function compareText(now: number, before: number, label: string): string {
  if (before === 0) return now > 0 ? `nothing ${label}` : `same as ${label}`;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return `same as ${label}`;
  return `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs ${label} (${formatDuration(before)})`;
}

/* ---- bar chart ---- */

function renderChart(el: HTMLElement, dates: string[], site?: string): void {
  el.replaceChildren();
  const totals = dates.map((d) => dayTotal(days[d], site));
  const max = Math.max(...totals, 1);
  const labelEvery = dates.length > 10 ? 5 : 1;

  dates.forEach((date, i) => {
    const total = totals[i] ?? 0;
    const col = document.createElement("div");
    col.className = "col";

    const pct = Math.max((total / max) * 100, total > 0 ? 2 : 0);
    const barBox = document.createElement("div");
    barBox.className = "bar-box";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${pct}%`;
    barBox.appendChild(bar);

    if (total > 0) {
      const tip = document.createElement("span");
      tip.className = "tip";
      tip.textContent = formatDuration(total);
      tip.style.bottom = `calc(${pct}% + 6px)`;
      barBox.appendChild(tip);
    }

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = i % labelEvery === 0 || i === dates.length - 1 ? shortLabel(date) : "";

    col.append(barBox, label);
    el.appendChild(col);
  });
}

/* ---- pinning ---- */

function makeRibbon(): HTMLSpanElement {
  const ribbon = document.createElement("span");
  ribbon.className = "ribbon";
  return ribbon;
}

async function togglePin(site: string): Promise<void> {
  const s = await getSettings();
  if (s.pinned.includes(site)) s.pinned = s.pinned.filter((d) => d !== site);
  else s.pinned.push(site);
  await setSettings(s);
}

/* ---- sites table ---- */

function renderTable(): void {
  const dates = datesBack(range);
  const agg = aggregate(dates);
  const bySize = Object.entries(agg)
    .filter(([, s]) => s.totalMs > 0 || s.sessions > 0)
    .sort(([, a], [, b]) => b.totalMs - a.totalMs);
  // Pinned rows first, then the rest by time; the catch-all bucket last.
  const rows = [
    ...bySize.filter(([site]) => settings.pinned.includes(site)),
    ...bySize.filter(([site]) => !settings.pinned.includes(site) && site !== OTHER_DOMAIN),
    ...bySize.filter(([site]) => site === OTHER_DOMAIN && !settings.pinned.includes(site)),
  ];
  const maxTotal = bySize.length ? Math.max(...bySize.map(([, s]) => s.totalMs), 1) : 1;

  const body = $<HTMLTableSectionElement>("sites-body");
  body.replaceChildren();
  $("sites-table").hidden = rows.length === 0;
  $("empty").hidden = rows.length > 0;

  for (const [site, s] of rows) {
    const isOther = site === OTHER_DOMAIN;
    const tr = document.createElement("tr");

    const siteTd = document.createElement("td");
    siteTd.className = "site";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = displayName(site);
    if (isOther) tr.className = "other-row";

    const barTrack = document.createElement("span");
    barTrack.className = "row-bar";
    barTrack.style.width = `${(s.totalMs / maxTotal) * 100}%`;
    siteTd.append(name, barTrack);

    const mk = (text: string) => {
      const td = document.createElement("td");
      td.className = "num";
      td.textContent = text;
      return td;
    };
    const avg = s.sessions > 0 ? s.totalMs / s.sessions : 0;
    const pinTd = document.createElement("td");
    pinTd.className = "pin-col";
    if (!isOther) {
      const pinned = settings.pinned.includes(site);
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = `ribbon-btn row-pin${pinned ? " pinned" : ""}`;
      pinBtn.title = pinned ? `Unpin ${site}` : `Pin ${site}`;
      pinBtn.appendChild(makeRibbon());
      pinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void togglePin(site);
      });
      pinTd.appendChild(pinBtn);
    }
    tr.append(
      siteTd,
      mk(String(s.sessions)),
      mk(formatDuration(s.totalMs)),
      mk(formatDuration(avg)),
      pinTd,
    );

    if (!isOther) {
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      const open = () => {
        // Remember where the list was scrolled to, then open at the top.
        overviewScroll = window.scrollY;
        showSite(site);
        window.scrollTo(0, 0);
      };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") open();
      });
    }
    body.appendChild(tr);
  }
}

/* ---- per-site drill-down ---- */

function showSite(site: string): void {
  selectedSite = site;
  $("overview").hidden = true;
  $("site-view").hidden = false;
  // The detail view uses fixed spans; the range picker is overview-only.
  $("range-toggle").hidden = true;
  $("site-name").textContent = displayName(site);

  const isOther = site === OTHER_DOMAIN;
  const pinBtn = $("pin-site");
  pinBtn.hidden = isOther;
  const pinned = settings.pinned.includes(site);
  pinBtn.classList.toggle("pinned", pinned);
  pinBtn.title = pinned ? "Unpin this site" : "Pin this site";

  $("site-limit-box").hidden = isOther;
  if (!isOther) renderSiteLimit(site);
  renderShare(site);
  renderTiles(site);
  renderChart($("site-chart"), datesBack(30), site);
  renderHeatmap(site);
  renderDow(site);
}

function showOverview(): void {
  selectedSite = null;
  $("site-view").hidden = true;
  $("overview").hidden = false;
  $("range-toggle").hidden = false;
  window.scrollTo(0, overviewScroll);
}

/* ---- site limit row ---- */

function renderSiteLimit(site: string): void {
  const minutes = settings.limits[site];
  const line = $("site-limit-line");
  const removeBtn = $<HTMLButtonElement>("site-limit-remove");
  const input = $<HTMLInputElement>("site-limit-minutes");
  if (minutes !== undefined && minutes > 0) {
    const used = dayTotal(days[dateKey(Date.now())], site);
    const left = Math.max(minutes * 60_000 - used, 0);
    line.textContent =
      left > 0
        ? `Daily limit: ${minutes} min, ${formatDuration(left)} left today.`
        : `Daily limit: ${minutes} min, all used up for today.`;
    input.placeholder = String(minutes);
    removeBtn.hidden = false;
  } else {
    line.textContent = "No daily limit for this site.";
    input.placeholder = "60";
    removeBtn.hidden = true;
  }
}

/* ---- stat tiles ---- */

/** Total stored ms on a site, plus its first active date key. */
function siteHistory(site: string): { total: number; firstActive: string } {
  let total = 0;
  let firstActive = "";
  for (const date of Object.keys(days).sort()) {
    const ms = dayTotal(days[date], site);
    if (ms > 0) {
      total += ms;
      if (!firstActive) firstActive = date;
    }
  }
  return { total, firstActive };
}

/** "Label — value" pair for a panel footer. */
function footStat(el: HTMLElement, label: string, value: string): void {
  el.replaceChildren();
  const l = document.createElement("span");
  l.className = "label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "foot-val";
  v.textContent = value;
  el.append(l, v);
}

function renderShare(site: string): void {
  const { total } = siteHistory(site);
  const allTotal = Object.keys(days).reduce((s, d) => s + dayTotal(days[d]), 0);
  const share = allTotal > 0 ? (total / allTotal) * 100 : 0;
  $("site-share").textContent =
    total > 0 ? `${share < 10 ? share.toFixed(1) : Math.round(share)}% of all browsing` : "";
}

function renderTiles(site: string): void {
  const todayKey = dateKey(Date.now());
  const { total } = siteHistory(site);
  const today = dayTotal(days[todayKey], site);
  const week = datesBack(7).reduce((s, d) => s + dayTotal(days[d], site), 0);
  const lastWeek = datesBack(7, 7).reduce((s, d) => s + dayTotal(days[d], site), 0);

  let weekCmp = "same as last week";
  if (lastWeek === 0 && week > 0) weekCmp = "nothing last week";
  else if (lastWeek > 0) {
    const pct = Math.round(((week - lastWeek) / lastWeek) * 100);
    if (pct !== 0) weekCmp = `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs last week`;
  }

  const tiles: { label: string; value: string; sub?: string }[] = [
    { label: "Today", value: formatDuration(today) },
    { label: "This week", value: formatDuration(week), sub: weekCmp },
    { label: "Total, all stored", value: formatDuration(total) },
  ];

  const wrap = $("site-tiles");
  wrap.replaceChildren();
  for (const t of tiles) {
    const tile = document.createElement("div");
    tile.className = "tile";
    const label = document.createElement("p");
    label.className = "label";
    label.textContent = t.label;
    const value = document.createElement("p");
    value.className = "tile-value";
    value.textContent = t.value;
    tile.append(label, value);
    if (t.sub) {
      const sub = document.createElement("p");
      sub.className = "tile-sub";
      sub.textContent = t.sub;
      tile.appendChild(sub);
    }
    wrap.appendChild(tile);
  }
}

/** Longest run of consecutive days with any time on the site. */
function longestStreak(site: string, firstActive: string, todayKey: string): number {
  if (!firstActive) return 0;
  const span = daysBetween(firstActive, todayKey) + 1;
  let best = 0;
  let run = 0;
  for (const date of datesBack(span)) {
    if (dayTotal(days[date], site) > 0) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/* ---- activity heatmap (GitHub-style, ledger red) ---- */

function renderHeatmap(site: string): void {
  const wrap = $("heatmap");
  wrap.replaceChildren();

  const todayKey = dateKey(Date.now());
  const stored = Object.keys(days).sort();
  const firstStored = stored[0] ?? todayKey;
  // Adaptive span: as far back as the data goes, at most a year.
  const yearAgo = datesBack(365)[0]!;
  const start = firstStored > yearAgo ? firstStored : yearAgo;
  // Pad back to Monday so weeks form clean columns.
  const span = daysBetween(start, todayKey) + 1 + weekday(start);
  const dates = datesBack(span);

  const totals = dates.map((d) => dayTotal(days[d], site));
  const max = Math.max(...totals, 1);
  const level = (ms: number): number => {
    if (ms <= 0) return 0;
    return Math.min(Math.ceil((ms / max) * 4), 4);
  };

  $("heatmap-title").textContent = `Activity since ${prettyDate(dates[0]!)}`;

  const months = document.createElement("div");
  months.className = "hm-months";
  const body = document.createElement("div");
  body.className = "hm-body";

  const dayCol = document.createElement("div");
  dayCol.className = "hm-days";
  for (const label of ["Mon", "", "Wed", "", "Fri", "", ""]) {
    const span2 = document.createElement("span");
    span2.textContent = label;
    dayCol.appendChild(span2);
  }
  body.appendChild(dayCol);

  const grid = document.createElement("div");
  grid.className = "hm-grid";
  let lastMonth = "";
  for (let w = 0; w < dates.length; w += 7) {
    const weekDates = dates.slice(w, w + 7);
    const col = document.createElement("div");
    col.className = "hm-week";
    for (let i = 0; i < 7; i++) {
      const date = weekDates[i];
      const cell = document.createElement("span");
      cell.className = "hm-cell";
      if (date === undefined) {
        // Trailing pad after today: keep the column shape, show nothing.
        cell.classList.add("blank");
      } else {
        const ms = dayTotal(days[date], site);
        cell.classList.add(`l${level(ms)}`);
        cell.title = `${prettyDate(date)} — ${ms > 0 ? formatDuration(ms) : "nothing"}`;
      }
      col.appendChild(cell);
    }
    grid.appendChild(col);

    // Month label above the first week that enters a new month.
    const month = new Date(`${weekDates[0]}T12:00`).toLocaleDateString(undefined, {
      month: "short",
    });
    const tick = document.createElement("span");
    tick.textContent = month !== lastMonth ? month : "";
    months.appendChild(tick);
    lastMonth = month;
  }
  body.appendChild(grid);
  wrap.append(months, body);

  const legend = $("hm-legend");
  legend.replaceChildren();
  const less = document.createElement("span");
  less.textContent = "less";
  legend.appendChild(less);
  for (let l = 0; l <= 4; l++) {
    const cell = document.createElement("span");
    cell.className = `hm-cell l${l}`;
    legend.appendChild(cell);
  }
  const more = document.createElement("span");
  more.textContent = "more";
  legend.appendChild(more);

  const { firstActive } = siteHistory(site);
  const streak = longestStreak(site, firstActive, todayKey);
  footStat($("hm-streak"), "Longest streak", `${streak} day${streak === 1 ? "" : "s"}`);
}

/* ---- day-of-week pattern ---- */

function renderDow(site: string): void {
  const wrap = $("dow-chart");
  wrap.replaceChildren();
  const hint = $("dow-hint");

  const todayKey = dateKey(Date.now());
  const { total, firstActive } = siteHistory(site);
  if (!firstActive) {
    hint.textContent = "No activity yet.";
    $("dow-avg").replaceChildren();
    return;
  }

  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const sums = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);
  const span = daysBetween(firstActive, todayKey) + 1;
  for (const date of datesBack(span)) {
    const dow = weekday(date);
    sums[dow] = (sums[dow] ?? 0) + dayTotal(days[date], site);
    counts[dow] = (counts[dow] ?? 0) + 1;
  }
  const avgs = sums.map((s, i) => (counts[i]! > 0 ? s / counts[i]! : 0));
  const max = Math.max(...avgs, 1);

  names.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "dow-row";
    const label = document.createElement("span");
    label.className = "dow-label";
    label.textContent = name.slice(0, 3);
    const track = document.createElement("span");
    track.className = "dow-track";
    const bar = document.createElement("span");
    bar.className = "dow-bar";
    bar.style.width = `${(avgs[i]! / max) * 100}%`;
    track.appendChild(bar);
    const val = document.createElement("span");
    val.className = "dow-val";
    val.textContent = avgs[i]! > 0 ? formatDuration(avgs[i]!) : "—";
    row.append(label, track, val);
    wrap.appendChild(row);
  });

  const top = avgs.indexOf(Math.max(...avgs));
  hint.textContent =
    Math.max(...avgs) > 0 ? `Most time on ${names[top]}s, on average.` : "No activity yet.";
  footStat($("dow-avg"), "Daily average", formatDuration(total / span));
}

/* ---- limits ---- */

/** Both the bare domain and its subdomains, which fold into it. */
function originPatterns(domain: string): string[] {
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

/**
 * Ask the browser for access to a site so limit warnings can appear on
 * the page itself. Must be called straight from the user's gesture (the
 * limit form submit), before any await. Denying is fine — warnings for
 * that site fall back to system notifications.
 */
function requestSiteAccess(domain: string): void {
  try {
    void chrome.permissions.request({ origins: originPatterns(domain) }).catch(() => {});
  } catch {
    // Not callable here (no gesture); the notification fallback covers it.
  }
}

function renderLimits(): void {
  const list = $<HTMLUListElement>("limit-list");
  list.replaceChildren();
  for (const [site, minutes] of Object.entries(settings.limits).sort()) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = site;
    const val = document.createElement("span");
    val.className = "limit-val";
    val.textContent = `${minutes} min/day`;
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.title = `Remove limit for ${site}`;
    remove.addEventListener("click", async () => {
      const s = await getSettings();
      delete s.limits[site];
      await setSettings(s);
    });
    li.append(name, val, remove);
    list.appendChild(li);
  }
}

/* ---- export ---- */

function exportRows(): { date: string; site: string; visits: number; seconds: number }[] {
  const rows: { date: string; site: string; visits: number; seconds: number }[] = [];
  for (const date of Object.keys(days).sort()) {
    const rec = days[date];
    if (!rec) continue;
    for (const site of Object.keys(rec).sort()) {
      const s = rec[site]!;
      rows.push({ date, site, visits: s.sessions, seconds: Math.round(s.totalMs / 1000) });
    }
  }
  return rows;
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---- wiring ---- */

function rangeLabel(): string {
  return range === 1 ? "today" : `last ${range} days`;
}

function setRange(n: number): void {
  range = n;
  $("range-1").classList.toggle("active", n === 1);
  $("range-7").classList.toggle("active", n === 7);
  $("range-30").classList.toggle("active", n === 30);
  // A one-day range would chart a single bar; show the table only.
  $("chart-section").hidden = n === 1;
  renderSummary();
  $("chart-title").textContent = `Time per day — ${rangeLabel()}`;
  $("table-title").textContent = `Sites — ${rangeLabel()}`;
  renderChart($("chart"), datesBack(n));
  renderTable();
}

async function main(): Promise<void> {
  days = await getAllDays();
  settings = await getSettings();

  $("today-label").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  setRange(7);
  renderLimits();

  $("range-1").addEventListener("click", () => setRange(1));
  $("range-7").addEventListener("click", () => setRange(7));
  $("range-30").addEventListener("click", () => setRange(30));
  $("back").addEventListener("click", showOverview);

  $("pin-site").addEventListener("click", () => {
    if (selectedSite) void togglePin(selectedSite);
  });

  $<HTMLFormElement>("site-limit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedSite) return;
    const input = $<HTMLInputElement>("site-limit-minutes");
    const minutes = Number(input.value);
    if (!Number.isFinite(minutes) || minutes < 1) return;
    requestSiteAccess(selectedSite);
    const s = await getSettings();
    s.limits[selectedSite] = Math.round(minutes);
    await setSettings(s);
    input.value = "";
  });

  $("site-limit-remove").addEventListener("click", async () => {
    if (!selectedSite) return;
    const s = await getSettings();
    delete s.limits[selectedSite];
    await setSettings(s);
  });

  $<HTMLFormElement>("limit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const site = domainFromInput($<HTMLInputElement>("limit-site").value);
    const minutes = Number($<HTMLInputElement>("limit-minutes").value);
    if (!site || !Number.isFinite(minutes) || minutes < 1) return;
    requestSiteAccess(site);
    const s = await getSettings();
    s.limits[site] = Math.round(minutes);
    await setSettings(s);
    $<HTMLInputElement>("limit-site").value = "";
    $<HTMLInputElement>("limit-minutes").value = "";
  });

  $("export-csv").addEventListener("click", () => {
    const rows = exportRows();
    const csv = ["date,site,visits,seconds"]
      .concat(rows.map((r) => `${r.date},${r.site},${r.visits},${r.seconds}`))
      .join("\n");
    download("logbook.csv", csv, "text/csv");
  });

  $("export-json").addEventListener("click", () => {
    download("logbook.json", JSON.stringify(exportRows(), null, 2), "application/json");
  });

  // Live-update: the background worker writes day records as time passes;
  // re-render whatever is on screen when stored data changes.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let daysChanged = false;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(DAY_PREFIX)) continue;
      const date = key.slice(DAY_PREFIX.length);
      if (change.newValue === undefined) delete days[date];
      else days[date] = change.newValue as DayRecord;
      daysChanged = true;
    }
    if (changes[SETTINGS_KEY]) {
      settings = {
        ...defaultSettings(),
        ...(changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined),
      };
      renderLimits();
      renderTable();
      if (selectedSite) showSite(selectedSite);
    }
    if (daysChanged) {
      renderSummary();
      renderChart($("chart"), datesBack(range));
      renderTable();
      if (selectedSite) showSite(selectedSite);
    }
  });
}

void main();
