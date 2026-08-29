import { domainFromInput } from "../lib/domain";
import { formatDuration } from "../lib/format";
import {
  dateKey,
  getAllDays,
  getSettings,
  setSettings,
  purgeDomain,
  DAY_PREFIX,
  SETTINGS_KEY,
  type DayRecord,
} from "../lib/storage";

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let days: Record<string, DayRecord> = {};
let range = 7;
let selectedSite: string | null = null;

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

/* ---- sites table ---- */

function renderTable(): void {
  const dates = datesBack(range);
  const agg = aggregate(dates);
  const rows = Object.entries(agg)
    .filter(([, s]) => s.totalMs > 0 || s.sessions > 0)
    .sort(([, a], [, b]) => b.totalMs - a.totalMs);
  const maxTotal = rows.length ? rows[0]![1].totalMs : 1;

  const body = $<HTMLTableSectionElement>("sites-body");
  body.replaceChildren();
  $("sites-table").hidden = rows.length === 0;
  $("empty").hidden = rows.length > 0;

  for (const [site, s] of rows) {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");

    const siteTd = document.createElement("td");
    siteTd.className = "site";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = site;
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
    tr.append(siteTd, mk(String(s.sessions)), mk(formatDuration(s.totalMs)), mk(formatDuration(avg)));

    const open = () => showSite(site);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") open();
    });
    body.appendChild(tr);
  }
}

/* ---- per-site drill-down ---- */

function showSite(site: string): void {
  selectedSite = site;
  $("overview").hidden = true;
  $("site-view").hidden = false;
  $("site-name").textContent = site;

  const dates = datesBack(range);
  const agg = aggregate(dates)[site] ?? { totalMs: 0, sessions: 0 };
  const avg = agg.sessions > 0 ? agg.totalMs / agg.sessions : 0;
  const label = range === 1 ? "Today" : `Last ${range} days`;
  $("site-stats").textContent =
    `${label}: ${formatDuration(agg.totalMs)} across ` +
    `${agg.sessions} visit${agg.sessions === 1 ? "" : "s"} — ` +
    `${formatDuration(avg)} per visit on average.`;
  $("site-chart").hidden = range === 1;
  renderChart($("site-chart"), dates, site);
}

function showOverview(): void {
  selectedSite = null;
  $("site-view").hidden = true;
  $("overview").hidden = false;
}

/* ---- limits ---- */

async function renderLimits(): Promise<void> {
  const settings = await getSettings();
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
      await renderLimits();
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
  if (selectedSite) showSite(selectedSite);
}

async function main(): Promise<void> {
  days = await getAllDays();

  $("today-label").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  setRange(7);
  await renderLimits();

  $("range-1").addEventListener("click", () => setRange(1));
  $("range-7").addEventListener("click", () => setRange(7));
  $("range-30").addEventListener("click", () => setRange(30));
  $("back").addEventListener("click", showOverview);

  $<HTMLFormElement>("limit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const site = domainFromInput($<HTMLInputElement>("limit-site").value);
    const minutes = Number($<HTMLInputElement>("limit-minutes").value);
    if (!site || !Number.isFinite(minutes) || minutes < 1) return;
    const s = await getSettings();
    s.limits[site] = Math.round(minutes);
    await setSettings(s);
    $<HTMLInputElement>("limit-site").value = "";
    $<HTMLInputElement>("limit-minutes").value = "";
    await renderLimits();
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
    if (daysChanged) {
      renderSummary();
      renderChart($("chart"), datesBack(range));
      renderTable();
      if (selectedSite) showSite(selectedSite);
    }
    if (changes[SETTINGS_KEY]) void renderLimits();
  });
}

void main();
