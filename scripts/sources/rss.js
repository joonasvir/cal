// Pull RSS feeds, normalize to a common shape.
// Errors are logged and skipped — one bad feed doesn't kill the build.

import Parser from "rss-parser";

// rss-parser exposes a few image-ish fields by default. We also wire
// `media:thumbnail` and `media:content` so we can grab a featured image
// from feeds that use the Media RSS namespace.
const parser = new Parser({
  timeout: 20_000,
  customFields: {
    item: [
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["media:content",   "mediaContent",   { keepArray: false }],
    ],
  },
});

// Working RSS feeds. Grub Street, Infatuation, Time Out, and e-flux gate their
// feeds (404 to non-browsers); add them via Apify/ScrapingBee in v2 if needed.
export const FEEDS = [
  { name: "Eater NY",         url: "https://ny.eater.com/rss/index.xml",     tags: ["food"] },
  { name: "The Skint",        url: "https://theskint.com/feed/",             tags: ["general"] },
  { name: "Bedford + Bowery", url: "https://bedfordandbowery.com/feed/",     tags: ["general"] },
  { name: "Brooklyn Vegan",   url: "https://www.brooklynvegan.com/feed/",    tags: ["music"] },
  { name: "Hyperallergic",    url: "https://hyperallergic.com/feed/",        tags: ["art"] },
];

const MAX_ITEMS_PER_FEED = 25;
const MAX_AGE_DAYS = 21;

export async function fetchAllFeeds() {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const results = await Promise.allSettled(FEEDS.map(fetchOne));

  const items = [];
  const sources = [];
  for (let i = 0; i < FEEDS.length; i++) {
    const r = results[i];
    const feed = FEEDS[i];
    let kept = 0;
    let error = null;
    if (r.status === "rejected") {
      error = String(r.reason?.message ?? r.reason);
      console.error(`  ✗ ${feed.name}: ${error}`);
    } else {
      for (const item of r.value) {
        const published = item.published_at ? Date.parse(item.published_at) : Date.now();
        if (Number.isFinite(published) && published < cutoff) continue;
        items.push(item);
        kept++;
        if (kept >= MAX_ITEMS_PER_FEED) break;
      }
      console.error(`  ✓ ${feed.name}: ${kept} items`);
    }
    sources.push({
      name: feed.name,
      url: feed.url,
      tags: feed.tags,
      kept,
      error,
      fetched_at: new Date().toISOString(),
    });
  }
  return { items, sources };
}

async function fetchOne(feed) {
  const parsed = await parser.parseURL(feed.url);
  return (parsed.items || []).map((item) => ({
    source: feed.name,
    tags: feed.tags,
    title: cleanText(item.title),
    url: item.link,
    summary: cleanText(item.contentSnippet || item.content || "").slice(0, 600),
    image: extractImage(item),
    published_at: item.isoDate || item.pubDate || null,
  }));
}

function extractImage(item) {
  // Try the common spots in priority order.
  // 1. enclosure.url with an image mime
  if (item.enclosure?.url && /^image\//.test(item.enclosure.type || "image/")) {
    return item.enclosure.url;
  }
  // 2. media:thumbnail / media:content (Media RSS)
  const media = item.mediaThumbnail || item.mediaContent;
  const mediaUrl = media?.$?.url || media?.url;
  if (mediaUrl) return mediaUrl;
  // 3. itunes image
  if (item["itunes:image"]?.href) return item["itunes:image"].href;
  // 4. first <img src="..."> in content
  const html = item["content:encoded"] || item.content || "";
  const m = String(html).match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  if (m) return m[1];
  return null;
}

function cleanText(s) {
  if (!s) return "";
  return s.replace(/\s+/g, " ").replace(/<[^>]+>/g, "").trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchAllFeeds().then(({ items, sources }) => {
    console.error(`\nTotal: ${items.length} items across ${sources.length} sources`);
    console.log(JSON.stringify({ items: items.slice(0, 5), sources }, null, 2));
  });
}
