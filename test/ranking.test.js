const assert = require('node:assert');
const { test } = require('node:test');
const { calculateScore, comparePlaces, distanceScore, pricePenalty, openBonus, valueScore } = require('../ranking');

test('calculateScore ignores distance and open status (pure quality, Bayesian)', () => {
  const near = { rating: 4.5, userRatingCount: 120, distanceKm: 0.5, currentOpeningHours: { openNow: true } };
  const far = { rating: 4.5, userRatingCount: 120, distanceKm: 8.0, currentOpeningHours: { openNow: false } };
  assert.strictEqual(calculateScore(near), calculateScore(far));
});

test('calculateScore rewards higher rating with enough votes', () => {
  const better = { rating: 4.8, userRatingCount: 500 };
  const worse = { rating: 3.5, userRatingCount: 500 };
  assert.ok(calculateScore(better) > calculateScore(worse));
});

test('calculateScore pulls low-vote places toward the global average', () => {
  const fewVotesHighRating = { rating: 5.0, userRatingCount: 2 };
  assert.ok(calculateScore(fewVotesHighRating) < 50, 'A 5.0 rating with only 2 votes should be pulled well below a max score');
});

test('comparePlaces sorts by distance when requested', () => {
  const a = { distanceKm: 1.2 };
  const b = { distanceKm: 3.4 };
  assert.ok(comparePlaces(a, b, 'distance') < 0, 'Closer place should sort before farther place');
});

test('comparePlaces sorts by price when requested', () => {
  const cheap = { priceLevel: 1 };
  const expensive = { priceLevel: 4 };
  assert.ok(comparePlaces(cheap, expensive, 'price') < 0, 'Cheaper place should sort before pricier place');
});

test('distanceScore rewards closer places', () => {
  assert.ok(distanceScore({ distanceKm: 0.3 }) > distanceScore({ distanceKm: 2.5 }));
});

test('pricePenalty penalizes expensive places', () => {
  assert.ok(pricePenalty({ priceLevel: 0 }) > pricePenalty({ priceLevel: 4 }));
});

test('openBonus rewards open places and penalizes closed ones', () => {
  assert.ok(openBonus({ currentOpeningHours: { openNow: true } }) > openBonus({ currentOpeningHours: { openNow: false } }));
});

test('valueScore rewards quality per price unit', () => {
  const cheapGood = { rating: 4.5, userRatingCount: 200, priceLevel: 1 };
  const expensiveGood = { rating: 4.5, userRatingCount: 200, priceLevel: 4 };
  assert.ok(valueScore(cheapGood) > valueScore(expensiveGood));
});
