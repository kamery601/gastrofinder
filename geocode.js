const fetch = require('node-fetch');
const { cached } = require('./cache');

const EXTERNAL_TIMEOUT_MS = 8000;

/**
 * Geocodes a Polish address via Google Geocoding API, cached for 10 minutes.
 * Resolves with Google's raw JSON (including `status` and `results`) for
 * ZERO_RESULTS / OK — callers should check `results.length`. Throws only for
 * hard failures: network/timeout, or a Google status indicating the request
 * itself is broken (quota, denied, invalid).
 * @param {string} address
 * @param {string} apiKey
 * @returns {Promise<{status: string, results: object[]}>}
 */
async function geocodeAddress(address, apiKey) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) throw new Error('Brak adresu do geokodowania');
  const cacheKey = `geocode:${normalized}`;

  return cached(cacheKey, 10 * 60 * 1000, async () => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}&language=pl`;

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

module.exports = { geocodeAddress };
