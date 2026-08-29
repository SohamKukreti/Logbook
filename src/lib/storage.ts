export interface DomainDay {
  totalMs: number;
  sessions: number;
}

/** One day of data: domain -> stats. Stored under key `day:YYYY-MM-DD`. */
export type DayRecord = Record<string, DomainDay>;

export interface TrackerState {
  /** Domain currently being attended, or null. */
  currentDomain: string | null;
  /** Timestamp of the last tick; time is credited between ticks. */
  lastTick: number;
  /** domain -> last time attention was on it (for the 5-minute session gap). */
  lastSeen: Record<string, number>;
}

export interface Settings {
  ignore: string[];
  /** domain -> daily limit in minutes. */
  limits: Record<string, number>;
  /** Domains marked to always stay: never pruned, sorted first. */
  pinned: string[];
}

export const STATE_KEY = "state";
export const SETTINGS_KEY = "settings";
export const DAY_PREFIX = "day:";
export const RETENTION_DAYS = 365;
/** Keep at most this many distinct sites; the rest fold into OTHER_DOMAIN. */
export const MAX_SITES = 200;
/** Pseudo-domain that absorbs pruned sites' time. Parentheses keep it from
    colliding with any real hostname. */
export const OTHER_DOMAIN = "(other)";

export function displayName(domain: string): string {
  return domain === OTHER_DOMAIN ? "everything else" : domain;
}

export function defaultState(): TrackerState {
  return { currentDomain: null, lastTick: 0, lastSeen: {} };
}

export function defaultSettings(): Settings {
  return { ignore: [], limits: {}, pinned: [] };
}

/** Local-time date key, e.g. "2026-08-24". */
export function dateKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function dayStorageKey(ts: number): string {
  return DAY_PREFIX + dateKey(ts);
}

/** Timestamp of the next local midnight after ts. */
export function nextMidnight(ts: number): number {
  const d = new Date(ts);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export async function getState(): Promise<TrackerState> {
  const res = await chrome.storage.local.get(STATE_KEY);
  return (res[STATE_KEY] as TrackerState | undefined) ?? defaultState();
}

export async function setState(state: TrackerState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  // Merge so settings saved by older versions gain new fields.
  return { ...defaultSettings(), ...(res[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getDay(ts: number): Promise<DayRecord> {
  const key = dayStorageKey(ts);
  const res = await chrome.storage.local.get(key);
  return (res[key] as DayRecord | undefined) ?? {};
}

export async function setDay(ts: number, rec: DayRecord): Promise<void> {
  await chrome.storage.local.set({ [dayStorageKey(ts)]: rec });
}

/** All stored days: date key ("YYYY-MM-DD") -> record. */
export async function getAllDays(): Promise<Record<string, DayRecord>> {
  const all = await chrome.storage.local.get(null);
  const out: Record<string, DayRecord> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(DAY_PREFIX)) {
      out[key.slice(DAY_PREFIX.length)] = value as DayRecord;
    }
  }
  return out;
}

/** Delete day records older than RETENTION_DAYS. */
export async function pruneOldDays(now: number): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const cutoff = dateKey(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const stale = Object.keys(all).filter(
    (k) => k.startsWith(DAY_PREFIX) && k.slice(DAY_PREFIX.length) < cutoff,
  );
  if (stale.length) await chrome.storage.local.remove(stale);
}

/**
 * Cap the number of distinct sites at MAX_SITES. Pinned sites always stay;
 * beyond that, the top MAX_SITES by all-time total stay. A dropped site's
 * time and sessions fold into the day's OTHER_DOMAIN bucket, so daily
 * totals stay honest — only the name is forgotten.
 */
export async function pruneSites(pinned: string[]): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const totals: Record<string, number> = {};
  const dayKeys: string[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(DAY_PREFIX)) continue;
    dayKeys.push(key);
    for (const [domain, s] of Object.entries(value as DayRecord)) {
      if (domain === OTHER_DOMAIN) continue;
      totals[domain] = (totals[domain] ?? 0) + s.totalMs;
    }
  }

  const ranked = Object.keys(totals).sort((a, b) => totals[b]! - totals[a]!);
  if (ranked.length <= MAX_SITES) return;
  const keep = new Set(ranked.slice(0, MAX_SITES));
  for (const domain of pinned) keep.add(domain);

  const updates: Record<string, DayRecord> = {};
  for (const key of dayKeys) {
    const rec = all[key] as DayRecord;
    const next: DayRecord = {};
    const other = { ...(rec[OTHER_DOMAIN] ?? { totalMs: 0, sessions: 0 }) };
    let dropped = false;
    for (const [domain, s] of Object.entries(rec)) {
      if (domain === OTHER_DOMAIN) continue;
      if (keep.has(domain)) {
        next[domain] = s;
      } else {
        other.totalMs += s.totalMs;
        other.sessions += s.sessions;
        dropped = true;
      }
    }
    if (!dropped) continue;
    if (other.totalMs > 0 || other.sessions > 0) next[OTHER_DOMAIN] = other;
    updates[key] = next;
  }
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
}

/** Remove a domain's data from every stored day (used when it is ignored). */
export async function purgeDomain(domain: string): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const updates: Record<string, DayRecord> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(DAY_PREFIX)) continue;
    const rec = value as DayRecord;
    if (domain in rec) {
      const { [domain]: _gone, ...rest } = rec;
      updates[key] = rest;
    }
  }
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
}
