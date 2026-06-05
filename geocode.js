const fetch = require('node-fetch');
const { cached } = require('./cache');

async function geocodeAddress(address, apiKey) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) throw new Error('Brak adresu do geokodowania');
  const cacheKey = `geocode:${normalized}`;

  return cached(cacheKey, 10 * 60 * 1000, async () => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}&language=pl`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.error_message) {
      throw new Error(json.error_message);
    }
    return json;
  });
}

module.exports = { geocodeAddress };
