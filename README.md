# 📖 The Next Chapter Map

*A Richmond, VA senior living & services directory.*

An interactive, illustrated map of senior living communities and services around
Richmond — independent living, assisted living, memory care, CCRCs, in-home care and
senior services — built with [Leaflet](https://leafletjs.com) on top of Stadia Maps'
**Alidade Smooth** tiles, in a flat editorial style built for a city magazine.

Hover a pin (or a card in the sidebar) and a little paper card opens with the
community's name, a short description, its address, hours and phone, a link to their
site, and a photo (or, for featured listings, a small photo carousel). The card stays
put while your cursor travels to it, so the link is actually clickable — click a pin
to keep the card pinned open, `Esc` or click the map to put it away.

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

## The directory data

All content lives in [`data/communities.json`](data/communities.json) — nothing about a
listing is hard-coded in the HTML or JS. Edit that file and reload.

```jsonc
{
  "meta": {
    "titleLead": "Richmond Magazine Presents",  // small line above the name; omit to drop it
    "title": "The Next Chapter Map",            // the name itself, set large
    "subtitle": "…",                            // banner tagline
    "center": [37.555, -77.49],                 // the opening view, used as given
    "zoom": 11,
    "attributionNote": "…"                      // small print at the foot of the sidebar
  },

  "categories": {
    "independent-living": {             // key referenced by each listing
      "label": "Independent Living",    // shown on chips, cards, the ribbon and the legend
      "color": "#2f7d6b"                // colours the pin, its number badge and dot
    }
    // …assisted-living, memory-care, ccrc, in-home-care, senior-services
  },

  "listings": [
    {
      "id": "bellemont-gardens",        // unique; used internally to link pin ↔ card
      "name": "Bellemont Gardens",
      "category": "independent-living", // must match a key in "categories"
      "tier": "featured",               // "featured" or "standard" — see below
      "blurb": "One or two sentences.",
      "url": "https://example.com",     // optional — the card's link button
      "address": "88 Church St",        // optional
      "hours": "Tours daily, 9am–5pm",  // optional
      "phone": "804-555-0100",          // optional; shown as a tel: link
      "coords": [37.5674, -77.4661],    // [latitude, longitude]
      "photos": [                       // optional; first one shows even on "standard"
        "assets/photos/exterior-1.svg",
        "assets/photos/garden.svg"
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

### Adding a listing

Append an object to `listings` with a unique `id`, a `category` that exists in
`categories`, a `tier`, and `coords` as `[lat, lng]` (right-click a spot in Google Maps
to copy them in that order). New categories need only a label and a colour — the filter
chips, legend and pin colours all build themselves from that map. The number label
inside a pin is set to white or deep ink automatically, whichever reads better on that
colour; if neither clears 4.5:1, the fill under the number is deepened until white
does. Chips and legend dots use that same adjusted colour, so a pin always matches its
dot in the legend.

Text from the JSON is HTML-escaped before rendering, so apostrophes and ampersands in
listing names are safe.

> The current dataset is four fake, clearly-placeholder listings (`example.com` links,
> `555` phone numbers, hand-drawn placeholder photos) so the build can be exercised end
> to end. Swap in the real listings the same way: edit the JSON, replace the photo files.

## What's in the box

```
index.html                            page shell — masthead, illustrated band, sidebar, map frame
css/styles.css                        the flat editorial look: palette, masthead, cards, pins
js/app.js                             map setup, pins, hover cards, filtering, search, legend
data/communities.json                 the directory itself
assets/SeniorLiving-BlueCommunity.png header illustration
assets/photos/*.svg                   placeholder listing photos — swap for real photography
vendor/leaflet/                        Leaflet 1.9.4 (BSD-2-Clause), vendored
vendor/fonts/                          Fredoka + Nunito Sans (SIL OFL), vendored
```

Typography is Fredoka (masthead, listing/community names, pin and badge numbers, the
legend heading) over Nunito Sans (everything else) — the same pairing the holiday-map
project uses, so the two directories read as one family even with different palettes.

The palette is a clean, cool near-white ground with dark slate text and a cobalt-blue
masthead accent — `#f7f9fc` ground, `#1f2733` ink, `#2454c9` brand — pulled from the
header illustration's own line colour, plus one distinct, muted colour per category:
teal for independent living, terracotta for assisted living, plum for memory care, navy
for CCRCs, ochre for in-home care, sage for senior services. The illustration bleeds to
all four edges of its own canvas, so the banner fits it with `object-fit: contain`
(never cropping) rather than `cover`; `--ground` matches its near-white background so
any letterboxing on wide screens blends in rather than reading as a visible box.

To swap the header illustration again: replace the file, update its `src` in
`index.html`, and update the `aspect-ratio` in `.banner__scene` (`css/styles.css`) to
match the new file's own width/height.

## Features

- **Numbered directory** — the sidebar lists listings by tier then name (a leading
  "The" is ignored, so "The Cedars" files under C), each with a number that matches
  its pin. Numbers are assigned once across the whole directory, so filtering and
  searching hide rows without renumbering anything.
- **Featured tier** — controls pin size, sidebar sort order (grouped first, under a
  divider) and whether the popup shows one photo or a small carousel.
- **Details on hover** — the blurb, address, phone, photo(s) and link live in the card
  that opens when you hover a pin (or a row in the list), not in the sidebar.
- **Hover cards are popups, not tooltips**, so they survive the trip from pin to link,
  plus click-to-pin.
- **Category filter chips** and a **search box** matching name, blurb, address and category.
- **Flat vector pins** drawn as inline SVG, coloured per category, numbered to match the list.
- **Keyboard support** — cards and carousel controls are focusable, `Enter`/`Space`
  activates them, `Esc` closes a pinned card.
- **Opens where the directory lives** — `meta.center` and `meta.zoom` set the view as
  given, rather than fitting every pin.
- **Responsive** — the sidebar stacks above the map on narrow screens and the page scrolls.
- **AA contrast** on every category colour (checked and, if needed, auto-deepened at
  render time — see `numberStyle()` in `js/app.js`), and on every other text/background
  pair in the design.
