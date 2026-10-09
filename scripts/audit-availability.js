#!/usr/bin/env node
// Availability audit: are the places GastroFinder recommends actually running?
//
// Audits EXACTLY what a user sees: the lists come from the production
// /api/nearby endpoint (same filters, same ranking). For every listed place it
// then fetches the newest Google reviews (dates only are used), measures the
// distance to the nearest ski lift (report only), and classifies the place with
// lib/availability-checks.js (INACTIVE / WINTER_SEASONAL / DORMANT / ...).
// With --write-checks it produces the file the server applies to searches.
//
// Usage:
//   GOOGLE_API_KEY=... node scripts/audit-availability.js \
//     --cache /path/details-cache.json --out /path/report.json \
//     [--write-checks data/availability-checks.json] \
//     [--base https://gastrofinder-production.up.railway.app]
//
// Cost control: Place Details responses are cached on disk (--cache), so
// re-running the audit does not call Google again for known places. Review
// TEXTS are never written anywhere - only their dates and ratings are kept.

const fs = require('node:fs');
const { classifyActivity, buildChecksFile } = require('../lib/availability-checks');

const LOCALITIES = [
  { name: 'Zakopane', query: 'Zakopane' },
  { name: 'Kościelisko', query: 'Kościelisko' },
  { name: 'Poronin', query: 'Poronin' },
  { name: 'Bukowina Tatrzańska', query: 'Bukowina Tatrzańska' },
  { name: 'Białka Tatrzańska', query: 'Białka Tatrzańska' }
];
const MODES = ['food', 'clubs'];
const SKI_NEAR_METERS = 400;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const API_KEY = process.env.GOOGLE_API_KEY;
const BASE = arg('base', 'https://gastrofinder-production.up.railway.app');
const CACHE_PATH = arg('cache', null);
const OUT_PATH = arg('out', null);
const CHECKS_OUT = arg('write-checks', null);
const NOW = new Date();

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, init) {
  const res = await fetch(url, init);
  return res.json();
}

async function appSearch(query, mode) {
  const geo = await getJson(`${BASE}/api/geocode?address=${encodeURIComponent(query)}&country=PL`);
  const loc = geo.results && geo.results[0] && geo.results[0].geometry.location;
  if (!loc) throw new Error(`geocode failed for ${query}: ${JSON.stringify(geo).slice(0, 120)}`);
  const near = await getJson(`${BASE}/api/nearby?location=${loc.lat},${loc.lng}&mode=${mode}&country=PL`);
  if (!near.places) throw new Error(`nearby failed for ${query}/${mode}: ${JSON.stringify(near).slice(0, 120)}`);
  return { center: loc, places: near.places };
}

async function skiLifts(center) {
  const out = [];
  for (const rankPreference of ['POPULARITY', 'DISTANCE']) {
    const d = await getJson('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location'
      },
      body: JSON.stringify({
        includedTypes: ['ski_resort'],
        maxResultCount: 20,
        rankPreference,
        locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: 8000 } }
      })
    });
    for (const p of d.places || []) {
      out.push({ id: p.id, name: p.displayName.text, lat: p.location.latitude, lng: p.location.longitude });
    }
  }
  return out;
}

async function placeDetails(placeId, cache) {
  if (cache[placeId]) return cache[placeId];
  const url = 'https://maps.googleapis.com/maps/api/place/details/json' +
    `?place_id=${encodeURIComponent(placeId)}` +
    '&fields=name,business_status,user_ratings_total,reviews' +
    `&reviews_sort=newest&language=pl&key=${API_KEY}`;
  const d = await getJson(url);
  // A blocked key (billing off, quota) must abort the whole run - otherwise
  // every place would look review-less and the verdicts would be silently
  // wiped. NOT_FOUND is per-place (listing removed) and is fine.
  if (d.status !== 'OK' && d.status !== 'NOT_FOUND') {
    throw new Error(`Google Place Details ${d.status}: ${d.error_message || 'no message'}`);
  }
  const r = d.result || {};
  const entry = {
    status: d.status,
    name: r.name || null,
    businessStatus: r.business_status || null,
    totalReviews: r.user_ratings_total || 0,
    // dates + ratings only; review texts are deliberately not kept
    reviews: (r.reviews || []).map((rv) => ({ date: new Date(rv.time * 1000).toISOString().slice(0, 10), rating: rv.rating }))
  };
  cache[placeId] = entry;
  return entry;
}

// Ski lift proximity is reported for human review only - Google's
// ski_resort type also tags ski schools, rentals and even a sushi bar, so the
// noisy entries are dropped here and proximity never drives a verdict.
const LIFT_NAME = /(wyci[aą]g|stacja narciar|o[sś]rodek narciar|kolej|kanap|gondol|lift|stok|ski\b|kotelnica|bania|gubałówka|kasprowy|nosal|polana szymoszkowa|harenda)/i;
const NOT_A_LIFT = /(szkoła|szkola|school|wypo[zż]ycz|rental|serwis|tuning|sklep|shop|sushi|hotel|apartament)/i;

async function main() {
  if (!API_KEY) { console.error('GOOGLE_API_KEY required'); process.exit(1); }
  const cache = CACHE_PATH && fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : {};

  const byId = new Map();
  const lifts = new Map();
  for (const loc of LOCALITIES) {
    for (const mode of MODES) {
      const { center, places } = await appSearch(loc.query, mode);
      for (const p of places) {
        const existing = byId.get(p.id);
        if (existing) { existing.localities.add(loc.name); existing.modes.add(mode); continue; }
        byId.set(p.id, {
          id: p.id,
          name: p.displayName && p.displayName.text,
          address: p.formattedAddress,
          lat: p.location && p.location.latitude,
          lng: p.location && p.location.longitude,
          rating: p.rating || null,
          userRatingCount: p.userRatingCount || 0,
          types: p.types || [],
          googleOpenNow: p.currentOpeningHours ? p.currentOpeningHours.openNow : null,
          localities: new Set([loc.name]),
          modes: new Set([mode])
        });
      }
      await sleep(1500); // stay well under the app's 30 req/min limiter
      if (mode === 'food') {
        for (const l of await skiLifts(center)) {
        if (LIFT_NAME.test(l.name) && !NOT_A_LIFT.test(l.name)) lifts.set(l.id, l);
      }
      }
    }
  }

  // Hidden places never appear in the production lists again, so without this
  // a monthly run would silently drop their verdicts and dead listings would
  // come back. Every previously flagged place is re-checked by its ID.
  if (CHECKS_OUT && fs.existsSync(CHECKS_OUT)) {
    const previous = JSON.parse(fs.readFileSync(CHECKS_OUT, 'utf8')).checks || {};
    for (const id of Object.keys(previous)) {
      if (!byId.has(id)) {
        byId.set(id, { id, name: null, lat: null, lng: null, localities: new Set(['(wcześniej oznaczony)']), modes: new Set() });
      }
    }
  }

  // Sanity guard: broken lists must not overwrite good verdicts.
  if (byId.size < 100) {
    throw new Error(`only ${byId.size} places collected - refusing to write checks`);
  }

  const liftList = [...lifts.values()];
  const rows = [];
  let i = 0;
  for (const place of byId.values()) {
    i += 1;
    const details = await placeDetails(place.id, cache);
    if (!place.name) place.name = details.name;
    let nearest = null;
    for (const l of (place.lat == null ? [] : liftList)) {
      const m = haversineMeters({ lat: place.lat, lng: place.lng }, l);
      if (nearest === null || m < nearest.m) nearest = { m, name: l.name };
    }
    const c = classifyActivity({
      businessStatus: details.businessStatus,
      totalReviews: details.totalReviews,
      reviewDates: details.reviews.map((r) => r.date)
    }, NOW);
    rows.push({
      ...place,
      localities: [...place.localities],
      modes: [...place.modes],
      businessStatus: details.businessStatus,
      totalReviews: details.totalReviews,
      reviewDates: details.reviews.map((r) => r.date),
      nearestLift: nearest,
      ...c
    });
    if (i % 25 === 0) process.stderr.write(`  ${i}/${byId.size}\n`);
  }

  if (CACHE_PATH) fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  const report = { generatedAt: NOW.toISOString(), localities: LOCALITIES.map((l) => l.name), lifts: liftList.length, places: rows };
  if (OUT_PATH) fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  if (CHECKS_OUT) {
    const file = buildChecksFile(rows.map((r) => ({ placeId: r.id, verdict: r.verdict, reason: r.reason })), NOW);
    fs.writeFileSync(CHECKS_OUT, JSON.stringify(file, null, 2) + '\n');
    console.log(`checks written: ${Object.keys(file.checks).length} -> ${CHECKS_OUT}`);
  }

  const counts = {};
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  console.log(`places audited: ${rows.length}, ski lifts known: ${liftList.length}`);
  console.log('verdicts:', JSON.stringify(counts));
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
