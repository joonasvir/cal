// Send raw RSS items + weather + taste profile to Claude.
// Returns a feed.json-shaped object: { days: { "YYYY-MM-DD": { weather, events } } }
//
// Uses claude-opus-4-7 with adaptive thinking and structured outputs (json_schema).
// Streams so we can safely run with high max_tokens.

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";
import path from "node:path";

const MODEL = "claude-opus-4-7";

const FEED_SCHEMA = {
  type: "object",
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                time: { type: "string", description: "24h HH:MM, e.g. '20:30'. Empty string if unknown." },
                title: { type: "string" },
                venue: { type: "string" },
                neighborhood: { type: "string" },
                category: {
                  type: "string",
                  enum: ["music", "comedy", "art", "food", "talk", "nightlife"],
                },
                url: { type: "string" },
                note: {
                  type: "string",
                  description: "One sentence in Joonas's voice on why this fits. Opinionated, specific, no generic hype.",
                },
                indoor: { type: "boolean" },
                image: {
                  type: "string",
                  description: "Featured image URL for hover preview. Pass through the source item's image when it has one; empty string otherwise.",
                },
              },
              required: ["time", "title", "venue", "neighborhood", "category", "url", "note", "indoor", "image"],
              additionalProperties: false,
            },
          },
        },
        required: ["date", "events"],
        additionalProperties: false,
      },
    },
  },
  required: ["days"],
  additionalProperties: false,
};

const SYSTEM_INSTRUCTIONS = `
# Your task

You are a personal curator. Read the raw items below and produce a dense
ranked calendar covering exactly the **next 7 days** (today and the 6 days
after). The user wants a real menu of options for THIS WEEK — not a sparse
list and not a long-tail of dates a month out.

**Target: ~10 on-taste events per day for each of those 7 days.** Lean
generously toward including soft-dated and recurring-residency entries to
reach that. But taste fit is still the gate — see "Hard EXCLUDES" below.
If a day truly has fewer than 10 on-taste options after applying every
inclusion rule, return what you have. Do not pad with low-fit content.

For each event, return:
- title, time, venue, neighborhood, URL
- category from: music, comedy, art, food, talk, nightlife
- indoor (true) or outdoor (false)
- a one-sentence note in Joonas's voice on why it fits — specific, opinionated, no hype
- pass through the source item's image URL when present; empty string if none — don't invent

# What counts as an "event" (broad — be inclusive to hit ~10/day)

1. **Hard-dated events** — concerts, shows, openings, lineups with a specific date in the 7-day window.
2. **Restaurant openings** — the opening day IS the date. Add a follow-up "go this week" entry on a sensible day in the 7-day window.
3. **Limited-run / closing-soon** — exhibitions, plays, residencies. Put on the closing Friday/Saturday if it falls in the window.
4. **Pop-ups, festivals, block parties, fairs** — one entry per day it runs (max 2 days, see Soft demotes).
5. **Gallery openings & shows currently up** — opening reception date if in window, else a single Saturday or weekday-evening entry in the window framed as "while it's up".
6. **Talks, readings, book launches** — extract date.
7. **Recurring weekly residencies** at strong venues, surfaced on the right weekday in the 7-day window:
   - Smalls late set — every night
   - Bar Bayeux jazz trio — Fri/Sat
   - Public Records vermouth bar / Friday Resident — Thu–Sat
   - Nowadays Friday Resident — Fri night
   - Sunny's bluegrass — Sat
   - Bossa Nova Civic Club — Fri/Sat late
   - Mood Ring — Thu/Fri/Sat
   - Bemelmans Bar — every night (piano)
   - Caveat — pick the night's strongest show
   - BCC — alt comedy weekends
   These count toward the ~10/day target.

# What to drop

Items with no date in or near the 7-day window AND no opening / closing /
soft-date framing. Anything that's just a general "best of" list or a
profile of a permanent place — drop.

# Ranking rules

**Taste fit is the gate, not volume.** Pad ONLY with on-taste options.

Hard EXCLUDES (do not include even if dated and popular):

- **Arena / stadium / amphitheater shows**: Barclays Center, Madison Square Garden, UBS Arena, Citi Field, Forest Hills Stadium, Radio City, Beacon Theatre. Joonas's lane is 500-cap rooms (Bowery, Mercury, Smalls, Public Records, Nowadays, Knockdown, Caveat, BCC), not 19,000-cap arenas. Bruce Springsteen, Taylor Swift, mainstream stadium tours = drop.
- **Big productions / commercial spectacles** — Cirque-style theatrical productions, Broadway-style spectacles, "the experience" pop-ups, Wolf-of-Wall-Street-meets-Cirque-du-Soleil corporate satire circuses, anything marketed as "75 minutes of [theme]" — drop. (Sleep No More is the rare exception; modern equivalents are usually not.)
- **Sponsored / paid placements** — anything that's promoted content rather than an editorial pick. The sources also filter these out programmatically, but if any slip through, drop them.
- **"Business"-themed corporate-satire variety shows** — drop, every date, every venue.
- **Tourist comedy clubs** without a specific premise or known alt comedian booked.
- **Bottle-service nightlife**, generic EDM clubs, "rooftop sunset vibes" pop-ups.
- **Corporate / Tribeca-Film-Festival-style panels** with bland speakers, brand activations, influencer events.
- **Mass-market street fairs** (Smorgasburg, Brooklyn Flea, generic vendor markets, anything called a "block party" without specific cultural programming).
- **"Best of all time" ranked lists, restaurant rankings, general scene profiles** — these aren't events.

Soft demotes (include only if no stronger option for that day):
- Multi-day events: cap any one show at 2 days max in the visible feed (not 7 days of the same circus).
- Generic gallery openings without a known artist or strong space.

Ordering:

- Within each day, order events BY FIT — strongest pick first. The first event is the night Joonas would actually choose. Events 3+ are still on-taste secondary picks (jazz late set, gallery opening, alt comedy, a parallel neighborhood option).
- Aggregate articles often reference multiple events — split them out, one event per object.

# Output rules

- Group events by date (YYYY-MM-DD). **Only emit dates inside the 7-day window** (today and the 6 days after). Older or further-out dates: drop.
- 24h time format. Empty string if unknown.
- Prefer the venue's event page URL over the news article when both are available.
- Tone: opinionated, specific, conversational. Like a tasteful local friend texting Joonas. Phrasings like "This feels very you because…", "Strong date-night pick.", "Worth it for the room alone.", "Probably too generic unless the lineup is great.", "Has the right kind of weird."
`.trim();

/**
 * @param {object} args
 * @param {string} args.tasteMd      Contents of taste.md
 * @param {Array}  args.items        Normalized RSS items
 * @param {string} args.todayKey     YYYY-MM-DD
 * @returns {Promise<{days: Array}>}
 */
export async function rankItems({ tasteMd, items, todayKey }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const client = new Anthropic();

  // The taste profile is the source of truth — system instructions support
  // it, never override it. Anything in the "Low-fit signals" / "drop" /
  // "avoid" lists of the profile is treated as a HARD EXCLUDE, not a soft
  // demote. The note below is reinforced inside SYSTEM_INSTRUCTIONS too.
  const system = [
    {
      type: "text",
      text:
        `# Taste profile (authoritative — drop anything that violates it)\n\n${tasteMd}\n\n` +
        `# Critical: how to read the taste profile\n\n` +
        `Treat any item listed under "Low-fit signals", "avoid", or "drop" in the taste profile above as a HARD EXCLUDE. Do not include such items even if they are dated, popular, sponsored, or appear in many source items. The profile is more important than volume. If the only events available for a day are low-fit, return zero events for that day. Specifically, when the profile names a category of show (e.g. "'Business'-themed corporate-satire variety shows — drop"), exclude every instance, every date, every venue. Do not paraphrase your way around the exclusion.\n\n` +
        `${SYSTEM_INSTRUCTIONS}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  // Compute the explicit 7-day window so the model can't drift.
  const t0 = new Date(todayKey + "T00:00:00Z");
  const windowDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(t0); d.setUTCDate(t0.getUTCDate() + i);
    windowDates.push(d.toISOString().slice(0, 10));
  }
  const userMessage =
    `Today is ${todayKey}. Build the calendar for these 7 dates ONLY:\n` +
    `${windowDates.join(", ")}\n\n` +
    `Target ~10 on-taste events per date. Surface recurring residencies, ` +
    `restaurant openings (with a follow-up "go this week" entry), and ` +
    `currently-on gallery shows alongside hard-dated picks. Drop anything ` +
    `that lands outside these 7 dates.\n\n` +
    `Below are ${items.length} raw items pulled from NYC RSS feeds in the ` +
    `last few weeks (sponsored placements already filtered out at the ` +
    `source). Rank them by fit, write notes in Joonas's voice, and return ` +
    `JSON matching the schema.\n\nItems:\n\n${JSON.stringify(items, null, 2)}`;

  console.error(`  → rank: ${items.length} items, model=${MODEL}, streaming…`);

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: FEED_SCHEMA },
    },
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const finalMessage = await stream.finalMessage();

  const textBlock = finalMessage.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("rank: no text block in response");

  const parsed = JSON.parse(textBlock.text);

  const usage = finalMessage.usage;
  console.error(
    `  ← rank: ${parsed.days?.length ?? 0} days · ` +
      `in=${usage.input_tokens} cache_r=${usage.cache_read_input_tokens ?? 0} ` +
      `cache_w=${usage.cache_creation_input_tokens ?? 0} out=${usage.output_tokens}`,
  );

  return parsed;
}

// CLI: `node scripts/rank.js < items.json` — for ad-hoc testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const tasteMd = await fs.readFile(
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", "taste.md"),
    "utf-8",
  );
  const items = JSON.parse(await fs.readFile(0, "utf-8"));
  const today = new Date().toISOString().slice(0, 10);
  const out = await rankItems({ tasteMd, items, todayKey: today });
  console.log(JSON.stringify(out, null, 2));
}
