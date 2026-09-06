/* -----------------------------------------------------------------
   The Next Chapter Map — a senior living & services directory for
   Richmond, VA. Leaflet + Stadia's Alidade Smooth tiles. No build step.
   ----------------------------------------------------------------- */

(function () {
  "use strict";

  /* Stadia Maps serves the basemap tiles. They work key-free on
     localhost / 127.0.0.1; for any other domain, register a free key at
     https://client.stadiamaps.com and drop it in here (or set
     window.STADIA_API_KEY before this script runs), or allowlist the domain
     on your Stadia property. */
  var STADIA_API_KEY = window.STADIA_API_KEY || "";
  var DATA_URL = "data/communities.json";
  var HOVER_CLOSE_DELAY = 260; // ms of grace to travel from pin to card

  var state = {
    data: null,
    markers: {},          // id -> L.Marker
    numbers: {},           // id -> directory number (tier, then alphabetical; stable)
    colors: {},             // id -> hex, assigned once at load (see assignColors())
    activeId: null,        // pinned (clicked) listing
    hoverId: null,         // listing under the cursor
    query: "",
    closeTimers: {}        // id -> pending hover-close timeout, one per listing
  };

  var map;

  /* --------------------------- Tiles --------------------------- */

  function key(suffix) {
    return STADIA_API_KEY ? suffix + "?api_key=" + encodeURIComponent(STADIA_API_KEY) : suffix;
  }

  function addTiles() {
    var attribution =
      '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> ' +
      '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

    /* Alidade Smooth carries its own lettering, so it needs no separate
       labels overlay. */
    var base = L.tileLayer(key("https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"), {
      minZoom: 1,
      maxZoom: 20,
      attribution: attribution
    }).addTo(map);

    base.on("tileload", onTileLoad);
    base.on("tileerror", onTileError);
  }

  /* ----------------------- Tile health notice --------------------- */
  /* A single failed tile at the edge of the view is just noise. Only say
     something once several requests have failed AND nothing has painted at
     all — that pattern means the layer is being refused outright, not that
     one request got unlucky. */

  var TILE_ERROR_THRESHOLD = 3;
  var tileErrors = 0;
  var tilesPainted = 0;
  var tileWarning = null;

  function onTileLoad() {
    tilesPainted += 1;
    if (tileWarning) {           // tiles came back after all — take the notice down
      map.removeControl(tileWarning);
      tileWarning = null;
    }
  }

  function onTileError() {
    tileErrors += 1;
    if (tileWarning || tilesPainted > 0 || tileErrors < TILE_ERROR_THRESHOLD) return;

    tileWarning = L.control({ position: "topright" });
    tileWarning.onAdd = function () {
      var div = L.DomUtil.create("div", "map-legend tile-warning");
      div.innerHTML =
        "<h2>The map didn't arrive</h2>" +
        "<p style='margin:0 0 .35rem;max-width:15rem'>No map tiles are loading. " +
        "Stadia Maps serves them key-free on <code>localhost</code> only — anywhere else an " +
        "unauthenticated request comes back <code>401</code>.</p>" +
        "<p style='margin:0;max-width:15rem'>Add an API key in <code>js/app.js</code> or " +
        "allow this domain on your Stadia property. If neither applies, check the network " +
        "tab — an ad blocker or proxy may be swallowing the requests.</p>";
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    tileWarning.addTo(map);
  }

  /* --------------------------- Pins ---------------------------- */

  /* Every listing carries a number, assigned once over the whole directory.
     Filtering and searching hide rows but never renumber them, so the
     number beside a name always matches the pin on the map. */
  function sortKey(name) {
    return name.replace(/^the\s+/i, "");   // "The Byrd Theatre" files under B
  }

  /* Tier controls sidebar sort order: featured listings are grouped first,
     alphabetical within each group. */
  function tierRank(listing) {
    return listing.tier === "featured" ? 0 : 1;
  }

  function assignNumbers() {
    state.data.listings
      .slice()
      .sort(function (a, b) {
        var byTier = tierRank(a) - tierRank(b);
        return byTier !== 0 ? byTier : sortKey(a.name).localeCompare(sortKey(b.name));
      })
      .forEach(function (listing, index) {
        state.numbers[listing.id] = index + 1;
      });
  }

  function orderedListings() {
    return state.data.listings.slice().sort(function (a, b) {
      return state.numbers[a.id] - state.numbers[b.id];
    });
  }

  /* Every listing used to inherit its colour from a category; with no more
     categories, each one gets its own colour instead, drawn from the same
     palette (holiday-map's named swatches) at random. Assigned once here —
     not per render — and shuffled without replacement so, as long as there
     are no more listings than colours, no two are ever the same by
     accident; past that it wraps and repeats are possible. Reload the page
     for a new shuffle; state.colors keeps it stable for the rest of the
     session so a listing's pin and its sidebar badge never drift apart, and
     so filtering/searching (which re-renders the card list) doesn't
     reshuffle anyone already on screen. */
  var RANDOM_PALETTE = ["#9fd0d2", "#e54b3c", "#633d7a", "#4d6998", "#f8a92d", "#2cac84", "#e697aa", "#24536f"];

  function shuffled(list) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = out[i]; out[i] = out[j]; out[j] = swap;
    }
    return out;
  }

  function assignColors() {
    var palette = shuffled(RANDOM_PALETTE);
    state.data.listings.forEach(function (listing, index) {
      state.colors[listing.id] = palette[index % palette.length];
    });
  }

  /* The numbers sit on a colour that ranges from a pale gold to a deep navy,
     so the label colour is chosen per listing rather than fixed. */
  function luminance(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [16, 8, 0]
      .map(function (shift, i) {
        var c = ((n >> shift) & 255) / 255;
        c = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        return c * [0.2126, 0.7152, 0.0722][i];
      })
      .reduce(function (a, b) { return a + b; }, 0);
  }

  function contrast(a, b) {
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* Must track --ink / the header illustration's brand blue in css/styles.css —
     this is what actually gets used as a pin/badge/chip's text colour when it
     reads better than white, not just a value contrast is checked against. */
  var INK = "#23375f";
  var INK_DEEP = "#131f38";
  var AA = 4.5;

  function mix(hex, towards, amount) {
    var a = parseInt(hex.slice(1), 16), b = parseInt(towards.slice(1), 16), out = "#";
    for (var shift = 16; shift >= 0; shift -= 8) {
      var ca = (a >> shift) & 255, cb = (b >> shift) & 255;
      var c = Math.round(ca + (cb - ca) * amount);
      out += (c < 16 ? "0" : "") + c.toString(16);
    }
    return out;
  }

  /* Numbers sit directly on a listing's assigned colour. Where neither white
     nor deep ink text reaches AA (4.5:1) on it, the fill is deepened just
     until white text clears the threshold. A pin and its sidebar badge run
     the same colour through this function, so they always match even after
     deepening — and a random palette entry that happens to read poorly
     (unlikely, but not impossible with 8 fixed swatches) still comes out
     AA-safe automatically, the same as a category colour used to. */
  function numberStyle(hex) {
    var bg = luminance(hex);
    var onWhite = contrast(bg, 1);
    var onInk = contrast(bg, luminance(INK));

    if (Math.max(onWhite, onInk) >= AA) {
      return { bg: hex, fg: onWhite >= onInk ? "#ffffff" : INK };
    }

    for (var t = 0.05; t <= 0.9; t += 0.05) {
      var deeper = mix(hex, INK_DEEP, t);
      if (contrast(luminance(deeper), 1) >= AA) return { bg: deeper, fg: "#ffffff" };
    }
    return { bg: mix(hex, INK_DEEP, 0.9), fg: "#ffffff" };
  }

  /* Tier also controls pin size. Both sizes share one path drawn in a fixed
     42x54 coordinate space (PIN_BASE); a featured pin just renders that same
     shape larger, so the anchor points scale right along with it. */
  var PIN_BASE = { w: 42, h: 54, anchorX: 21, anchorY: 50, popupY: -42 };
  var FEATURED_SCALE = 1.22;

  function pinDims(tier) {
    var scale = tier === "featured" ? FEATURED_SCALE : 1;
    return {
      w: Math.round(PIN_BASE.w * scale),
      h: Math.round(PIN_BASE.h * scale),
      anchorX: Math.round(PIN_BASE.anchorX * scale),
      anchorY: Math.round(PIN_BASE.anchorY * scale),
      popupY: Math.round(PIN_BASE.popupY * scale)
    };
  }

  function pinIcon(listing) {
    var number = state.numbers[listing.id];
    var digits = String(number).length;
    var style = numberStyle(state.colors[listing.id]);
    var dims = pinDims(listing.tier);

    var svg =
      '<svg class="pin__svg" width="' + dims.w + '" height="' + dims.h + '" viewBox="0 0 42 54" ' +
        'xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<ellipse cx="21" cy="50" rx="9" ry="2.6" fill="#fff" opacity=".85"/>' +
        '<path d="M21 2a14 14 0 0 1 14 14c0 9.5-14 30-14 30S7 25.5 7 16A14 14 0 0 1 21 2z" fill="' + style.bg + '"/>' +
        '<text x="21" y="' + (digits > 2 ? 20.5 : 21.5) + '" text-anchor="middle" ' +
          'font-family="Fredoka, ui-rounded, system-ui, sans-serif" font-weight="600" ' +
          'font-size="' + (digits > 2 ? 12 : 16) + '" fill="' + style.fg + '">' +
          number +
        "</text>" +
      "</svg>";

    return L.divIcon({
      className: "pin",
      html: svg,
      iconSize: [dims.w, dims.h],
      iconAnchor: [dims.anchorX, dims.anchorY],
      popupAnchor: [0, dims.popupY]
    });
  }

  /* The "your location" marker is deliberately not another pin: a random
     palette entry could in principle land on any of these colours on any
     given load, so the only reliable way to keep it from reading as one
     more (oddly unnumbered) listing is a different silhouette — a centred
     dot with a soft pulse ring, anchored at its own middle rather than a
     bottom tip, in the fixed brand blue no listing pin ever uses. */
  var LOCATE_COLOR = "#345393";

  function locationIcon() {
    var svg =
      '<svg class="locate-pin__svg" width="34" height="34" viewBox="0 0 34 34" ' +
        'xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<circle class="locate-pin__pulse" cx="17" cy="17" r="8" fill="' + LOCATE_COLOR + '" opacity=".4"/>' +
        '<circle cx="17" cy="17" r="9" fill="#fff"/>' +
        '<circle cx="17" cy="17" r="6.5" fill="' + LOCATE_COLOR + '"/>' +
      "</svg>";

    return L.divIcon({
      className: "locate-pin",
      html: svg,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -20]
    });
  }

  var PIN_ICON =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M6 1a3.6 3.6 0 0 1 3.6 3.6C9.6 7.1 6 11 6 11S2.4 7.1 2.4 4.6A3.6 3.6 0 0 1 6 1z" ' +
    'stroke="currentColor" stroke-width="1.3"/></svg>';

  var CLOCK_ICON =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<circle cx="6" cy="6" r="4.6" stroke="currentColor" stroke-width="1.3"/>' +
    '<path d="M6 3.6V6l1.8 1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  var PHONE_ICON =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M3 1.6h2l1 2.3-1.2.9a7 7 0 0 0 3.4 3.4l.9-1.2 2.3 1v2A1.4 1.4 0 0 1 10 11 8.6 8.6 0 0 1 1 2a1.4 1.4 0 0 1 1.4-1.4z" ' +
    'stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  /* Tier also controls whether the popup shows one photo or a small
     carousel: featured listings cycle through every photo they have,
     everything else shows just the first. */
  function photosHtml(listing) {
    var photos = (listing.photos || []).filter(Boolean);
    if (!photos.length) return "";

    if (listing.tier !== "featured" || photos.length === 1) {
      return (
        '<div class="pop__photo-single">' +
          '<img class="pop__photo is-active" src="' + esc(photos[0]) + '" ' +
            'alt="' + esc(listing.name) + '" loading="lazy" width="264" height="198" />' +
        "</div>"
      );
    }

    var imgs = photos.map(function (src, i) {
      return (
        '<img class="pop__photo' + (i === 0 ? " is-active" : "") + '" src="' + esc(src) + '" ' +
          'alt="' + esc(listing.name) + ", photo " + (i + 1) + " of " + photos.length + '" ' +
          'loading="lazy" width="264" height="198" />'
      );
    }).join("");

    var dots = photos.map(function (_, i) {
      return (
        '<button type="button" class="pop__dot' + (i === 0 ? " is-active" : "") + '" data-index="' + i + '" ' +
          'aria-label="Photo ' + (i + 1) + " of " + photos.length + '"></button>'
      );
    }).join("");

    return (
      '<div class="pop__carousel" data-index="0" role="group" aria-label="Photos of ' + esc(listing.name) + '">' +
        imgs +
        '<button type="button" class="pop__car-btn pop__car-prev" data-dir="-1" aria-label="Previous photo">&#8249;</button>' +
        '<button type="button" class="pop__car-btn pop__car-next" data-dir="1" aria-label="Next photo">&#8250;</button>' +
        '<div class="pop__car-dots">' + dots + "</div>" +
      "</div>"
    );
  }

  function popupHtml(listing) {
    var details = [];
    if (listing.address) details.push("<span>" + PIN_ICON + esc(listing.address) + "</span>");
    if (listing.hours) details.push("<span>" + CLOCK_ICON + esc(listing.hours) + "</span>");
    if (listing.phone) {
      details.push("<span>" + PHONE_ICON +
        '<a class="pop__phone" href="tel:' + esc(listing.phone.replace(/[^0-9+]/g, "")) + '">' +
        esc(listing.phone) + "</a></span>");
    }

    var badge = numberStyle(state.colors[listing.id]);
    var featuredTag = listing.tier === "featured"
      ? '<span class="pop__featured-tag">Featured</span>'
      : "";

    return (
      '<div class="pop">' +
        photosHtml(listing) +
        '<p class="pop__ribbon"><span class="pop__num" style="background:' + badge.bg +
          ';color:' + badge.fg + '">' + state.numbers[listing.id] + "</span>" +
          featuredTag + "</p>" +
        '<h2 class="pop__name">' + esc(listing.name) + "</h2>" +
        '<p class="pop__blurb">' + esc(listing.blurb) + "</p>" +
        (details.length ? '<p class="pop__details">' + details.join("") + "</p>" : "") +
        (listing.url
          ? '<a class="pop__link" href="' + esc(listing.url) + '" target="_blank" rel="noopener noreferrer">' +
              "Visit their site</a>"
          : "") +
      "</div>"
    );
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ------------------------ Hover behaviour --------------------- */
  /* A tooltip would vanish the moment you reached for the link, so the
     card is a popup that opens on hover and lingers while the pointer is
     on it. Clicking a pin keeps it open until you dismiss it. */

  /* Each listing gets its own close timer, keyed by id — not one shared
     timer. Hovering card A then quickly card B used to cancel *whichever*
     close was pending, which was always A's, so A's popup was left open
     for good once B's own close fired. Per-id timers let several
     hover-opened popups (a stray one mid-transition, plus a pinned one)
     close independently on their own schedules. */
  function cancelClose(id) {
    if (state.closeTimers[id]) {
      clearTimeout(state.closeTimers[id]);
      delete state.closeTimers[id];
    }
  }

  function scheduleClose(id) {
    cancelClose(id);
    state.closeTimers[id] = setTimeout(function () {
      delete state.closeTimers[id];
      if (state.activeId === id) return; // pinned open by a click
      var marker = state.markers[id];
      if (marker) marker.closePopup();
      if (state.hoverId === id) state.hoverId = null;
      syncActiveStyles();
    }, HOVER_CLOSE_DELAY);
  }

  function bindPopupHoverKeepAlive(marker, id) {
    var el = marker.getPopup() && marker.getPopup().getElement();
    if (!el || el._chapterBound) return;
    el._chapterBound = true;
    L.DomEvent.on(el, "mouseenter", function () { cancelClose(id); });
    L.DomEvent.on(el, "mouseleave", function () { scheduleClose(id); });
  }

  /* Wires the featured-tier photo carousel's prev/next buttons and dots,
     once per popup element. Standard-tier popups have no .pop__carousel, so
     this is a no-op for them. */
  function bindCarousel(marker) {
    var el = marker.getPopup() && marker.getPopup().getElement();
    var carousel = el && el.querySelector(".pop__carousel");
    if (!carousel || carousel._chapterBound) return;
    carousel._chapterBound = true;

    var photos = carousel.querySelectorAll(".pop__photo");
    var dots = carousel.querySelectorAll(".pop__dot");

    function show(index) {
      var count = photos.length;
      index = ((index % count) + count) % count;
      photos.forEach(function (img, i) { img.classList.toggle("is-active", i === index); });
      dots.forEach(function (dot, i) { dot.classList.toggle("is-active", i === index); });
      carousel.dataset.index = String(index);
    }

    carousel.querySelectorAll(".pop__car-btn").forEach(function (btn) {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        show((parseInt(carousel.dataset.index, 10) || 0) + parseInt(btn.dataset.dir, 10));
      });
    });

    dots.forEach(function (dot, i) {
      dot.addEventListener("click", function (event) {
        event.stopPropagation();
        show(i);
      });
    });
  }

  function showCard(id, opts) {
    var marker = state.markers[id];
    if (!marker) return;
    cancelClose(id); // only this listing's own pending close, not any other's
    state.hoverId = id;
    /* Pan (instantly, not animated) *before* opening: Leaflet's own autoPan
       runs synchronously inside openPopup() against whatever view exists at
       that moment, so panning first lets it fit the popup — including a
       featured card's full carousel — against the final view instead of a
       stale one it then has to correct. */
    if (opts && opts.pan) map.panTo(marker.getLatLng(), { animate: false });
    marker.openPopup();
    bindPopupHoverKeepAlive(marker, id);
    bindCarousel(marker);
    syncActiveStyles();
  }

  function pinCard(id) {
    state.activeId = state.activeId === id ? null : id;
    if (state.activeId) {
      showCard(id, { pan: true });
    } else {
      var marker = state.markers[id];
      if (marker) marker.closePopup();
    }
    syncActiveStyles();
  }

  function syncActiveStyles() {
    Object.keys(state.markers).forEach(function (id) {
      var el = state.markers[id].getElement();
      if (!el) return;
      el.classList.toggle("is-active", id === state.activeId || id === state.hoverId);
    });

    document.querySelectorAll(".card").forEach(function (card) {
      card.classList.toggle("is-active", card.dataset.id === state.activeId);
    });
  }

  /* --------------------------- Filtering ------------------------ */

  function isVisible(listing) {
    if (!state.query) return true;
    var haystack = [listing.name, listing.blurb, listing.address].join(" ").toLowerCase();
    return haystack.indexOf(state.query) !== -1;
  }

  function applyFilters() {
    var visible = orderedListings().filter(isVisible);
    var visibleIds = new Set(visible.map(function (l) { return l.id; }));

    state.data.listings.forEach(function (listing) {
      var marker = state.markers[listing.id];
      if (!marker) return;
      if (visibleIds.has(listing.id)) {
        if (!map.hasLayer(marker)) marker.addTo(map);
      } else {
        if (state.activeId === listing.id) state.activeId = null;
        if (state.hoverId === listing.id) state.hoverId = null;
        map.removeLayer(marker);
      }
    });

    renderCards(visible);
    syncActiveStyles();
  }

  /* ---------------------------- Sidebar ------------------------- */

  function appendDivider(host, label) {
    var li = document.createElement("li");
    li.className = "cards__divider";
    li.textContent = label;
    host.appendChild(li);
  }

  function appendCard(host, listing) {
    var item = document.createElement("li");
    item.className = "card";
    item.dataset.id = listing.id;
    var badge = numberStyle(state.colors[listing.id]);
    item.style.setProperty("--card-color", badge.bg);
    item.style.setProperty("--card-ink", badge.fg);
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label",
      listing.name + ", number " + state.numbers[listing.id] +
      (listing.tier === "featured" ? ", featured listing" : "") + ". Show on the map.");

    item.innerHTML =
      '<span class="card__num" aria-hidden="true">' + state.numbers[listing.id] + "</span>" +
      '<span class="card__body">' +
        '<span class="card__name">' + esc(listing.name) + "</span>" +
        (listing.tier === "featured" ? '<span class="card__tag">Featured</span>' : "") +
      "</span>";

    item.addEventListener("mouseenter", function () { showCard(listing.id); });
    item.addEventListener("mouseleave", function () { scheduleClose(listing.id); });
    item.addEventListener("click", function () { pinCard(listing.id); });
    item.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pinCard(listing.id);
      }
    });

    host.appendChild(item);
  }

  /* Tier controls sort order: featured listings are grouped first (the
     divider is the visible reason why), alphabetical within each group. */
  function renderCards(listings) {
    var host = document.getElementById("cards");
    host.innerHTML = "";

    if (!listings.length) {
      var empty = document.createElement("li");
      empty.className = "cards__empty";
      empty.textContent = "No communities match that search.";
      host.appendChild(empty);
      return;
    }

    var featured = listings.filter(function (listing) { return listing.tier === "featured"; });
    var standard = listings.filter(function (listing) { return listing.tier !== "featured"; });

    if (featured.length) {
      appendDivider(host, "Featured");
      featured.forEach(function (listing) { appendCard(host, listing); });
    }
    if (standard.length) {
      if (featured.length) appendDivider(host, "More communities");
      standard.forEach(function (listing) { appendCard(host, listing); });
    }
  }

  /* ----------------------------- Boot --------------------------- */

  function buildMarkers() {
    state.data.listings.forEach(function (listing) {
      if (listing.tier !== "featured" && listing.tier !== "standard") {
        console.warn('Unknown tier "' + listing.tier + '" on ' + listing.name + "; treating as standard.");
      }

      var marker = L.marker(listing.coords, {
        icon: pinIcon(listing),
        title: listing.name,
        alt: listing.name,
        riseOnHover: true,
        keyboard: true
      });

      marker.bindPopup(popupHtml(listing), {
        className: "chapter-popup",
        closeButton: false,
        autoClose: false,
        closeOnClick: false,
        offset: [0, 0]
      });

      marker.on("mouseover", function () { showCard(listing.id); });
      marker.on("mouseout", function () { scheduleClose(listing.id); });
      marker.on("click", function () { pinCard(listing.id); });
      marker.on("keypress", function () { pinCard(listing.id); });
      marker.on("popupopen", function () {
        bindPopupHoverKeepAlive(marker, listing.id);
        bindCarousel(marker);
      });

      state.markers[listing.id] = marker;
      marker.addTo(map);
    });
  }

  /* ------------------------- "Your location" --------------------- */
  /* A free-text ZIP or address, geocoded via Nominatim — OpenStreetMap's
     public, key-free search endpoint, the same data source the map's own
     attribution already credits — and dropped as a marker so a viewer can
     see how it sits relative to the listings. Kept entirely separate from
     state.markers/state.data.listings: it isn't a listing, has no number,
     and nothing that iterates those (syncActiveStyles, applyFilters) should
     ever have to know it exists. */

  var userMarker = null;

  function geocode(query) {
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(query);
    return fetch(url, { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("That lookup failed (" + response.status + "). Try again in a moment.");
        return response.json();
      })
      .then(function (results) {
        if (!results || !results.length) {
          throw new Error("No match for that — try a fuller address or a 5-digit ZIP.");
        }
        var hit = results[0];
        return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), label: hit.display_name };
      });
  }

  function showUserLocation(lat, lng, label) {
    if (userMarker) map.removeLayer(userMarker);

    userMarker = L.marker([lat, lng], {
      icon: locationIcon(),
      title: "Your location",
      alt: "Your location",
      keyboard: true,
      zIndexOffset: 1000 // always above listing pins if the two ever overlap
    });

    userMarker.bindPopup(
      '<div class="pop"><p class="pop__ribbon">You are here</p><p class="pop__blurb">' + esc(label) + "</p></div>",
      { className: "chapter-popup", closeButton: false, autoClose: false, closeOnClick: false }
    );

    userMarker.addTo(map);
    map.panTo([lat, lng], { animate: true });
    userMarker.openPopup();
  }

  function clearUserLocation() {
    if (userMarker) {
      map.removeLayer(userMarker);
      userMarker = null;
    }
    var status = document.getElementById("locateStatus");
    status.hidden = true;
    status.textContent = "";
    document.getElementById("locateClear").hidden = true;
  }

  function wireLocate() {
    var form = document.getElementById("locateForm");
    var input = document.getElementById("locateInput");
    var status = document.getElementById("locateStatus");
    var clearBtn = document.getElementById("locateClear");

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var query = input.value.trim();
      if (!query) return;

      input.disabled = true;
      status.hidden = false;
      status.textContent = "Locating…";

      geocode(query)
        .then(function (result) {
          showUserLocation(result.lat, result.lng, result.label);
          status.textContent = "Located — see the map.";
          clearBtn.hidden = false;
        })
        .catch(function (err) {
          status.textContent = (err && err.message) || "Something went wrong looking that up.";
        })
        .then(function () {
          input.disabled = false; // runs either way — .then() after .catch() is this codebase's "finally"
        });
    });

    clearBtn.addEventListener("click", function () {
      clearUserLocation();
      input.value = "";
      input.focus();
    });
  }

  function hydrateChrome() {
    var meta = state.data.meta || {};
    var lead = document.getElementById("siteTitleLead");

    if (meta.titleLead) lead.textContent = meta.titleLead;
    else lead.remove();

    if (meta.title) document.getElementById("siteTitleMain").textContent = meta.title;

    var fullTitle = [meta.titleLead, meta.title].filter(Boolean).join(" ");
    if (fullTitle) document.title = fullTitle;

    if (meta.subtitle) document.getElementById("siteSubtitle").textContent = meta.subtitle;
    document.getElementById("sidebarNote").textContent =
      meta.attributionNote || "Hover a pin or a card to peek inside.";
  }

  function wireSearch() {
    document.getElementById("search").addEventListener("input", function (event) {
      state.query = event.target.value.trim().toLowerCase();
      applyFilters();
    });
  }

  function start(data) {
    state.data = data;
    var meta = data.meta || {};

    /* The opening view comes from meta.center/meta.zoom rather than fitting
       every pin: a single outlying listing could pull the view back and
       squash the Richmond cluster where most of the directory lives.
       Retune the opening view in the JSON, not in code. */
    map = L.map("map", {
      center: meta.center || [37.5407, -77.4360],
      zoom: meta.zoom || 11,
      scrollWheelZoom: true,
      zoomControl: true
    });

    addTiles();
    assignNumbers();
    assignColors();
    hydrateChrome();
    buildMarkers();
    renderCards(orderedListings());
    wireSearch();
    wireLocate();

    /* Clicking the map itself puts the pinned card away — and, separately,
       closes the "you are here" popup if it's open (the marker itself
       stays; only Clear removes that). */
    map.on("click", function () {
      if (state.activeId) {
        var marker = state.markers[state.activeId];
        state.activeId = null;
        if (marker) marker.closePopup();
        syncActiveStyles();
      }
      if (userMarker) userMarker.closePopup();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (state.activeId) {
        var marker = state.markers[state.activeId];
        state.activeId = null;
        if (marker) marker.closePopup();
        syncActiveStyles();
      }
      if (userMarker) userMarker.closePopup();
    });
  }

  function fail(error) {
    console.error(error);
    document.getElementById("map").innerHTML =
      '<p class="noscript">The directory couldn\'t load. 📖<br>' +
      "<small style='font-size:.8rem'>Serve this folder over HTTP so " +
      DATA_URL + " can load.</small></p>";
  }

  fetch(DATA_URL, { cache: "no-cache" })
    .then(function (response) {
      if (!response.ok) throw new Error("Failed to load " + DATA_URL + " (" + response.status + ")");
      return response.json();
    })
    .then(start)
    .catch(fail);
})();
