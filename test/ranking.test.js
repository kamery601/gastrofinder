const assert = require('node:assert');
const { test } = require('node:test');
const { calculateScore, comparePlaces, valueScore, reviewConfidence, isUnreliablyLowRated, rankingScore } = require('../ranking');

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

test('valueScore rewards quality per price unit', () => {
  const cheapGood = { rating: 4.5, userRatingCount: 200, priceLevel: 1 };
  const expensiveGood = { rating: 4.5, userRatingCount: 200, priceLevel: 4 };
  assert.ok(valueScore(cheapGood) > valueScore(expensiveGood));
});

// --- Faza 3 / Faza 8: review confidence and honest "Najlepsze" ranking -----

test('5.0 with 3 reviews does not outrank 4.7 with 3000 reviews', () => {
  const tinyPerfect = { rating: 5.0, userRatingCount: 3 };
  const establishedGreat = { rating: 4.7, userRatingCount: 3000 };
  assert.ok(calculateScore(establishedGreat) > calculateScore(tinyPerfect));
});

test('4.9 with 300 reviews can genuinely outrank 4.7 with 3000, when the score says so', () => {
  const veryGood = { rating: 4.9, userRatingCount: 300 };
  const great = { rating: 4.7, userRatingCount: 3000 };
  assert.ok(calculateScore(veryGood) > calculateScore(great));
});

test('reviewConfidence buckets: no data, very low, low, established', () => {
  assert.strictEqual(reviewConfidence({ rating: null, userRatingCount: 0 }), 'no_data');
  assert.strictEqual(reviewConfidence({ userRatingCount: 0 }), 'no_data');
  assert.strictEqual(reviewConfidence({ rating: 4.5, userRatingCount: 5 }), 'very_low');
  assert.strictEqual(reviewConfidence({ rating: 4.5, userRatingCount: 30 }), 'low');
  assert.strictEqual(reviewConfidence({ rating: 4.5, userRatingCount: 500 }), 'established');
});

test('reviewConfidence never throws when rating is missing', () => {
  assert.doesNotThrow(() => reviewConfidence({}));
  assert.strictEqual(reviewConfidence({}), 'no_data');
});

test('isUnreliablyLowRated: 2.4/100 reviews is unreliable-low, small samples are not judged as such', () => {
  assert.strictEqual(isUnreliablyLowRated({ rating: 2.4, userRatingCount: 100 }), true);
  assert.strictEqual(isUnreliablyLowRated({ rating: 1.0, userRatingCount: 1 }), false, 'a single bad review in a small town should not be nuked as "unreliable-low"');
  assert.strictEqual(isUnreliablyLowRated({ rating: 4.8, userRatingCount: 500 }), false);
});

test('rankingScore sinks a reliably-low-rated place below every genuine score, without erroring', () => {
  const badButReliable = { rating: 2.4, userRatingCount: 100 };
  const worstGenuine = { rating: 1.0, userRatingCount: 1 };
  assert.ok(rankingScore(badButReliable) < rankingScore(worstGenuine), 'the reliably-bad place must sort after even a genuinely low, small-sample place');
});

test('rankingScore does not throw and does not sink a place with a missing rating', () => {
  assert.doesNotThrow(() => rankingScore({}));
  assert.strictEqual(rankingScore({}), calculateScore({}));
});

test('comparePlaces distance sort is unaffected by the low-rating sink', () => {
  const badButReliableAndClose = { rating: 2.0, userRatingCount: 50, distanceKm: 0.2 };
  const greatButFar = { rating: 4.9, userRatingCount: 3000, distanceKm: 5.0 };
  assert.ok(comparePlaces(badButReliableAndClose, greatButFar, 'distance') < 0, 'Najbliższe must still be pure distance, regardless of rating reliability');
});
