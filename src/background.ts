import { domainFromUrl } from "./lib/domain";
import { formatDuration } from "./lib/format";
import {
  getSettings,
  getState,
  setState,
  getDay,
  setDay,
  dateKey,
  nextMidnight,
  pruneOldDays,
  type TrackerState,
} from "./lib/storage";

const IDLE_SECONDS = 120; // 2 minutes of no input = idle
const SESSION_GAP_MS = 5 * 60 * 1000; // >5 min away = new session
// If more time than this passed since the last tick (worker asleep, laptop
// suspended), we were blind — credit at most this much. Chrome can delay the
// 30s heartbeat alarm, so leave generous headroom above it.
const MAX_BLIND_CREDIT_MS = 150_000;

chrome.idle.setDetectionInterval(IDLE_SECONDS);

chrome.runtime.onInstalled.addListener(() => void init());
chrome.runtime.onStartup.addListener(() => void init());

async function init(): Promise<void> {
  await chrome.alarms.create("heartbeat", { periodInMinutes: 0.5 });
  await pruneOldDays(Date.now());
  queueTick();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "heartbeat") queueTick();
});
chrome.tabs.onActivated.addListener(() => queueTick());
chrome.tabs.onUpdated.addListener((_id, changeInfo, tab) => {
  if (tab.active && (changeInfo.url !== undefined || changeInfo.audible !== undefined)) {
    queueTick();
  }
});
chrome.windows.onFocusChanged.addListener(() => queueTick());
chrome.idle.onStateChanged.addListener(() => queueTick());

// Serialize ticks so concurrent events cannot race on storage.
let chain: Promise<void> = Promise.resolve();
function queueTick(): void {
  chain = chain.then(tick).catch((e) => console.error("tick failed", e));
}

/**
 * Core loop. Credits time since the last tick to the domain that was being
 * attended, then records which domain (if any) has attention now.
 * Attention = active tab in a focused window, and the user is not idle
 * (sound playing in the active tab overrides idle).
 */
async function tick(): Promise<void> {
  const now = Date.now();
  const state = await getState();
  const eligible = await getEligibleDomain();

  if (state.currentDomain && state.lastTick > 0 && now > state.lastTick) {
    const elapsed = Math.min(now - state.lastTick, MAX_BLIND_CREDIT_MS);
    await credit(state.currentDomain, now - elapsed, now);
    state.lastSeen[state.currentDomain] = now;
  }

  if (eligible !== state.currentDomain && eligible) {
    const last = state.lastSeen[eligible] ?? 0;
    if (now - last > SESSION_GAP_MS) await bumpSessions(eligible, now);
  }
  state.currentDomain = eligible;
  if (eligible) state.lastSeen[eligible] = now;
  state.lastTick = now;

  pruneLastSeen(state, now);
  await setState(state);
  await checkLimits(now);
}

/* ---- Daily limits: notify at 80% and at 100%, once per site per day. ---- */

const NOTICES_KEY = "limitNotices";

interface LimitNotices {
  date: string;
  fired: Record<string, { warn?: boolean; limit?: boolean }>;
}

async function checkLimits(now: number): Promise<void> {
  const settings = await getSettings();
  const limited = Object.keys(settings.limits);
  if (limited.length === 0) return;

  const today = dateKey(now);
  const res = await chrome.storage.local.get(NOTICES_KEY);
  let notices = res[NOTICES_KEY] as LimitNotices | undefined;
  if (!notices || notices.date !== today) notices = { date: today, fired: {} };

  const day = await getDay(now);
  let changed = false;

  for (const domain of limited) {
    const limitMs = (settings.limits[domain] ?? 0) * 60_000;
    if (limitMs <= 0) continue;
    const used = day[domain]?.totalMs ?? 0;
    const fired = notices.fired[domain] ?? (notices.fired[domain] = {});

    if (!fired.limit && used >= limitMs) {
      fired.limit = true;
      fired.warn = true;
      changed = true;
      notify(
        `limit-${domain}-${now}`,
        `Time limit reached: ${domain}`,
        `You have spent ${formatDuration(used)} today. Your limit is ${formatDuration(limitMs)}.`,
      );
    } else if (!fired.warn && used >= limitMs * 0.8) {
      fired.warn = true;
      changed = true;
      notify(
        `warn-${domain}-${now}`,
        `Close to your limit: ${domain}`,
        `${formatDuration(used)} of ${formatDuration(limitMs)} used today.`,
      );
    }
  }

  if (changed) await chrome.storage.local.set({ [NOTICES_KEY]: notices });
}

function notify(id: string, title: string, message: string): void {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

async function getEligibleDomain(): Promise<string | null> {
  const win = await chrome.windows
    .getLastFocused({ windowTypes: ["normal"] })
    .catch(() => null);
  if (!win || !win.focused || win.id === undefined) return null;

  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab?.url) return null;

  const domain = domainFromUrl(tab.url);
  if (!domain) return null;

  const settings = await getSettings();
  if (settings.ignore.includes(domain)) return null;

  const idleState = await chrome.idle.queryState(IDLE_SECONDS);
  if (idleState !== "active" && !tab.audible) return null;

  return domain;
}

/** Credit [from, to] to a domain, splitting at local midnight. */
async function credit(domain: string, from: number, to: number): Promise<void> {
  let start = from;
  while (start < to) {
    const boundary = Math.min(nextMidnight(start), to);
    const day = await getDay(start);
    const entry = day[domain] ?? { totalMs: 0, sessions: 0 };
    entry.totalMs += boundary - start;
    day[domain] = entry;
    await setDay(start, day);
    start = boundary;
  }
}

async function bumpSessions(domain: string, now: number): Promise<void> {
  const day = await getDay(now);
  const entry = day[domain] ?? { totalMs: 0, sessions: 0 };
  entry.sessions += 1;
  day[domain] = entry;
  await setDay(now, day);
}

/** Keep the lastSeen map from growing forever. */
function pruneLastSeen(state: TrackerState, now: number): void {
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const [domain, seen] of Object.entries(state.lastSeen)) {
    if (seen < cutoff) delete state.lastSeen[domain];
  }
}
