# Default taste profile — fallback for the daily ranking agent

> Used by `scripts/build.js` when the `TASTE_PROFILE` GitHub Actions secret is unset, empty, or shorter than 200 characters. The real (personal) profile lives in the secret. This file is the safety net so the calendar never drifts into corporate-listings territory.

## Who this is for

A New York / Brooklyn local with a strong bias toward tasteful, curated, slightly offbeat cultural experiences rather than generic "things to do." Likes events that feel designed, atmospheric, specific, and a little subcultural. Prefers scenes with character: intimate jazz bars, experimental art spaces, design-forward restaurants, old New York rooms, good cocktail bars, indie venues, beautiful architecture, and neighborhood-specific cultural pockets.

## Neighborhoods

**High affinity:** Williamsburg, South Williamsburg, Greenpoint, Fort Greene, Carroll Gardens, Cobble Hill, Bed-Stuy, Crown Heights, Red Hook, Bushwick, Dimes Square / downtown Manhattan, East Village, Lower East Side.

**General lens:** explores cities through neighborhoods, restaurants, bars, architecture, bookstores, cafés, music venues, and odd cultural programming. Local over touristy.

## Core event taste

- **Live jazz** — intimate Brooklyn jazz bars, supper-club energy, stage-side seating, dinner plus music. Smalls, Bar Bayeux, Public Records, Smoke, Birdland late sets.
- **Indie / experimental music** — Bowery Ballroom / Mercury Lounge / Pioneer Works / Nowadays / Resident Advisor energy. Curated and scene-aware. Not generic EDM.
- **Smart comedy** — stand-up, alt comedy, improv with a concept, bookish shows, Caveat-style programming, podcast tapings, anything with a sharp creative crowd.
- **Design / art / architecture** — Art Deco, Art Nouveau, Gilded Age, Jazz Age, old New York, historic buildings, museum openings, design talks, gallery events, visual culture. Pioneer Works, New Museum, Brooklyn Museum after-hours, Whitney late, Hauser & Wirth, gallery openings on the LES.
- **Latin nightlife** (when authentic) — reggaeton, perreo, Latin dance energy. Mission / CDMX / Medellín-type rooms. Not bottle-service Latin night.
- **Talks & cultural programming** — AI, design, architecture, cities, science fiction, technology, creativity, art, film, cultural criticism. Caveat, Pioneer Works, New York Public Library.
- **Atmospheric restaurants & bars** — beautiful rooms, old-world New York, Art Deco, Gilded Age, Prohibition / Jazz Age, good lighting, strong cocktails, intimate energy. Lilia, Four Horsemen, Oxalis, Long Island Bar, Attaboy.

## Food & drink

Atmospheric and specific. Good design, neighborhood energy, sense of scene. Classic cocktails — Negronis, Boulevardiers, Manhattans, modern variations that aren't too sweet. Warm, stylish, slightly hidden, intimate rooms. Old New York / Art Deco / jazz bar / supper club / speakeasy / design-forward neighborhood spots.

## High-fit signals (boost)

`intimate` · `jazz` · `supper club` · `listening room` · `Pioneer Works` · `Caveat` · `Resident Advisor` · `Bowery Ballroom` · `Mercury Lounge` · `Nowadays` · `Public Records` · `Bar Bayeux` · `Art Deco` · `architecture tour` · `design talk` · `gallery opening` · `book launch` · `alt comedy` · `improv` · `Latin jazz` · `reggaeton` · `perreo` · `old New York` · `speakeasy` · `cocktail` · `immersive theater` · `historic building` · `experimental music` · `film noir` · `Gilded Age` · `Jazz Age` · `loft show` · `warehouse party with a real lineup`

## Low-fit signals (demote or drop)

- **Sponsored / paid placements** — anything that's promoted content rather than an editorial pick. Drop.
- **Arena / stadium / amphitheater shows** — Barclays, MSG, UBS Arena, Citi Field, Forest Hills, Radio City, Beacon. 19,000-cap arenas are the opposite of Joonas's "intimate Brooklyn room" lane. Mainstream stadium tours (Springsteen, Taylor, etc.) — drop.
- **Big productions / commercial spectacles** — Cirque-du-Soleil-style theatrical productions, Broadway-style spectacles, "the experience" pop-ups, "themed immersive" tourist productions (Sleep No More is fine — that's the rare exception; Wolf-of-Wall-Street-meets-Cirque-du-Soleil corporate satire circus is not). When in doubt: if it markets itself as "an experience" or "75 minutes of [theme]", it's a tourist production — drop.
- **"Business"-themed corporate-satire variety shows** specifically — drop, even when sponsored heavily by local newsletters.
- Generic networking events.
- Corporate panels with bland speakers.
- Tourist-trap comedy clubs (unless a specific, strong lineup).
- Bottle-service nightlife.
- Generic EDM clubs without a real scene.
- Overly polished influencer pop-ups.
- Family-friendly mass-market festivals (unless strong design / food / music angle).
- "Annual neighborhood street festival" type listings with no specific cultural draw.
- Anything that reads like algorithmic "fun things to do this weekend" filler — Vintage Clothing Shows, generic Greek/Ukrainian/Italian street fairs, college thesis showcases, etc.

## Ranking logic

Prioritize events that combine at least two of: strong atmosphere, interesting venue, cultural specificity, music/comedy/art/design, good neighborhood, date-night potential, sense of discovery. Best recs should feel like something a tasteful local friend would text — not something scraped from a generic event calendar.

If the input items are mostly generic listings, return very few events rather than padding the calendar with weak picks.

## Recommendation tone

Concise, opinionated, specific. One sentence on why it fits. No generic hype. Language like:

- "This feels very you because…"
- "Strong date-night pick."
- "Worth it for the room alone."
- "Probably too generic unless the lineup is great."
- "This has the right kind of weird."
- "Good if you want a real neighborhood night, not a big production."
