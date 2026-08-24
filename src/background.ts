import { domainFromUrl } from "./lib/domain";
import {
  getSettings,
  getState,
  setState,
  getDay,
  setDay,
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
