// Bayesian Average ranking - uczciwe porownanie lokali z rozna liczba opinii
// Wzor: score = (v/(v+m)) * R + (m/(v+m)) * C

const GLOBAL_AVERAGE = 4.3;
const MIN_VOTES = 100;

/**
 * Bayesian Average: pulls a place's rating toward the global average when it
 * has few votes, so a 5.0 from 2 reviews doesn't outrank a 4.6 from 2000.
 * @param {number} rating - place's raw average rating (0-5)
 * @param {number} count - number of ratings behind it
 * @returns {number} adjusted score, same 0-5 scale as `rating`
 */
function bayesianScore(rating, count) {
  const R = typeof rating === 'number' ? rating : GLOBAL_AVERAGE;
  const v = typeof count === 'number' ? count : 0;
  const m = MIN_VOTES;
  const C = GLOBAL_AVERAGE;
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

/**
 * Quality-per-price: Bayesian score divided by price level, for the "Jakość/Cena" sort.
 * Places with unknown price level get a flat penalty instead of a division.
 * @returns {number}
 */
function valueScore(place) {
  const rating = typeof place.rating === 'number' ? place.rating : 0;
  const count = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0;
  const base = bayesianScore(rating, count);
  if (typeof place.priceLevel === 'number' && place.priceLevel > 0) {
    return base / place.priceLevel;
  }
  return base * 0.5;
}

/**
 * "Najlepsze" ranking - PURE quality (Bayesian Average only), deliberately excluding
 * distance and open-now status: those have their own dedicated sort tabs
 * ("Najbliższe" and the open/closed grouping in app.js's sortPlaces).
 * @returns {number} score scaled to roughly 0-50 for readability
 */
function calculateScore(place) {
  const rating = typeof place.rating === 'number' ? place.rating : 0;
  const count = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0;
  const base = bayesianScore(rating, count);
  return Number((base * 10).toFixed(2));
}

const LOW_RATING_THRESHOLD = 3.0;
const LOW_RATING_MIN_VOTES = 10;

/**
 * Classifies how much a rating can be trusted, purely from sample size — never
 * used to remove a place (a 2-review place may be the only real option in a small
 * town), only to (a) let Bayesian pull low-sample scores toward the average, and
 * (b) let the UI show a discreet "Mało opinii" hint for very small samples.
 * @returns {'no_data'|'very_low'|'low'|'established'}
 */
function reviewConfidence(place) {
  const rating = typeof place.rating === 'number' ? place.rating : null;
  const count = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0;
  if (rating === null || rating === 0 || count === 0) return 'no_data';
  if (count < 10) return 'very_low';
  if (count < 50) return 'low';
  return 'established';
}

/**
 * A place with a reliably-bad rating (below 3.0, backed by enough votes that it's
 * not just noise) should sink to the bottom of its "Najlepsze" group — but never
 * be removed: it can still be the closest option, so "Najbliższe" is unaffected.
 */
function isUnreliablyLowRated(place) {
  const rating = typeof place.rating === 'number' ? place.rating : null;
  const count = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0;
  return rating !== null && rating < LOW_RATING_THRESHOLD && count >= LOW_RATING_MIN_VOTES;
}

/**
 * The score actually used to order the "Najlepsze" sort: calculateScore, except
 * reliably-low-rated places are pushed to a sentinel range below every genuine
 * Bayesian score so they always sort last within their open/closed/unknown group.
 * @returns {number}
 */
function rankingScore(place) {
  const base = calculateScore(place);
  return isUnreliablyLowRated(place) ? base - 1000 : base;
}

function compareByDistance(a, b) {
  const aDist = typeof a.distanceKm === 'number' ? a.distanceKm : Number.MAX_SAFE_INTEGER;
  const bDist = typeof b.distanceKm === 'number' ? b.distanceKm : Number.MAX_SAFE_INTEGER;
  return aDist - bDist;
}

/**
 * @param {string} sortKey - 'distance' | 'price' | 'value' | anything else falls back to quality
 */
function comparePlaces(a, b, sortKey = 'rating') {
  if (sortKey === 'distance') return compareByDistance(a, b);
  if (sortKey === 'price') {
    const aPrice = typeof a.priceLevel === 'number' ? a.priceLevel : 99;
    const bPrice = typeof b.priceLevel === 'number' ? b.priceLevel : 99;
    return aPrice - bPrice;
  }
  if (sortKey === 'value') return valueScore(b) - valueScore(a);
  return calculateScore(b) - calculateScore(a);
}

module.exports = {
  bayesianScore,
  valueScore,
  calculateScore,
  comparePlaces,
  compareByDistance,
  reviewConfidence,
  isUnreliablyLowRated,
  rankingScore
};
