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
import { rankItems } from "./rank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FEED_PATH = path.join(ROOT, "feed.json");
const TASTE_PATH = path.join(ROOT, "taste.md");

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

async function main() {
  const today = todayKey();
  console.error(`# build: ${today}`);

  console.error("# 1/3 fetching sources…");
  const [items, weather] = await Promise.all([
    fetchAllFeeds(),
    fetchWeather(),
  ]);
  console.error(`# sources: ${items.length} items, ${Object.keys(weather).length} weather days`);

  if (!items.length) {
    throw new Error("no items pulled — every feed failed; refusing to write empty feed.json");
  }

  console.error("# 2/3 ranking with Claude…");
  const tasteMd = await fs.readFile(TASTE_PATH, "utf-8");
  const ranked = await rankItems({ tasteMd, items, todayKey: today });

  console.error("# 3/3 merging + writing feed.json…");
  const prev = await readPrevFeed();

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

  const feed = {
    edition: nextEdition(prev?.edition),
    year: new Date().getFullYear(),
    generated_at: new Date().toISOString(),
    city: "New York",
    days,
  };

  await fs.writeFile(FEED_PATH, JSON.stringify(feed, null, 2) + "\n", "utf-8");
  const eventCount = Object.values(days).reduce((sum, d) => sum + d.events.length, 0);
  console.error(`# done: ${Object.keys(days).length} days, ${eventCount} events, edition ${feed.edition}`);
}

main().catch((err) => {
  console.error("# build failed:", err.message);
  process.exit(1);
});
