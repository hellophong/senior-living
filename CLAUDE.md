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
contrast ratios. Three things need explicit setup:

- **Tile requests will fail** unless the environment can reach `tiles.stadiamaps.com`.
  Intercept `**://tiles.stadiamaps.com/**` and fulfil with a flat placeholder PNG so
  layout and pin contrast can still be judged. Screenshots taken this way show a blank
  map area — say so rather than implying the basemap was seen.
- **Popups auto-pan.** Opening one shifts the map, so measure the opening view *before*
  hovering anything.
- **"Your location" needs Nominatim mocked too**, same reasoning as the tiles: intercept
  `**://nominatim.openstreetmap.org/**` and fulfil with a canned
  `[{"lat":"…","lon":"…","display_name":"…"}]` (or `[]`, to exercise the no-results
  error path) rather than relying on the real service being reachable. If a test asserts
  on the request itself, remember `geocode()` sends a 5-digit ZIP as `postalcode=`, not
  `q=` — check both params, not just `q`, or a ZIP-shaped assertion will read as `null`.

Geocoding services and most third-party sites are typically blocked in a sandboxed
dev/CI environment — that's exactly why the app's own `geocode()` needs mocking rather
than skipping this area of coverage entirely. Do not derive *listing* coordinates by
interpolating street numbers, either — ask for them (Google Maps right-click → copy
coordinates) rather than shipping a guessed pin. (A *visitor* geocoding their own ZIP
through Nominatim at runtime is a different thing — that's the point of the feature,
and it runs in their browser against the real service, not this one.)

## Architecture

`js/app.js` is one IIFE with no modules or framework. `data/communities.json` drives
everything — no listing is hard-coded in HTML, CSS, or JS. Adding a listing is a JSON
edit alone. There are no categories: every listing gets its own colour, assigned at
random when the page loads (`assignColors()`), not read from the data.

`state` holds `markers` (id → Leaflet marker), `numbers` (id → directory number),
`colors` (id → hex, see below), `activeId` (clicked/pinned), `hoverId`, and `query`. The
sidebar and the map are two views over the same state, kept in sync through
`syncActiveStyles()`. The "your location" marker (`userMarker`) is deliberately *not*
part of this state machine — see its own invariant below.

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
as a warning and rendered as standard.

**Colour is random, assigned once at load, not derived from the data.** There used to be
a `categories` map in the JSON and every listing pointed at one; there are no categories
any more (every listing here is a senior living facility, so the distinction stopped
being meaningful), and `assignColors()` replaces it: at load, `RANDOM_PALETTE` is
shuffled and handed out to listings in order (wrapping if there are ever more listings
than colours), and the result is cached in `state.colors`. Two things follow from
"once, not derived": (1) reloading the page can genuinely change which listing has which
colour — that's intended, not a bug; (2) re-rendering the card list (filtering,
searching) must *never* call `assignColors()` again, or a listing's pin and its sidebar
badge would drift apart mid-session, and a listing could visibly change colour while you
type in the search box. `RANDOM_PALETTE` in `js/app.js` duplicates the hex values also
sitting in `css/styles.css`'s `:root` (same reason `INK`/`INK_DEEP` duplicate `--ink` —
see below) — update both if the palette ever changes.

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
until white does. Pins, sidebar badges and popup badges all use its output, so a pin and
its sidebar badge always match. A random palette entry that happens to read poorly on
its own (unlikely with 8 fixed swatches, but not impossible) still comes out AA-safe
automatically — do not hardcode a label colour anywhere this function's output belongs.

**The "your location" marker stays out of `state.markers` and
`state.data.listings` entirely.** It isn't a listing — it has no number, no card, no
category ever did and no colour from the random palette (it uses a fixed, separate
`LOCATE_COLOR` no listing pin can ever land on, specifically so a same-shaped pin
couldn't be confused with it). `syncActiveStyles()` and `applyFilters()` both iterate
`state.markers`/`state.data.listings` assuming every entry is a real listing; folding
the user's marker into either would require those loops to start special-casing a
synthetic id. It's tracked in its own module-level `userMarker` variable instead, with
its own three functions (`geocode()`, `showUserLocation()`, `clearUserLocation()`) that
never touch `state`. It *is* still wired into the map-click/Escape handlers in `start()`
(closing its popup, not removing the marker) purely for interaction-pattern consistency
with pinned listing popups — that's the one place the two intentionally touch.

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
sync with `--font-display` by hand if the display font ever changes again. "Your
location" is the one *external* request the page makes beyond tiles: Nominatim isn't
vendorable (it's a live geocoding lookup, not a static asset), so it's the one place
this "everything local" rule doesn't apply — see the Nominatim section below.

**The header artwork is referenced with `<img>`, never inlined.** This one is an
Illustrator SVG export carrying a `<style>` block of generic `.st0`–`.st32` class names
that would leak into the page if inlined directly into the HTML — `<img>` keeps it
sandboxed regardless. Swapping it is a file-plus-two-numbers change: replace
`assets/SeniorLiving-BlueCommunity-02.svg`, update its `src` in `index.html`, and update
`.banner__scene`'s `aspect-ratio` (currently `2062.37 / 385.42`, that file's own canvas)
in `css/styles.css` to match.

`.banner__scene` also carries `max-width: 1400px` (matching the rest of the page's own
content width) alongside its `max-height: 260px`, specifically so a wide window can't
force a crop: past 1400px wide the box simply stops growing and the page's own ground
colour shows on either side, rather than the box exceeding the aspect ratio that
`max-height` alone would otherwise allow and `object-fit: cover` cropping into it.
`object-fit` is `contain`, not `cover`, as a second, independent guarantee of the same
thing — even hitting that width exactly, where the box's ratio (1400/260) and the
image's own (2062.37/385.42) don't quite match to the pixel, `contain` shrinks-to-fit
rather than crops. This is a deliberate reversal from this artwork's own earlier
approach here (`cover`, biased low via `object-position`) — that traded a very small,
deliberate crop into the art's own dead margin for a tighter, edge-to-edge look; the
max-width version gives up that tightness for a hard guarantee of zero cropping at any
window width, which is what's wanted now. Whether a *future* header image should use
`cover` or `contain` still depends entirely on how much dead margin that specific
artwork has — check by rendering it and scanning for the bounding box of non-near-white
pixels, never by assuming. This file has real margin on every edge (a scan of the
rendered SVG found content spanning only y=6..352 of its 386-tall canvas — 1.6% clear at
the top, 8.8% at the bottom — inset from both sides too), so `cover` was *safe* for it,
just no longer the choice made here. A future image that bleeds to all four edges with
no margin to crop into needs `contain` regardless of the max-width question — re-check
margins the same way rather than carrying a prior choice forward.

This SVG's `<style>` block happens to define several colours (`.st0`–`.st13`) that exactly
match holiday-map's own named palette, even though this particular composition only
paints with a subset of them (see the palette note above) — that's not a coincidence
worth re-litigating if a future version of this artwork uses a different subset; just
re-sample whatever it actually renders with, the same way this one was.

**An author stylesheet's `display` always beats the UA stylesheet's
`[hidden]{display:none}`**, specificity and source order notwithstanding — CSS origin
(UA vs. author) is resolved before either. `.locate__clear` sets `display: block` (to
sit on its own line under the status text) and is also toggled via `el.hidden` in JS;
without an explicit `.locate__clear[hidden] { display: none; }` override sitting after
it, the button stayed visible even with the `hidden` attribute set. Any other element
that both gets `el.hidden = true/false` from JS *and* has its own explicit `display` in
CSS needs the same override — plain elements with no `display` override (like
`#locateStatus`) don't, since nothing there fights the UA default.

**Stacked layout needs `.layout { flex: 0 0 auto; min-height: auto; }`.** Without it the
grid shrinks to the leftover viewport height, the sidebar's flex column collapses its card
list to a few pixels, and `overflow: hidden` clips the directory after the first row. When
checking mobile, measure the *sidebar's* height against its content, not just the list's.

**Text from JSON is escaped** via `esc()` before insertion. Keep new fields going through
it. The geocoded `display_name` Nominatim returns is untrusted external text the same
way — it goes through `esc()` in `showUserLocation()` too, same as any listing field.

## Map tiles

Single layer, `alidade_smooth`, zoom 1–20, `{r}` for HiDPI. It carries its own street
lettering, so no labels overlay. Stadia serves key-free on `localhost`/`127.0.0.1` only;
any other origin needs an API key in `STADIA_API_KEY` or an allowlisted domain, or every
tile returns 401. The tile-failure notice waits for three failures with nothing painted —
so one unlucky tile doesn't trigger it — and removes itself if tiles start arriving.
Attribution for Stadia, OpenMapTiles and OpenStreetMap must stay visible.

## "Your location" / Nominatim

`geocode()` in `js/app.js` calls `nominatim.openstreetmap.org/search` directly from the
browser — no key, no backend, no vendoring possible (it's a live lookup, not a static
asset). Nominatim's usage policy is written for exactly this kind of light, occasional,
client-initiated use (one visitor looking up their own ZIP now and then), not for bulk
or automated geocoding — don't repurpose `geocode()` to look up more than what a single
visitor typed. The map's attribution control already credits "OpenStreetMap
contributors" for tile data; that same credit covers Nominatim results too, since both
come from the same underlying OSM data — no separate attribution line was added.

**Every lookup carries `countrycodes=us`, and a 5-digit (or ZIP+4) input skips free text
entirely for Nominatim's structured `postalcode` field instead.** Without the country
restriction, a bare ZIP has no context telling Nominatim it's American — this directory
is Richmond, VA only, so a non-US result is never correct, and free-text search on a
plain number is a coin flip against whatever else in the world shares that numeral. This
was a real bug, not a hypothetical: "23832" (Chester, VA) resolved to Ukraine before
`US_ZIP` and the country restriction were added. `US_ZIP` only strips to 5 digits for
the `postalcode` param — a typed ZIP+4 suffix is dropped, not validated, since OSM's own
postal-code data is 5-digit-granular anyway. Keep both the regex-detected structured path
*and* the free-text fallback's `countrycodes=us` — a full street address still needs to
go in as `q=`, but it needs the same country restriction for the same reason a ZIP does.

`showUserLocation()` replaces the previous marker outright rather than adding another
(`if (userMarker) map.removeLayer(userMarker)` before creating the new one) — there is
only ever one "your location" at a time. `wireLocate()` disables the input while a
lookup is in flight and re-enables it in a `.then()` chained after the `.catch()`, which
runs either way (this codebase's stand-in for `.finally()`) — don't remove that
re-enable thinking the `.catch()` branch alone covers it.

## Content conventions

The header illustration (`assets/SeniorLiving-BlueCommunity-02.svg`) is real, and so is
the dataset (`data/communities.json`) — three real Life Plan Communities (Williamsburg
Landing, Brandermill Woods, Cedarfield), all tier `standard`. Their `coords` are real
too, copied via Google Maps' right-click — not interpolated — per the coordinate rule
above. Photos are still hand-drawn flat-vector SVGs standing in for each community's
own — deliberately not photorealistic, so nothing gets mistaken for real photography —
until real photography arrives; swap them in place (same file paths, same JSON shape)
the same way real listing data replaced the fake set. Publish `hours` only when they
come from a community's own copy — hours scraped from a third-party listing may be
stale, and a wrong time sends someone to a locked door. None of the three came with
hours, so none is set.

All three communities happen to be Life Plan Communities (a "Life Plan Community" *is* a
CCRC — multiple levels of care on one campus — the industry's current name for it),
which is *why* there's no `category` field at all any more rather than one category
every listing shares: with every listing in this directory being some flavor of senior
living facility, a single-value category added nothing a reader couldn't already tell
from the page's own title and subtitle. If a genuinely different *kind* of listing
arrives later — a service directory entry with no campus, say — that's a product
decision to revisit (a new field, a new visual treatment), not a reason to resurrect the
old `categories` map for one distinguishing bit.

## Deploying

Not yet configured. When a hosting target is chosen (GitHub Pages, Netlify, S3, etc.),
document the deploy branch and process here.
