// Best-effort hero image extraction for an event URL.
//
// We fetch the URL with a short timeout, read only the head of the
// document, then pull og:image / twitter:image from <meta> tags.
// All failure modes return null so the build can fall back gracefully.

import { URL } from "node:url";

const UA =
  "Mozilla/5.0 (compatible; cal-bot/0.1; +https://github.com/joonasvir/cal)";
const TIMEOUT_MS = 6000;
const MAX_BYTES = 200_000; // 200 KB is plenty to find <head>

export async function fetchOgImage(url) {
  if (!url || !/^https?:/i.test(url)) return null;
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch {
    clearTimeout(timer);
    return null;
  }
  clearTimeout(timer);
  if (!response || !response.ok) return null;
  const ct = response.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml/i.test(ct)) return null;

  // Read at most MAX_BYTES so we don't gulp huge pages.
  let html = "";
  try {
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let bytesRead = 0;
    while (bytesRead < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    try { reader.cancel(); } catch {}
    html += decoder.decode();
  } catch {
    return null;
  }

  return extractImageUrl(html, response.url);
}

export function extractImageUrl(html, baseUrl) {
  // Limit scan to <head> when we can find it.
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, MAX_BYTES);
  const tags = head.match(/<meta\b[^>]*>/gi) || [];
  // 0 = og:image:secure_url, 1 = og:image, 2 = twitter:image*
  const candidates = [null, null, null];
  for (const tag of tags) {
    const propMatch = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
    const contMatch = tag.match(/content\s*=\s*["']([^"']+)["']/i);
    if (!propMatch || !contMatch) continue;
    const prop = propMatch[1].toLowerCase().trim();
    const val = contMatch[1].trim();
    if (!val || /^data:/i.test(val)) continue;
    if (prop === "og:image:secure_url") candidates[0] ||= val;
    else if (prop === "og:image") candidates[1] ||= val;
    else if (prop === "twitter:image" || prop === "twitter:image:src") candidates[2] ||= val;
  }
  const raw = candidates.find(Boolean);
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}
