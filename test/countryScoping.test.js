const assert = require('node:assert');
const { test } = require('node:test');
const { buildGeocodeUrl, geocodeCacheKey } = require('../geocode');
const { nearbyCacheKey } = require('../placesService');

// --- geocoding receives the proper country code -----------------------------

test('buildGeocodeUrl hard-restricts to the selected country (components + region)', () => {
  const url = buildGeocodeUrl('Poprad', 'KEY', 'SK');
  assert.ok(url.includes('components=country:SK'));
  assert.ok(url.includes('region=sk'));
});

test('buildGeocodeUrl defaults to Poland when no country is given', () => {
  const url = buildGeocodeUrl('Zakopane', 'KEY');
  assert.ok(url.includes('components=country:PL'));
  assert.ok(url.includes('region=pl'));
});

test('buildGeocodeUrl falls back to Poland for an unsupported country code', () => {
  const url = buildGeocodeUrl('Praha', 'KEY', 'CZ');
  assert.ok(url.includes('components=country:PL'));
});

test('"Poprad" with Slovakia selected is never geocoded as Poland', () => {
  const url = buildGeocodeUrl('Poprad', 'KEY', 'SK');
  assert.ok(!url.includes('country:PL'));
  assert.ok(!url.includes('Polska'), 'the old ", Polska" text suffix must be gone');
});

test('UI language stays Polish regardless of the searched country', () => {
  assert.ok(buildGeocodeUrl('Eger', 'KEY', 'HU').includes('language=pl'));
});

// --- Unicode: Slovak and Hungarian diacritics --------------------------------

test('Slovak diacritics (Ždiar, Štrbské Pleso) survive URL building intact', () => {
  const url = buildGeocodeUrl('Ždiar', 'KEY', 'SK');
  assert.ok(url.includes(encodeURIComponent('Ždiar')));
  const url2 = buildGeocodeUrl('Štrbské Pleso', 'KEY', 'SK');
  assert.ok(url2.includes(encodeURIComponent('Štrbské Pleso')));
});

test('Hungarian diacritics (Hajdúszoboszló, ő/ű) survive URL building intact', () => {
  const url = buildGeocodeUrl('Hajdúszoboszló', 'KEY', 'HU');
  assert.ok(url.includes(encodeURIComponent('Hajdúszoboszló')));
  const url2 = buildGeocodeUrl('Hőgyész Őrség űrhajó', 'KEY', 'HU');
  assert.ok(url2.includes(encodeURIComponent('Hőgyész Őrség űrhajó')));
});

test('simplified spellings pass through unchanged - Google resolves them (verified live)', () => {
  // Verified against the live Geocoding API: "Strbske Pleso" -> Štrbské Pleso,
  // "Hajduszoboszlo" -> Hajdúszoboszló, "Budapeszt" -> Budapest. No manual
  // alias dictionary needed - the app just must not mangle the input.
  assert.ok(buildGeocodeUrl('Strbske Pleso', 'KEY', 'SK').includes('Strbske%20Pleso'));
  assert.ok(buildGeocodeUrl('Hajduszoboszlo', 'KEY', 'HU').includes('Hajduszoboszlo'));
});

// --- cache keys differ per country -------------------------------------------

test('geocode cache key differs for PL, SK and HU for the same query', () => {
  const keys = ['PL', 'SK', 'HU'].map((c) => geocodeCacheKey('Poprad', c));
  assert.strictEqual(new Set(keys).size, 3);
  assert.ok(keys[1].includes(':SK:'));
});

test('nearby cache key differs per country for the same coordinates and mode', () => {
  const center = { latitude: 49.05, longitude: 20.3 };
  const pl = nearbyCacheKey(center, 'food', 'PL');
  const sk = nearbyCacheKey(center, 'food', 'SK');
  assert.notStrictEqual(pl, sk);
  assert.ok(sk.startsWith('nearby:SK:food:'));
});
