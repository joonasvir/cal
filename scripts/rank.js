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
ranked calendar for the next 30 days. The default mode is INCLUSIVE — when
in doubt, include with a best-effort date. The user wants a calendar full
of options, not a sparse one with only ironclad listings.

For each thing you extract, return:
- title, time, venue, neighborhood, URL
- category from: music, comedy, art, food, talk, nightlife
- indoor (true) or outdoor (false)
- a one-sentence note in Joonas's voice on why it fits — specific, opinionated, no hype
- pass through the source item's image URL when present; empty string if none — don't invent

# What counts as an "event" (broad)

Include all of these:

1. **Hard-dated events** — concerts, shows, openings, lineups with a specific date.
2. **Restaurant openings** — the opening day IS the date. "Sono opens May 16" → an event on 2026-05-16.
   Add a follow-up entry on a Friday or Saturday in the next 14 days as a
   "go this week" entry, picking the day that fits Joonas's pattern.
3. **Limited-run / closing-soon** — exhibitions, plays, residencies with a closing
   weekend. Put the event on the final Friday/Saturday.
4. **Pop-ups, festivals, block parties, fairs** — anchor to start date; if multi-day,
   create one entry per day it runs (max 3 days).
5. **Gallery openings & shows** — opening reception date if mentioned, else first
   Saturday after the article. Long-running shows → place on a single date in the
   next 2 weeks with a "while it's up" framing.
6. **Talks, readings, book launches** — extract date from the article.

# What to drop

Only drop items that have NO date semantics whatsoever AND no opening or
limited-run framing — e.g. a "best of all time" ranked list, a profile of a
long-running place, a general scene piece. If a piece even hints at "this
week", "now showing", "this month", treat it as a soft-dated event and pick
a sensible weekend day in the next 14 days.

# Ranking rules

**Taste fit is the gate, not volume.** A great day has 3–6 on-taste events. Don't pad days to hit a number — if there's nothing on-taste left, stop.

Hard EXCLUDES (do not include even if dated and popular):

- **Arena / stadium / amphitheater shows**: Barclays Center, Madison Square Garden, UBS Arena, Citi Field, Forest Hills Stadium, Radio City. Joonas's lane is 500-cap rooms (Bowery, Mercury, Smalls, Public Records, Nowadays, Knockdown, Caveat, BCC), not 19,000-cap arenas. Bruce Springsteen, Taylor Swift, mainstream stadium tours = drop.
- **Tourist comedy clubs** without a specific premise or known alt comedian booked.
- **Bottle-service nightlife**, generic EDM clubs, "rooftop sunset vibes" pop-ups.
- **Corporate / Tribeca-Film-Festival-style panels** with bland speakers, brand activations, influencer events.
- **Mass-market street fairs** (Smorgasburg, Brooklyn Flea, generic vendor markets, anything called a "block party" without specific cultural programming).
- **"Best of all time" ranked lists, restaurant rankings, general scene profiles** — these aren't events.

Soft demotes (include only if no stronger option for that day):
- Multi-day events repeated 3 days in a row. Cap any one show at 2 days max in the visible feed.
- Generic gallery openings without a known artist or strong space.

Ordering:

- Within each day, order events BY FIT — strongest pick first. The first event is the night Joonas would actually choose. Events 3+ are still on-taste secondary picks (an additional jazz set, a gallery opening, a late show, a different neighborhood option).
- Target 3–6 events per day. Fewer is fine. **Do not exceed 8 per day** — that's a sign of padding.
- Aggregate articles often reference multiple events — split them out, one event per object.
- Recurring weekly residencies at strong venues (Smalls late sets, Bar Bayeux trio nights, Public Records vermouth bar, Nowadays Friday Resident, Sunny's bluegrass) are valid even if not explicitly listed — surface them on the appropriate weekday with the standard slot.

# Output rules

- Group events by date (YYYY-MM-DD), only for dates in the next 30 days.
- 24h time format. Empty string if unknown.
- Prefer the venue's event page URL over the news article when both are
  available.
- Tone: opinionated, specific, conversational. Like a tasteful local
  friend texting Joonas. Phrasings like "This feels very you because…",
  "Strong date-night pick.", "Worth it for the room alone.",
  "Probably too generic unless the lineup is great.", "Has the right
  kind of weird."
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

  const system = [
    {
      type: "text",
      text: `# Taste profile\n\n${tasteMd}\n\n${SYSTEM_INSTRUCTIONS}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  const userMessage = `Today is ${todayKey}. Below are ${items.length} raw items pulled from NYC RSS feeds in the last few weeks. Extract dated events for the next 30 days, rank them by fit, write notes in Joonas's voice, and return JSON matching the schema.\n\nItems:\n\n${JSON.stringify(items, null, 2)}`;

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
