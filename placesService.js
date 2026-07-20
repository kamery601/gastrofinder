const fetch = require('node-fetch');
const { cached } = require('./cache');
const { calculateDistanceKm } = require('./distance');
const logger = require('./logger');

const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.types,places.currentOpeningHours,places.regularOpeningHours,places.businessStatus,places.googleMapsUri,places.location';

const EXTERNAL_TIMEOUT_MS = 8000;

const PRICE_LEVEL_MAP = {
  PRICE_LEVEL_UNSPECIFIED: null,
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4
};

/**
 * Google Places API (New) returns priceLevel as a string enum (e.g. "PRICE_LEVEL_MODERATE").
 * Normalizes it to a plain 0-4 number (or null when unknown) for ranking/display.
 * @param {string|number|null|undefined} raw
 * @returns {number|null}
 */
function normalizePriceLevel(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  const v = PRICE_LEVEL_MAP[raw];
  return v !== undefined ? v : null;
}

const SEARCH_CONFIG = {
  food: {
    includedTypes: ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway', 'meal_delivery', 'coffee_shop', 'fast_food_restaurant', 'pizza_restaurant', 'kebab_shop'],
    excludedTypes: ['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house','shopping_mall','movie_theater','tourist_attraction','museum','park','gym','school','university','spa','casino']
  },
  clubs: {
    includedTypes: ['night_club', 'live_music_venue'],
    excludedTypes: ['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house']
  },
  shops24: {
    includedTypes: ['convenience_store', 'supermarket', 'grocery_store', 'gas_station', 'pharmacy'],
    excludedTypes: ['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house']
  }
};

// searchNearby returns AT MOST 20 places per request, with no pagination. In a
// dense area (Zakopane, Kraków) a single POPULARITY-ranked query per type
// systematically hides new/small places that don't crack the type's top-20 by
// review volume (confirmed with "Vamos Pizza Express": absent under POPULARITY,
// present under DISTANCE). Querying each type under BOTH rankings and merging
// by place.id recovers them — popular-but-farther AND nearby-but-new.
const RANK_PREFERENCES = ['POPULARITY', 'DISTANCE'];

// Safety cap on the merged result set. Calibrated ABOVE what the densest real
// cities produce today (Kraków and Warszawa centre both plateau at 280 after
// dedup; Zakopane 178), so it never truncates legitimate results now - it only
// guards against a future Google limit increase or strategy change ballooning
// a single search. The "capped" flag in the coverage log shows if it ever fires.
const MAX_PLACES = 300;

/**
 * Fetches places of a single Google type via searchNearby, with an 8s hard timeout.
 * Throws on both Google API errors and network/timeout failures — caller decides
 * whether a single failed request should sink the whole result (see getNearbyPlaces).
 * @returns {Promise<object[]>}
 */
async function fetchPlaces(center, type, excludedTypes, apiKey, rankPreference) {
  const body = {
    includedTypes: [type],
    maxResultCount: 20,
    locationRestriction: { circle: { center, radius: 3000.0 } },
    rankPreference
  };
  if (excludedTypes.length) body.excludedTypes = excludedTypes;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);

  let res;
  try {
    res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Przekroczono czas oczekiwania na Google Places API (typ: ${type})`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  const json = await res.json();
  if (json.error) {
    const status = json.error.status || '';
    if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') {
      throw new Error('QUOTA_EXCEEDED');
    }
    throw new Error(json.error.message || JSON.stringify(json.error));
  }
  return json.places || [];
}

/**
 * Fetches and merges places across all included types for a mode, deduplicated by place.id.
 * Uses Promise.allSettled so that one failing type (timeout, quota, transient error)
 * doesn't discard results from the other types — failures are logged and skipped.
 * Throws only if EVERY type request failed (nothing to return).
 * Results are cached for 10 minutes per (mode, rounded center).
 * @returns {Promise<object[]>}
 */
async function getNearbyPlaces(center, mode, apiKey, country = 'PL') {
  const config = SEARCH_CONFIG[mode] || SEARCH_CONFIG.food;
  // Coordinates already imply the country for the Google query itself; the
  // country in the key keeps results of different country contexts separate
  // and lets the coverage telemetry attribute searches per country.
  const cacheKey = `nearby:${country}:${mode}:${center.latitude.toFixed(5)}:${center.longitude.toFixed(5)}`;

  return cached(cacheKey, 10 * 60 * 1000, async () => {
    const requests = [];
    for (const type of config.includedTypes) {
      for (const rankPreference of RANK_PREFERENCES) {
        requests.push({ type, rankPreference });
      }
    }

    const settled = await Promise.allSettled(
      requests.map(({ type, rankPreference }) =>
        fetchPlaces(center, type, config.excludedTypes, apiKey, rankPreference))
    );

    const batches = [];
    const rawCountByRank = {};
    let quotaExceeded = false;
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        batches.push(outcome.value);
        const rank = requests[i].rankPreference;
        rawCountByRank[rank] = (rawCountByRank[rank] || 0) + outcome.value.length;
      } else {
        const reason = outcome.reason?.message || String(outcome.reason);
        if (reason === 'QUOTA_EXCEEDED') quotaExceeded = true;
        logger.warn('placesService', `fetchPlaces failed for type "${requests[i].type}" (${requests[i].rankPreference})`, { reason });
      }
    });

    if (batches.length === 0 && settled.length > 0) {
      throw new Error(quotaExceeded ? 'QUOTA_EXCEEDED' : 'Nie udało się pobrać żadnych wyników z Google Places API');
    }

    const seen = new Set();
    const results = [];
    for (const places of batches) {
      for (const place of places) {
        if (place.id && !seen.has(place.id)) {
          seen.add(place.id);
          if (place.location) {
            const distanceKm = calculateDistanceKm(center, place.location);
            if (distanceKm !== null) place.distanceKm = distanceKm;
          }
          place.priceLevel = normalizePriceLevel(place.priceLevel);
          results.push(place);
        }
      }
    }

    const totalRaw = Object.values(rawCountByRank).reduce((a, b) => a + b, 0);
    const capped = results.length > MAX_PLACES;
    if (capped) results.length = MAX_PLACES;

    // Search-quality telemetry (logs only, never shown to users): how many
    // records each ranking contributed, how many survived dedup, and whether
    // the safety cap kicked in - the numbers to watch after the dual-rank change.
    logger.info('placesService', `${mode}: search coverage`, {
      country,
      byRank: rawCountByRank,
      totalRaw,
      afterDedup: results.length,
      capped
    });

    return results;
  });
}

module.exports = { getNearbyPlaces };
