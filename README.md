# 📖 The Next Chapter Map

*A Richmond, VA senior living & services directory.*

An interactive, illustrated map of senior living communities around Richmond, built
with [Leaflet](https://leafletjs.com) on top of Stadia Maps' **Alidade Smooth** tiles,
in a flat editorial style built for a city magazine.

Hover a pin (or a card in the sidebar) and a little paper card opens with the
community's name, a short description, its address, hours and phone, a link to their
site, and a photo (or, for featured listings, a small photo carousel). The card stays
put while your cursor travels to it, so the link is actually clickable — click a pin
to keep the card pinned open, `Esc` or click the map to put it away. Type a ZIP or
address into "Your location" to drop a second, differently-shaped marker showing where
you are relative to everything else on the map.

## Running it

Everything is static — no build step, no dependencies to install. Leaflet 1.9.4 and
both typefaces (Fredoka, Nunito Sans — the same pairing as the holiday-map project) are
vendored in `vendor/`, so there are no CDN or Google Fonts requests and the page works
offline. Because the directory is loaded with
`fetch`, it does need to be served over HTTP rather than opened as a `file://` URL:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host works for deployment — GitHub Pages, Netlify, S3, a folder on nginx.

## Map tiles and the Stadia API key

The basemap is Stadia Maps' Alidade Smooth. It serves key-free on `localhost` /
`127.0.0.1`, so local development needs no setup. **On any other domain you need a free
API key or an allowlisted domain**, or the tiles come back 401 and the map stays blank
(the page will tell you so, in that case).

Register at [client.stadiamaps.com](https://client.stadiamaps.com), then pick either route:

- **API key** — create one and drop it into `js/app.js`:

  ```js
  var STADIA_API_KEY = "your-key-here";
  ```

- **Domain allowlist** — add your domain to your Stadia property's allowed domains, and
  keyless requests from that origin are authenticated by their `Origin` header. Nothing
  to put in the code, and no key to leak in a public repo.

If no tiles load at all, the map raises a notice explaining this rather than sitting
blank. It waits for several consecutive failures with nothing painted, so a single
unlucky tile won't trigger it, and it clears itself if the tiles start arriving.

Attribution for Stadia, OpenMapTiles and OpenStreetMap is already wired into the map's
attribution control; their terms require you to keep it visible.

The style is a single layer — `alidade_smooth`, zoom 1–20, with `{r}` for HiDPI tiles.
It carries its own street lettering, so no labels overlay is needed. To try another
Stadia style, swap the style name in the tile URL in `js/app.js` and update the
attribution to match that style's requirements.

## Your location

Typing a ZIP code or address into the sidebar's "Your location" box and submitting it
(the arrow button, or just `Enter`) geocodes it via
[Nominatim](https://nominatim.openstreetmap.org/) — OpenStreetMap's free, key-free
search API, the same data source the map's tile attribution already credits — and drops
a marker there. That marker is deliberately not another pin: it's a centred dot with a
soft pulse ring, in a fixed blue no listing pin ever uses. (Listing colours are random —
see below — so a same-shaped pin could in principle land on any colour on any given page
load; only a different *shape* reliably keeps it from reading as one more, oddly
unnumbered listing.) Clicking the marker again, or resubmitting the form, reopens its
"You are here" popup; "Clear my location" removes the marker and its popup entirely.

Nominatim's usage policy caps this at light, occasional use (an individual visitor
looking themselves up now and then), not bulk geocoding. There's no API key to
configure and nothing to install; it's a plain `fetch()` in `js/app.js` (`geocode()`),
so — same as `data/communities.json` — it only works once the page is actually served
over HTTP(S), not opened as a `file://` URL.

## The directory data

All content lives in [`data/communities.json`](data/communities.json) — nothing about a
listing is hard-coded in the HTML or JS. Edit that file and reload.

```jsonc
{
  "meta": {
    "titleLead": "Richmond Magazine Presents",  // small line above the name; omit to drop it
    "title": "The Next Chapter",                // the name itself, set large
    "subtitle": "…",                            // banner tagline
    "center": [37.555, -77.49],                 // the opening view, used as given
    "zoom": 11,
    "attributionNote": "…"                      // small print at the foot of the sidebar
  },

  "listings": [
    {
      "id": "williamsburg-landing",      // unique; used internally to link pin ↔ card
      "name": "Williamsburg Landing",
      "tier": "standard",                // "featured" or "standard" — see below
      "blurb": "One or two sentences.",
      "url": "https://williamsburglanding.org", // optional — the card's link button
      "address": "5700 Williamsburg Landing Drive, Williamsburg, VA 23185", // optional
      "hours": "Tours daily, 9am–5pm",   // optional
      "phone": "800-554-5517",           // optional; shown as a tel: link
      "coords": [37.245442, -76.719175], // [latitude, longitude]
      "photos": [                        // optional; first one shows even on "standard"
        "assets/photos/exterior-1.svg"
      ]
    }
  ]
}
```

### `tier`: `"featured"` or `"standard"`

`tier` is a paid-placement style flag, and it drives three things at once:

- **Pin size** — featured pins render about 22% larger on the map (`FEATURED_SCALE` in
  `js/app.js`); everything else about the pin shape is identical.
- **Sidebar sort order** — the directory groups featured listings first (under a
  "Featured" divider), then everyone else, alphabetical within each group. Numbers are
  still assigned once over the whole list in that order, so filtering and searching
  never renumber anything.
- **Popup photos** — a featured listing's hover/click card cycles through every photo
  in its `photos` array as a small carousel (prev/next buttons, dot indicators); a
  standard listing's card shows just the first photo. A listing with no `photos` shows
  none — the field is optional either way.

Every listing in the current dataset is `"standard"` — there's no paid-placement tier
active right now, so nobody is grouped apart from anybody else and every card looks the
same. The mechanism is fully wired up and unchanged underneath: mark any listing
`"featured"` and it picks up the bigger pin, its own divider at the top of the sidebar,
and a photo carousel (if it has more than one photo) immediately, no code changes needed.

### Adding a listing

Append an object to `listings` with a unique `id`, a `tier`, and `coords` as
`[lat, lng]` (right-click a spot in Google Maps to copy them in that order — do not
interpolate a guess from a street number). There's no `category` field any more —
every listing gets its own colour instead, assigned at random; see "Colour" below.

Text from the JSON is HTML-escaped before rendering, so apostrophes and ampersands in
listing names are safe.

> The directory currently holds three real Life Plan Communities — Williamsburg
> Landing, Brandermill Woods and Cedarfield — with real addresses, phone numbers and
> sites, and coordinates copied from Google Maps for each. Their photos are still the
> hand-drawn placeholder SVGs, standing in until real photography arrives; swap those in
> the same way (edit the JSON, replace the files).

### Colour

Every senior living facility in this directory is, well, a senior living facility —
there's no meaningful category to sort them into any more, so there are no categories,
no filter chips, and no legend. Instead, each listing gets its own colour, assigned at
random from a fixed eight-swatch palette the moment the page loads
(`assignColors()` in `js/app.js`). It's genuinely random, not hash-stable — reload the
page and the same listings can come out in different colours — but *stable for the rest
of that page load*: assigned once, not on every render, so a listing's pin and its
sidebar badge always match each other, and neither reshuffles just because you typed
into the search box. The palette is the same eight named swatches (teal, coral, purple,
navy, gold, green, pink, deep navy) the holiday-map project uses, and every one of them
still runs through the same AA-contrast check (`numberStyle()`) a category colour used
to — a colour that can't carry white text at 4.5:1 gets deepened until it can, exactly
as before.

## What's in the box

```
index.html                               page shell — masthead, illustrated band, sidebar, map frame
css/styles.css                           the flat editorial look: palette, masthead, cards, pins
js/app.js                                map setup, pins, hover cards, filtering, search, geocoding
data/communities.json                    the directory itself
assets/SeniorLiving-BlueCommunity-02.svg header illustration
assets/photos/*.svg                      placeholder listing photos — swap for real photography
vendor/leaflet/                           Leaflet 1.9.4 (BSD-2-Clause), vendored
vendor/fonts/                             Fredoka + Nunito Sans (SIL OFL), vendored
```

Typography and palette both match the holiday-map project directly, not just echo its
style. Fredoka (masthead, listing/community names, pin and badge numbers) over Nunito
Sans (everything else) is the same pairing at the same weights; the header
illustration's own embedded colour swatches turned out to be, almost verbatim,
holiday-map's own named palette, so the whole site pulls its colours from there rather
than inventing them fresh: `#eae6e2` greige ground (holiday-map's own page ground),
`#23375f` ink and `#345393` brand (deepened a little off the illustration's own line
colour, `#3e62ac`, for real AA margin).

The banner illustration is capped at `max-width: 1400px` (matching the rest of the
page's own content width) and fit with `object-fit: contain`, so it's never cropped or
stretched on a wide window — past that width, the page's own ground colour just shows
on either side instead of the image continuing to grow. (Different header art with no
dead margin of its own might still want `cover`; see the CLAUDE.md note on swapping the
illustration for how to tell which one a new file needs.)

## Features

- **Numbered directory** — the sidebar lists listings by tier then name (a leading
  "The" is ignored, so "The Cedars" files under C), each with a number that matches
  its pin. Numbers are assigned once across the whole directory, so filtering and
  searching hide rows without renumbering anything.
- **Featured tier** — controls pin size, sidebar sort order (grouped first, under a
  divider) and whether the popup shows one photo or a small carousel.
- **Random colour per listing** — no categories; every listing gets its own colour from
  a fixed palette, assigned once when the page loads and shared by its pin and its
  sidebar badge for the rest of that session.
- **"Your location"** — geocode a ZIP or address (via Nominatim) to drop a second,
  differently-shaped marker showing where you are relative to the directory.
- **Details on hover** — the blurb, address, phone, photo(s) and link live in the card
  that opens when you hover a pin (or a row in the list), not in the sidebar.
- **Hover cards are popups, not tooltips**, so they survive the trip from pin to link,
  plus click-to-pin.
- **Search box** matching name, blurb and address.
- **Flat vector pins** drawn as inline SVG, numbered to match the list.
- **Keyboard support** — cards, the locate form and carousel controls are all focusable;
  `Enter`/`Space` activates a card, `Esc` closes a pinned card or the "you are here"
  popup.
- **Opens where the directory lives** — `meta.center` and `meta.zoom` set the view as
  given, rather than fitting every pin.
- **Responsive, and never cropped on a wide window** — the sidebar stacks above the map
  on narrow screens and the page scrolls; the header illustration is capped at a
  max-width rather than stretching (and cropping) edge-to-edge on a wide one.
- **AA contrast** on every listing's assigned colour (checked and, if needed,
  auto-deepened at render time — see `numberStyle()` in `js/app.js`), and on every
  other text/background pair in the design.
