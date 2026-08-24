// Small list of common two-part public suffixes so "bbc.co.uk" folds to
// "bbc.co.uk" and not "co.uk". Not exhaustive; good enough for v1.
const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.in", "net.in", "org.in",
  "co.jp", "ne.jp", "or.jp",
  "co.kr", "co.nz", "co.za",
  "com.br", "com.mx", "com.sg", "com.tr", "com.cn",
]);

/**
 * Extract the tracked domain from a URL. Subdomains fold into the main
 * domain (music.youtube.com -> youtube.com). Returns null for URLs we do
 * not track (chrome://, file://, extension pages, etc.).
 */
export function domainFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return foldHostname(u.hostname);
}

export function foldHostname(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  if (!host.includes(".")) return host; // e.g. localhost
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host; // raw IPv4
  const parts = host.split(".");
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_PART_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/** Normalize free-text user input ("https://www.YouTube.com/x") to a domain. */
export function domainFromInput(input: string): string | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  const asUrl = domainFromUrl(t.includes("://") ? t : `https://${t}`);
  return asUrl;
}
