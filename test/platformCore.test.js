const assert = require('node:assert');
const { test } = require('node:test');
const { DEFINITIONS, isEnabled, limit, snapshot } = require('../lib/flags');
const { MODULES, isModuleEnabled, moduleForLegacyMode, enabledModules } = require('../lib/modules');
const {
  implementsContract,
  createNullCatalog,
  createNullDynamicCache,
  CATALOG_METHODS,
  DYNAMIC_CACHE_METHODS,
  FIELD_GROUPS
} = require('../lib/contracts');

// --- flags: OFF state must equal the pre-platform baseline -------------------

test('every platform flag defaults to OFF (current production behavior)', () => {
  for (const [name, def] of Object.entries(DEFINITIONS)) {
    assert.strictEqual(def, false, `${name} must default to false`);
    assert.strictEqual(isEnabled(name, {}), false);
  }
});

test('flags read from env: 1/true/yes/on enable, anything else does not', () => {
  assert.strictEqual(isEnabled('MODE_AQUA_ENABLED', { MODE_AQUA_ENABLED: 'true' }), true);
  assert.strictEqual(isEnabled('MODE_AQUA_ENABLED', { MODE_AQUA_ENABLED: '1' }), true);
  assert.strictEqual(isEnabled('MODE_AQUA_ENABLED', { MODE_AQUA_ENABLED: 'false' }), false);
  assert.strictEqual(isEnabled('MODE_AQUA_ENABLED', { MODE_AQUA_ENABLED: 'banana' }), false);
});

test('unknown flags are never enabled - no typo can silently activate a feature', () => {
  assert.strictEqual(isEnabled('MODE_AQUA_ENABLED_TYPO', { MODE_AQUA_ENABLED_TYPO: 'true' }), false);
});

test('numeric limits fall back to safe defaults on garbage input', () => {
  assert.strictEqual(limit('GOOGLE_REQUEST_TIMEOUT_MS', {}), 8000);
  assert.strictEqual(limit('GOOGLE_REQUEST_TIMEOUT_MS', { GOOGLE_REQUEST_TIMEOUT_MS: 'abc' }), 8000);
  assert.strictEqual(limit('GOOGLE_REQUEST_TIMEOUT_MS', { GOOGLE_REQUEST_TIMEOUT_MS: '5000' }), 5000);
  assert.strictEqual(limit('GOOGLE_REQUEST_TIMEOUT_MS', { GOOGLE_REQUEST_TIMEOUT_MS: '-1' }), 8000);
});

test('snapshot lists every flag and limit for telemetry/admin', () => {
  const s = snapshot({});
  assert.strictEqual(Object.keys(s.flags).length, Object.keys(DEFINITIONS).length);
  assert.ok(s.limits.MAX_GOOGLE_CALLS_PER_USER_SEARCH > 0);
});

// --- modules registry --------------------------------------------------------

test('baseline modules FOOD/BARS/SHOPS are live and never flag-gated', () => {
  for (const id of ['FOOD', 'BARS', 'SHOPS']) {
    assert.strictEqual(isModuleEnabled(id, {}), true, `${id} must be live with no flags`);
  }
});

test('AQUA/ATTRACTIONS/STAYS are OFF by default and controlled by their flags', () => {
  for (const id of ['AQUA', 'ATTRACTIONS', 'STAYS']) {
    assert.strictEqual(isModuleEnabled(id, {}), false, `${id} must be off by default`);
  }
  assert.strictEqual(isModuleEnabled('AQUA', { MODE_AQUA_ENABLED: 'true' }), true);
  assert.strictEqual(isModuleEnabled('STAYS', { MODE_STAYS_ENABLED: 'true' }), true);
});

test('legacy mode names map to platform modules without renaming production modes', () => {
  assert.strictEqual(moduleForLegacyMode('food').id, 'FOOD');
  assert.strictEqual(moduleForLegacyMode('clubs').id, 'BARS');
  assert.strictEqual(moduleForLegacyMode('shops24').id, 'SHOPS');
  assert.strictEqual(moduleForLegacyMode('nonsense'), null);
});

test('enabledModules with no env returns exactly the three live modules', () => {
  assert.deepStrictEqual(enabledModules({}).map((m) => m.id), ['FOOD', 'BARS', 'SHOPS']);
});

test('AQUA search radius is wider than gastronomy - people travel farther for thermal baths', () => {
  assert.ok(MODULES.AQUA.searchRadiusMeters > MODULES.FOOD.searchRadiusMeters);
});

// --- contracts and the Null (fallback) implementations ----------------------

test('Null catalog satisfies the PlaceCatalog contract and reports unavailable', async () => {
  const catalog = createNullCatalog();
  assert.ok(implementsContract(catalog, CATALOG_METHODS));
  assert.strictEqual(catalog.isAvailable(), false);
  assert.deepStrictEqual(await catalog.getKnownPlaceIds({ country: 'PL' }), []);
  assert.deepStrictEqual(await catalog.upsertObservation({ googlePlaceId: 'x' }), { inserted: false });
});

test('Null dynamic cache always misses and never throws on writes', async () => {
  const cache = createNullDynamicCache();
  assert.ok(implementsContract(cache, DYNAMIC_CACHE_METHODS));
  assert.strictEqual(await cache.get('place-1', 'OPENING_HOURS'), null);
  await cache.put('place-1', 'OPENING_HOURS', {}, 1000, {});
});

test('field groups cover the documented dynamic-data classes', () => {
  for (const g of ['SUMMARY', 'OPENING_HOURS', 'BUSINESS_STATUS', 'RATING', 'CONTACT', 'PHOTOS', 'REVIEWS_SAMPLE']) {
    assert.ok(FIELD_GROUPS.includes(g), `${g} missing`);
  }
});
