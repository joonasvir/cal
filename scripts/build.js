// Daily build orchestrator.
//
// 1. Pull RSS items.
// 2. Pull weather (Open-Meteo, next 16 days).
// 3. Send items + taste to Claude → ranked + extracted events.
// 4. Merge with weather, write feed.json.
//
// Designed to be idempotent: re-running on the same day overwrites feed.json
// with fresh content. GitHub Actions commits the diff.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchWeather } from "./weather.js";
import { fetchAllFeeds } from "./sources/rss.js";
import { fetchOgImage } from "./sources/ogimage.js";
import { rankItems } from "./rank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FEED_PATH = path.join(ROOT, "feed.json");
const TASTE_PATH = path.join(ROOT, "taste.md");
const TASTE_DEFAULT_PATH = path.join(ROOT, "taste.default.md");

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function nextEdition(prev) {
  const n = parseInt(prev ?? "0", 10);
  return String(Number.isFinite(n) ? n + 1 : 1).padStart(2, "0");
}

async function readPrevFeed() {
  try {
    return JSON.parse(await fs.readFile(FEED_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function buildPrevImageMap(prev) {
  const map = new Map();
  if (!prev?.days) return map;
  for (const day of Object.values(prev.days)) {
    for (const ev of day.events || []) {
      if (ev.url && ev.image && /^https?:/i.test(ev.image)) {
        map.set(ev.url, ev.image);
      }
    }
  }
  return map;
}

// Enrich each event with a hero image. Priority:
//   1. Already-set ev.image (from RSS pass-through via the ranker).
//   2. Cached value from the previous build's feed.json (saves a fetch).
//   3. og:image / twitter:image scraped from ev.url.
// Anything left empty falls back to picsum on the client.
async function enrichEventsWithImages(events, prevImages, concurrency = 5) {
  const stats = { fromOg: 0, fromRss: 0, fromCache: 0, missing: 0 };
  let i = 0;
  async function worker() {
    while (i < events.length) {
      const ev = events[i++];
      if (ev.image && /^https?:/i.test(ev.image)) { stats.fromRss++; continue; }
      if (ev.url && prevImages.has(ev.url)) {
        ev.image = prevImages.get(ev.url);
        stats.fromCache++;
        continue;
      }
      if (!ev.url) { stats.missing++; continue; }
      const img = await fetchOgImage(ev.url);
      if (img) {
        ev.image = img;
        stats.fromOg++;
      } else {
        ev.image = "";
        stats.missing++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, events.length) }, worker));
  return stats;
}

async function main() {
  const today = todayKey();
  console.error(`# build: ${today}`);

  console.error("# 1/4 fetching sources…");
  const [{ items, sources }, weather] = await Promise.all([
    fetchAllFeeds(),
    fetchWeather(),
  ]);
  console.error(`# sources: ${items.length} items, ${Object.keys(weather).length} weather days`);

  if (!items.length) {
    throw new Error("no items pulled — every feed failed; refusing to write empty feed.json");
  }

  console.error("# 2/4 ranking with Claude…");
  // Resolve the taste profile with a three-step fallback so a missing or
  // truncated secret can never produce off-taste feeds again:
  //   1. TASTE_PROFILE env var (GH Actions secret) — must look substantial.
  //   2. taste.md (gitignored — private local override for ad-hoc dev).
  //   3. taste.default.md (committed — strong fallback so the daily
  //      ranker always has something opinionated to work with).
  const envTaste  = process.env.TASTE_PROFILE?.trim();
  const fileTaste = await fs.readFile(TASTE_PATH, "utf-8").catch(() => null);
  const defaultTaste = await fs.readFile(TASTE_DEFAULT_PATH, "utf-8").catch(() => null);
  let tasteMd, tasteSource;
  if (envTaste && envTaste.length >= 200) {
    tasteMd = envTaste; tasteSource = "TASTE_PROFILE env";
  } else if (fileTaste) {
    tasteMd = fileTaste; tasteSource = "taste.md";
  } else if (defaultTaste) {
    tasteMd = defaultTaste; tasteSource = "taste.default.md";
  }
  if (!tasteMd) {
    throw new Error("No taste profile available anywhere — fix TASTE_PROFILE secret or add taste.default.md");
  }
  console.error(`# taste profile: ${tasteSource} (${tasteMd.length} chars)`);
  if (envTaste && envTaste.length < 200) {
    console.error(`# warn: TASTE_PROFILE env was only ${envTaste.length} chars — IGNORED in favor of ${tasteSource}`);
  }
  const ranked = await rankItems({ tasteMd, items, todayKey: today });

  console.error("# 3/4 enriching events with hero images…");
  const prev = await readPrevFeed();
  const prevImages = buildPrevImageMap(prev);
  const allRankedEvents = (ranked.days ?? []).flatMap((d) => d.events ?? []);
  const imgStats = await enrichEventsWithImages(allRankedEvents, prevImages);
  console.error(
    `# images: ${imgStats.fromOg} og:image · ${imgStats.fromRss} from feed · ` +
      `${imgStats.fromCache} cached · ${imgStats.missing} fallback`,
  );

  console.error("# 4/4 merging + writing feed.json…");

  const days = {};
  // Seed every weather day so we always have a forecast row.
  for (const [date, w] of Object.entries(weather)) {
    days[date] = { weather: w, events: [] };
  }
  // Overlay ranked events.
  for (const day of ranked.days ?? []) {
    if (!day.date) continue;
    if (!days[day.date]) days[day.date] = { weather: null, events: [] };
    days[day.date].events = day.events ?? [];
  }

  const eventCount = Object.values(days).reduce((sum, d) => sum + d.events.length, 0);

  const feed = {
    edition: nextEdition(prev?.edition),
    year: new Date().getFullYear(),
    generated_at: new Date().toISOString(),
    city: "New York",
    meta: {
      sources,
      weather: {
        provider: "Open-Meteo",
        url: "https://open-meteo.com",
        location: "Brooklyn, NYC (40.6782, -73.9442)",
        unit: "C",
        days: Object.keys(weather).length,
      },
      ranker: {
        provider: "Anthropic",
        model: "claude-opus-4-7",
        ranked_days: ranked.days?.length ?? 0,
      },
      stats: {
        items_pulled: items.length,
        events_curated: eventCount,
        days_covered: Object.keys(days).length,
      },
      images: {
        from_og: imgStats.fromOg,
        from_rss: imgStats.fromRss,
        from_cache: imgStats.fromCache,
        missing: imgStats.missing,
      },
    },
    days,
  };

  await fs.writeFile(FEED_PATH, JSON.stringify(feed, null, 2) + "\n", "utf-8");
  console.error(`# done: ${Object.keys(days).length} days, ${eventCount} events, edition ${feed.edition}`);
}

main().catch((err) => {
  console.error("# build failed:", err.message);
  process.exit(1);
});
