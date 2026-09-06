# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running it

Static site, no build step, no package manager, no test suite. `data/communities.json`
is loaded with `fetch`, so it must be served over HTTP — opening `index.html` as a
`file://` URL fails:

```bash
python3 -m http.server 8899        # then http://127.0.0.1:8899
```

There is nothing to lint or compile. `node --check js/app.js` and
`python3 -c "import json; json.load(open('data/communities.json'))"` are the only
syntax gates worth running before a commit.

## Verifying changes

With no tests, the way to check work is to drive the page in a real browser. If Playwright
and a Chromium build are available, load the page, then assert against the DOM — pin count
vs. listing count, sidebar numbers vs. `.pin text`, popup contents, computed colours and
contrast ratios. Two things that need explicit setup:

- **Tile requests will fail** unless the environment can reach `tiles.stadiamaps.com`.
  Intercept `**://tiles.stadiamaps.com/**` and fulfil with a flat placeholder PNG so
  layout and pin contrast can still be judged. Screenshots taken this way show a blank
  map area — say so rather than implying the basemap was seen.
- **Popups auto-pan.** Opening one shifts the map, so measure the opening view *before*
  hovering anything.

Geocoding services and most third-party sites are typically blocked here. Do not derive
coordinates by interpolating street numbers — ask for them (Google Maps right-click →
copy coordinates) rather than shipping a guessed pin.

## Architecture

`js/app.js` is one IIFE with no modules or framework. `data/communities.json` drives
everything — categories generate the filter chips, legend, and pin colours; no listing
or category is hard-coded in HTML, CSS, or JS. Adding a listing or a category is a JSON
edit alone.

`state` holds `markers` (id → Leaflet marker), `numbers` (id → directory number),
`activeId` (clicked/pinned), `hoverId`, plus the filter set and query. The sidebar and the
map are two views over the same state, kept in sync through `syncActiveStyles()`.

## Invariants worth preserving

These encode decisions that took iteration; changing them silently regresses behaviour.

**Numbering is assigned once over the whole directory.** `assignNumbers()` runs at load
over every listing, sorted by tier (featured first) then alphabetically. Filtering and
searching hide rows — they never renumber. A pin labelled 7 must stay 7 when the sidebar
shows one row. Any change that numbers listings at render time breaks the pin↔list
correspondence.

`sortKey()` strips a leading "The" so "The Cedars" files under C. Only "The" — "A" and
"An" are far likelier to be a real first word.

**`tier` is one field driving three behaviours, and all three read it — don't let one
drift from the other two.** `"featured"` vs `"standard"` controls: pin size
(`pinDims()`/`FEATURED_SCALE`), sidebar sort order (`assignNumbers()` sorts by
`tierRank()` before name, and `renderCards()` groups featured listings under a divider),
and popup photos (`photosHtml()` — a carousel for featured with more than one photo, a
single image for everyone else). A listing with an unrecognized `tier` value is logged
as a warning and rendered as standard, matching an unrecognized `category`.

**Hover cards are popups, not tooltips.** A Leaflet tooltip disappears the moment the
pointer moves toward it, making the link unclickable. The card is a popup with a
`HOVER_CLOSE_DELAY` grace period that `bindPopupHoverKeepAlive()` cancels while the
pointer is over the card itself. Clicking pins it open until `Esc` or a map click. The
same pattern (`bindCarousel()`) wires the featured-tier carousel's buttons once per
popup element, guarded by `carousel._chapterBound` so repeated `popupopen` events don't
double-bind listeners.

**`state.closeTimers` is one pending-close timeout per listing id, not one shared
timer.** `autoClose:false`/`closeOnClick:false` on every popup (needed so hovering one
card can't auto-close another that's pinned) mean several popups can be genuinely open
at once during a fast hover across the sidebar. A single shared timer means hovering
card B while card A's close is still pending cancels *A's* close (the only one there
is), not B's — A's popup is then never scheduled to close again and is stuck open.
`cancelClose(id)`/`scheduleClose(id)` must stay keyed by id so each popup's close runs
on its own clock.

**All colour-on-colour pairs go through `numberStyle()`.** It picks white or deep ink
for a number label by contrast, and where neither reaches 4.5:1 it deepens the fill
until white does. Pins, sidebar badges, popup badges, chips and legend dots all use its
output, so a pin and its legend dot always match. Categories added later inherit this
automatically — do not hardcode a label colour.

**The map does not fit its pins.** `meta.center` / `meta.zoom` are used as given.
Retune the opening view in the JSON, not in code — one outlying listing added later
could otherwise pull the view back and squash the Richmond cluster where most of the
directory lives.

**Everything is vendored.** Leaflet and both typefaces live in `vendor/`; there are no
CDN or Google Fonts requests. Fredoka and Nunito Sans — the same pairing the holiday-map
project uses — are vendored as *trimmed variable fonts* (`fredoka-latin-variable.woff2`,
`nunito-sans-latin-variable.woff2`) rather than one static file per weight: each
`@font-face` declares a `font-weight` range (`500 600` / `400 700`) over a single file,
and the browser instantiates the exact weight CSS asks for via the font's `wght` axis. A
weight used in CSS still needs to fall inside a vendored file's declared range — asking
for `font-weight: 300` on Fredoka, outside `500 600`, renders whatever the browser's
font-matching falls back to, not a real 300. The pin-number `<text>` in `pinIcon()`
(`js/app.js`) sets its own literal `font-family="Fredoka, …"` rather than
`var(--font-display)`, matching how the rest of that generated SVG string — colours
included — is built from literal values, not CSS custom properties; keep that string in
sync with `--font-display` by hand if the display font ever changes again.

**The header artwork is referenced with `<img>`, never inlined.** This one is an
Illustrator SVG export carrying a `<style>` block of generic `.st0`–`.st32` class names
that would leak into the page if inlined directly into the HTML — `<img>` keeps it
sandboxed regardless. Swapping it is a file-plus-two-numbers change: replace
`assets/SeniorLiving-BlueCommunity-02.svg`, update its `src` in `index.html`, and update
`.banner__scene`'s `aspect-ratio` (currently `2062.37 / 385.42`, that file's own canvas)
in `css/styles.css` to match.

Whether the banner uses `object-fit: cover` or `contain` depends entirely on how much
dead margin the specific artwork has — check by rendering it and scanning for the
bounding box of non-near-white pixels, never by assuming. This file has real margin on
every edge (a scan of the rendered SVG found content spanning only y=6..352 of its
386-tall canvas — 1.6% clear at the top, 8.8% at the bottom — inset from both sides
too), so it's fit with `cover`, biased low (`object-position: center 20%`) since the top
margin is thin enough that any crop has to come out of the bottom's bigger buffer
instead. The *previous* header photo had the opposite problem — content bled to all four
edges with nothing to crop into — and used `contain` for exactly that reason; don't
carry either choice forward onto a future replacement without re-checking its own
margins the same way.

This SVG's `<style>` block happens to define several colours (`.st0`–`.st13`) that exactly
match holiday-map's own named palette, even though this particular composition only
paints with a subset of them (see the palette note below) — that's not a coincidence
worth re-litigating if a future version of this artwork uses a different subset; just
re-sample whatever it actually renders with, the same way this one was.

**Stacked layout needs `.layout { flex: 0 0 auto; min-height: auto; }`.** Without it the
grid shrinks to the leftover viewport height, the sidebar's flex column collapses its card
list to a few pixels, and `overflow: hidden` clips the directory after the first row. When
checking mobile, measure the *sidebar's* height against its content, not just the list's.

**Text from JSON is escaped** via `esc()` before insertion. Keep new fields going through
it.

## Map tiles

Single layer, `alidade_smooth`, zoom 1–20, `{r}` for HiDPI. It carries its own street
lettering, so no labels overlay. Stadia serves key-free on `localhost`/`127.0.0.1` only;
any other origin needs an API key in `STADIA_API_KEY` or an allowlisted domain, or every
tile returns 401. The tile-failure notice waits for three failures with nothing painted —
so one unlucky tile doesn't trigger it — and removes itself if tiles start arriving.
Attribution for Stadia, OpenMapTiles and OpenStreetMap must stay visible.

## Content conventions

The header illustration (`assets/SeniorLiving-BlueCommunity-02.svg`) is real. The dataset
(`data/communities.json`) is still placeholder: four fictional listings with
`example.com` links and `555`-exchange phone numbers, and hand-drawn flat-vector SVGs
standing in for every listing photo — deliberately not photorealistic, so nothing gets
mistaken for real photography. When the real listing data arrives, replace it in place
(same file paths, same JSON shape) rather than restructuring around it. Publish `hours`
only when they come from a community's own copy — hours scraped from a third-party
listing may be stale, and a wrong time sends someone to a locked door.

## Deploying

Not yet configured. When a hosting target is chosen (GitHub Pages, Netlify, S3, etc.),
document the deploy branch and process here.
