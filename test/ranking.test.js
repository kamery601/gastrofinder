const assert = require('node:assert');
const { test } = require('node:test');
const { calculateScore, comparePlaces } = require('../ranking');

test('calculateScore rewards open and nearby places', () => {
  const openNear = {
    rating: 4.5,
    userRatingCount: 120,
    distanceKm: 0.5,
    priceLevel: 1,
    currentOpeningHours: { openNow: true }
  };
  const openFar = {
    rating: 4.5,
    userRatingCount: 120,
    distanceKm: 8.0,
    priceLevel: 1,
    currentOpeningHours: { openNow: true }
  };

  assert.ok(calculateScore(openNear) > calculateScore(openFar));
});

test('calculateScore penalizes expensive places', () => {
  const cheap = {
    rating: 4.2,
    userRatingCount: 80,
    distanceKm: 2.0,
    priceLevel: 1,
    currentOpeningHours: { openNow: true }
  };
  const expensive = {
    rating: 4.2,
    userRatingCount: 80,
    distanceKm: 2.0,
    priceLevel: 4,
    currentOpeningHours: { openNow: true }
  };

  assert.ok(calculateScore(cheap) > calculateScore(expensive));
});

test('comparePlaces sorts by distance when requested', () => {
  const a = { distanceKm: 1.2 };
  const b = { distanceKm: 3.4 };
  assert.ok(comparePlaces(a, b, 'distance') < 0, 'Closer place should sort before farther place');
});