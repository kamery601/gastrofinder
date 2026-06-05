const assert = require('node:assert');
const { test } = require('node:test');
const { calculateDistanceKm } = require('../distance');

test('calculateDistanceKm returns 0 for identical coordinates', () => {
  const a = { latitude: 50.0619, longitude: 19.9366 };
  const b = { lat: 50.0619, lng: 19.9366 };
  assert.strictEqual(calculateDistanceKm(a, b), 0.0);
});

test('calculateDistanceKm returns a positive number for nearby points', () => {
  const a = { latitude: 50.0619, longitude: 19.9366 };
  const b = { lat: 50.0680, lng: 19.9440 };
  const distance = calculateDistanceKm(a, b);
  assert.ok(distance > 0, 'Distance should be positive');
  assert.ok(distance < 3, 'Distance should be below 3 km for nearby points');
});

test('calculateDistanceKm returns null for invalid coordinates', () => {
  assert.strictEqual(calculateDistanceKm(null, null), null);
});