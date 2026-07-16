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

module.exports = { bayesianScore, valueScore, calculateScore, comparePlaces, compareByDistance };
