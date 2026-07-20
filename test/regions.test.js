const assert = require('node:assert');
const { test } = require('node:test');
const { REGIONS, getRegions, getRegion } = require('../public/regions');
const { COUNTRIES } = require('../public/countries');

test('every supported country has at least one tourist region configured', () => {
  for (const code of Object.keys(COUNTRIES)) {
    assert.ok(getRegions(code).length >= 1, `${code} has no regions`);
  }
});

test('regions exist only for supported countries', () => {
  for (const code of Object.keys(REGIONS)) {
    assert.ok(COUNTRIES[code], `regions configured for unsupported country ${code}`);
  }
});

test('every region has id, label and at least one place; every place has stable id, label and explicit query', () => {
  for (const [country, regions] of Object.entries(REGIONS)) {
    for (const region of regions) {
      assert.ok(region.id && region.label, `${country}: region missing id/label`);
      assert.ok(Array.isArray(region.places) && region.places.length >= 1, `${country}/${region.id}: no places`);
      for (const place of region.places) {
        assert.ok(place.id, `${country}/${region.id}: place missing id`);
        assert.ok(place.label, `${country}/${region.id}/${place.id}: missing label`);
        assert.ok(place.query, `${country}/${region.id}/${place.id}: missing explicit query`);
        assert.match(place.id, /^[a-z0-9-]+$/, `${country}/${region.id}/${place.id}: id must be stable kebab-case ASCII`);
      }
    }
  }
});

test('region ids are unique within a country and place ids are unique within a region', () => {
  for (const [country, regions] of Object.entries(REGIONS)) {
    const regionIds = regions.map((r) => r.id);
    assert.strictEqual(new Set(regionIds).size, regionIds.length, `${country}: duplicate region ids`);
    for (const region of regions) {
      const placeIds = region.places.map((p) => p.id);
      assert.strictEqual(new Set(placeIds).size, placeIds.length, `${country}/${region.id}: duplicate place ids`);
    }
  }
});

test('getRegions returns an empty array (never undefined) for unknown countries', () => {
  assert.deepStrictEqual(getRegions('DE'), []);
  assert.deepStrictEqual(getRegions(''), []);
  assert.deepStrictEqual(getRegions(null), []);
});

test('getRegion finds a region by id and returns null for misses', () => {
  const tatry = getRegion('SK', 'tatry-wysokie');
  assert.ok(tatry);
  assert.ok(tatry.places.some((p) => p.id === 'strbske-pleso'));
  assert.strictEqual(getRegion('SK', 'nope'), null);
  assert.strictEqual(getRegion('DE', 'tatry-wysokie'), null);
});

test('queries use the spellings verified against live Google Geocoding', () => {
  const sk = getRegion('SK', 'tatry-wysokie');
  const pleso = sk.places.find((p) => p.id === 'strbske-pleso');
  assert.strictEqual(pleso.query, 'Štrbské Pleso');
  const hu = getRegion('HU', 'termy-polnocny-wschod');
  const hajdu = hu.places.find((p) => p.id === 'hajduszoboszlo');
  assert.strictEqual(hajdu.query, 'Hajdúszoboszló');
});

test('Polish exonym labels stay separate from the Google query (label != query is allowed)', () => {
  const lomnica = getRegion('SK', 'tatry-wysokie').places.find((p) => p.id === 'tatranska-lomnica');
  assert.strictEqual(lomnica.label, 'Tatrzańska Łomnica');
  assert.strictEqual(lomnica.query, 'Tatranská Lomnica');
});
