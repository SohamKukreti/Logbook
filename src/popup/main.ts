import { domainFromInput } from "../lib/domain";
import { formatDuration } from "../lib/format";
import {
  displayName,
  getDay,
  getSettings,
  setSettings,
  purgeDomain,
  type DayRecord,
} from "../lib/storage";

const statsBody = document.getElementById("stats-body") as HTMLTableSectionElement;
const statsTable = document.getElementById("stats") as HTMLTableElement;
const emptyMsg = document.getElementById("empty") as HTMLParagraphElement;
const todayLabel = document.getElementById("today-label") as HTMLSpanElement;
const ignoreForm = document.getElementById("ignore-form") as HTMLFormElement;
const ignoreInput = document.getElementById("ignore-input") as HTMLInputElement;
const ignoreList = document.getElementById("ignore-list") as HTMLUListElement;

const MAX_ROWS = 10;

function renderStats(day: DayRecord): void {
  const rows = Object.entries(day)
    .filter(([, s]) => s.totalMs > 0 || s.sessions > 0)
    .sort(([, a], [, b]) => b.totalMs - a.totalMs);

  statsBody.replaceChildren();
  statsTable.hidden = rows.length === 0;
  emptyMsg.hidden = rows.length > 0;

  const hidden = rows.length - MAX_ROWS;

  for (const [domain, s] of rows.slice(0, MAX_ROWS)) {
    const tr = document.createElement("tr");
    const avg = s.sessions > 0 ? s.totalMs / s.sessions : 0;

    const siteTd = document.createElement("td");
    siteTd.className = "site";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = displayName(domain);
    name.title = displayName(domain);
    siteTd.appendChild(name);

    const visitsTd = document.createElement("td");
    visitsTd.className = "num";
    visitsTd.textContent = String(s.sessions);

    const totalTd = document.createElement("td");
    totalTd.className = "num";
    totalTd.textContent = formatDuration(s.totalMs);

    const avgTd = document.createElement("td");
    avgTd.className = "num";
    avgTd.textContent = formatDuration(avg);

    tr.append(siteTd, visitsTd, totalTd, avgTd);
    statsBody.appendChild(tr);
  }

  if (hidden > 0) {
    const tr = document.createElement("tr");
    tr.className = "more-row";
    const td = document.createElement("td");
    td.colSpan = 4;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "more-link";
    btn.textContent = `+ ${hidden} more in dashboard →`;
    btn.addEventListener("click", openDashboard);
    td.appendChild(btn);
    tr.appendChild(td);
    statsBody.appendChild(tr);
  }
}

function openDashboard(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
}


async function renderIgnoreList(): Promise<void> {
  const settings = await getSettings();
  ignoreList.replaceChildren();
  for (const domain of settings.ignore) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = domain;
    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.title = `Stop ignoring ${domain}`;
    btn.addEventListener("click", () => void removeIgnore(domain));
    li.append(span, btn);
    ignoreList.appendChild(li);
  }
}

async function addIgnore(raw: string): Promise<void> {
  const domain = domainFromInput(raw);
  if (!domain) return;
  const settings = await getSettings();
  if (!settings.ignore.includes(domain)) {
    settings.ignore.push(domain);
    settings.ignore.sort();
    await setSettings(settings);
    await purgeDomain(domain);
  }
  ignoreInput.value = "";
  await refresh();
}

async function removeIgnore(domain: string): Promise<void> {
  const settings = await getSettings();
  settings.ignore = settings.ignore.filter((d) => d !== domain);
  await setSettings(settings);
  await refresh();
}

async function refresh(): Promise<void> {
  renderStats(await getDay(Date.now()));
  await renderIgnoreList();
}

document.getElementById("open-dashboard")!.addEventListener("click", openDashboard);

ignoreForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void addIgnore(ignoreInput.value);
});

todayLabel.textContent = new Date().toLocaleDateString(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

void refresh();
// Live-update while the popup stays open.
setInterval(() => void refresh(), 5000);
