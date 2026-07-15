const assert = require('node:assert');
const { test } = require('node:test');
const { filterPlaces } = require('../filters');

function place(overrides = {}) {
  return {
    businessStatus: 'OPERATIONAL',
    displayName: { text: 'Test Place' },
    types: [],
    ...overrides
  };
}

test('food: accepts a plain restaurant', () => {
  const p = place({ types: ['restaurant'] });
  assert.strictEqual(filterPlaces([p], 'food').length, 1);
});

test('food: rejects restaurant with store type in REJECTED_FOOD (regression guard)', () => {
  const p = place({ types: ['restaurant', 'shopping_mall'] });
  assert.strictEqual(filterPlaces([p], 'food').length, 0);
});

test('food: does NOT reject a restaurant that also has a "store" type (fixed bug)', () => {
  const p = place({ types: ['restaurant', 'store'] });
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
