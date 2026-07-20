const fetch = require('node-fetch');
const { cached } = require('./cache');
const { normalizeCountry } = require('./public/countries');

const EXTERNAL_TIMEOUT_MS = 8000;

/**
 * Builds the Google Geocoding request URL for an address scoped to a country.
 * - `components=country:XX` is a HARD restriction: "Poprad" with SK never
 *   resolves to a Polish or Czech place.
 * - `region` adds bias consistent with the restriction.
 * - `language=pl` is the UI language (formatted_address shows "Słowacja",
 *   "Węgry"), independent of the searched country.
 * Exported separately so tests can verify country scoping and Unicode handling
 * without network access.
 * @param {string} address
 * @param {string} apiKey
 * @param {string} countryCode - ISO code, normalized to a supported country (default PL)
 * @returns {string}
 */
function buildGeocodeUrl(address, apiKey, countryCode) {
  const country = normalizeCountry(countryCode);
  return 'https://maps.googleapis.com/maps/api/geocode/json' +
    `?address=${encodeURIComponent(address)}` +
    `&components=country:${country}` +
    `&region=${country.toLowerCase()}` +
    `&key=${apiKey}&language=pl`;
}

/**
 * Geocodes an address via Google Geocoding API within the given country,
 * cached for 10 minutes per (country, normalized address) - the country is part
 * of the cache key so "Poprad" in SK and a hypothetical "Poprad" in PL never
 * collide. Resolves with Google's raw JSON (including `status` and `results`)
 * for ZERO_RESULTS / OK - callers should check `results.length`. Throws only
 * for hard failures: network/timeout, or a Google status indicating the
 * request itself is broken (quota, denied, invalid).
 * @param {string} address
 * @param {string} apiKey
 * @param {string} [countryCode] - defaults to PL via normalizeCountry
 * @returns {Promise<{status: string, results: object[]}>}
 */
async function geocodeAddress(address, apiKey, countryCode) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) throw new Error('Brak adresu do geokodowania');
  const country = normalizeCountry(countryCode);
  const cacheKey = `geocode:${country}:${normalized}`;

  return cached(cacheKey, 10 * 60 * 1000, async () => {
    const url = buildGeocodeUrl(address, apiKey, country);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error('Przekroczono czas oczekiwania na Google Geocoding API');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }

    const json = await res.json();

    if (json.status === 'OVER_QUERY_LIMIT' || json.status === 'RESOURCE_EXHAUSTED') {
      throw new Error('QUOTA_EXCEEDED');
    }
    if (json.status && json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
      throw new Error(json.error_message || `Geocoding nie powiodło się (${json.status})`);
    }

    return json;
  });
}

module.exports = { geocodeAddress, buildGeocodeUrl };
