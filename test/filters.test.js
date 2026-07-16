const assert = require('node:assert');
const { test } = require('node:test');
const { filterPlaces, classifyFoodPlace, classifyAndSummarize } = require('../filters');

function place(overrides = {}) {
  return {
    businessStatus: 'OPERATIONAL',
    displayName: { text: 'Test Place' },
    types: [],
    ...overrides
  };
}

function accepted(p) {
  return classifyFoodPlace(p).accepted;
}

// --- Faza 2 / Faza 8 required regression cases -----------------------------

test('food: "Stacja paliw bp" mislabeled as cafe is rejected (fuel_station)', () => {
  const p = place({ types: ['cafe', 'gas_station'], displayName: { text: 'Stacja paliw bp' } });
  const result = classifyFoodPlace(p);
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.reason, 'fuel_station');
});

test('food: bare "bp" name is rejected even with only a cafe type', () => {
  const p = place({ types: ['cafe'], displayName: { text: 'bp' } });
  assert.strictEqual(accepted(p), false);
});

test('food: "Kaufland Kraków-Prądnik Biały" mislabeled as bakery is rejected (grocery_store)', () => {
  const p = place({ types: ['bakery'], displayName: { text: 'Kaufland Kraków-Prądnik Biały' } });
  const result = classifyFoodPlace(p);
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.reason, 'grocery_store');
});

test('food: "SKLEP SPOŻYWCZY GAMA" mislabeled as bakery is rejected', () => {
  const p = place({ types: ['bakery'], displayName: { text: 'SKLEP SPOŻYWCZY GAMA' } });
  assert.strictEqual(accepted(p), false);
});

test('food: "Lewiatan" mislabeled as bakery is rejected', () => {
  const p = place({ types: ['bakery'], displayName: { text: 'Lewiatan' } });
  assert.strictEqual(accepted(p), false);
});

test('food: whole shopping mall mislabeled as cafe is rejected (shopping_mall_whole)', () => {
  const p = place({ types: ['cafe', 'shopping_mall'], displayName: { text: 'Galeria Krakowska' } });
  const result = classifyFoodPlace(p);
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.reason, 'shopping_mall_whole');
});

test('food: a real cafe inside a mall (own name) is accepted despite shopping_mall type', () => {
  const p = place({ types: ['cafe', 'shopping_mall'], displayName: { text: 'Costa Coffee Galeria Krakowska' } });
  assert.strictEqual(accepted(p), true);
});

test('food: independent restaurant with an additional store type is accepted', () => {
  const p = place({ types: ['restaurant', 'store'] });
  assert.strictEqual(accepted(p), true);
});

test('food: pizzeria with an additional store type is accepted', () => {
  const p = place({ types: ['pizza_restaurant', 'store'], displayName: { text: 'Pizzeria Napoli' } });
  assert.strictEqual(accepted(p), true);
});

test('food: hotel restaurant with its own distinct name is accepted', () => {
  const p = place({ types: ['restaurant', 'lodging'], displayName: { text: 'Restauracja Villa Verde' } });
  assert.strictEqual(accepted(p), true);
});

test('food: a plain hotel with no separate gastronomy identity is rejected', () => {
  const p = place({ types: ['restaurant', 'lodging'], displayName: { text: 'Hotel Górski' } });
  const result = classifyFoodPlace(p);
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.reason, 'lodging_without_restaurant');
});

test('food: amusement center / play area without separate gastronomy is rejected', () => {
  const p = place({ types: ['cafe', 'amusement_center'], displayName: { text: 'Sala Zabaw Fikolek' } });
  assert.strictEqual(accepted(p), false);
});

test('food: accepts a plain restaurant', () => {
  const p = place({ types: ['restaurant'] });
  assert.strictEqual(filterPlaces([p], 'food').length, 1);
});

test('food: excludes chain convenience stores by name, whole-word match', () => {
  const p = place({ types: ['restaurant'], displayName: { text: 'Żabka Express' } });
  assert.strictEqual(filterPlaces([p], 'food').length, 0);
});

test('food: does not false-positive on names merely containing the chain substring', () => {
  const p = place({ types: ['restaurant'], displayName: { text: 'Żabkarium Bistro' } });
  assert.strictEqual(filterPlaces([p], 'food').length, 1);
});

test('food: rejects non-operational places', () => {
  const p = place({ types: ['restaurant'], businessStatus: 'CLOSED_PERMANENTLY' });
  assert.strictEqual(filterPlaces([p], 'food').length, 0);
});

test('food: rejects a place with no food-ish type at all', () => {
  const p = place({ types: ['point_of_interest', 'establishment'] });
  assert.strictEqual(accepted(p), false);
});

// --- clubs / shops24: unchanged behavior, still covered -------------------

test('clubs: accepts a night_club that also carries a bar type', () => {
  const p = place({ types: ['night_club', 'bar'] });
  assert.strictEqual(filterPlaces([p], 'clubs').length, 1);
});

test('clubs: accepts a live_music_venue', () => {
  const p = place({ types: ['live_music_venue'] });
  assert.strictEqual(filterPlaces([p], 'clubs').length, 1);
});

test('clubs: rejects a plain restaurant', () => {
  const p = place({ types: ['restaurant'] });
  assert.strictEqual(filterPlaces([p], 'clubs').length, 0);
});

test('clubs: rejects a night_club that is actually a restaurant with occasional DJ nights', () => {
  const p = place({ types: ['night_club', 'restaurant'] });
  assert.strictEqual(filterPlaces([p], 'clubs').length, 0);
});

test('shops24: accepts a convenience store', () => {
  const p = place({ types: ['convenience_store'] });
  assert.strictEqual(filterPlaces([p], 'shops24').length, 1);
});

test('shops24: rejects a hotel gift shop typed as convenience_store + lodging', () => {
  const p = place({ types: ['convenience_store', 'hotel'] });
  assert.strictEqual(filterPlaces([p], 'shops24').length, 0);
});

// --- Faza 7: aggregated rejection logging (no per-place details) -----------

test('classifyAndSummarize tallies rejection reasons in aggregate, without per-place data', () => {
  const places = [
    place({ types: ['cafe'], displayName: { text: 'bp' } }),
    place({ types: ['bakery'], displayName: { text: 'Kaufland' } }),
    place({ types: ['bakery'], displayName: { text: 'Lewiatan' } }),
    place({ types: ['restaurant'] })
  ];
  const { accepted, rejectedReasons, total } = classifyAndSummarize(places, 'food');
  assert.strictEqual(total, 4);
  assert.strictEqual(accepted.length, 1);
  assert.strictEqual(rejectedReasons.fuel_station, 1);
  assert.strictEqual(rejectedReasons.grocery_store, 2);
});
