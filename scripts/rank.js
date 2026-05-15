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
              },
              required: ["time", "title", "venue", "neighborhood", "category", "url", "note", "indoor"],
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

You are a personal curator. Read the raw event items provided and produce a ranked calendar for the next 30 days.

For each real event you find:
- Extract: title, time, venue, neighborhood, URL.
- Pick a category from: music, comedy, art, food, talk, nightlife.
- Mark indoor (true) or outdoor (false).
- Write a one-sentence note in Joonas's voice on why it fits. Specific, opinionated, no hype.

# Ranking rules

- Within each day, order events BY FIT — strongest pick first. The first event for a day should be the night Joonas would actually choose.
- Drop low-fit items entirely (see "Low-fit signals" in the taste profile).
- Aggregate articles often reference multiple events — split them out, one event per object.
- If an item is an editorial review of a permanent restaurant with no specific date, drop it (the calendar is for dated nights).

# Output rules

- Group events by date (YYYY-MM-DD).
- Omit dates with no good events.
- 24h time format. Empty string if unknown.
- Prefer the venue's event page URL over the news article when both are available.
- Match the recommendation tone exactly: opinionated, specific, conversational. Like a tasteful local friend texting Joonas. Use phrasings like "This feels very you because…", "Strong date-night pick.", "Worth it for the room alone.", "Probably too generic unless the lineup is great.", "Has the right kind of weird."
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
