// Bayesian Average ranking - uczciwe porównanie lokali z różną liczbą opinii
// Wzór: score = (v/(v+m)) * R + (m/(v+m)) * C
// gdzie: R = ocena lokalu, v = liczba opinii, m = próg, C = średnia globalna

const GLOBAL_AVERAGE = 4.3;
const MIN_VOTES = 100;

function bayesianScore(rating, count) {
  const R = typeof rating === 'number' ? rating : GLOBAL_AVERAGE;
  const v = typeof count === 'number' ? count : 0;
  const m = MIN_VOTES;
  const C = GLOBAL_AVERAGE;
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

function valueScore(place) {
  const rating = typeof place.rating === 'number' ? place.rating : 0;
  const count = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0;
  const base = bayesianScore(rating, count);
  if (typeof place.priceLevel === 'number' && place.priceLevel > 0) {
    return base / place.priceLevel;
  }
  return base * 0.5;
}

function distanceScore(place) {
  if (typeof place.distanceKm !== 'number') return 0;
  const d = place.distanceKm;
  if (d <= 0.5) return 10;
  if (d <= 1.0) return 8;
  if (d <= 2.0) return 5;
  if (d <= 3.0) return 3;
  return Math.max(0, 1 - (d - 3) * 0.3);
}

function pricePenalty(place) {
  if (typeof place.priceLevel !== 'number') return 0;
  switch (place.priceLevel) {
    case 0: return 2;
    case 1: return 1;
    case 2: return 0;
    case 3: return -1;
    case 4: return -3;
    default: return 0;
  }
}

function openBonus(place) {
  if (place.currentOpeningHours && place.currentOpeningHours.openNow === true) return 3;
  if (place.currentOpeningHours && place.currentOpeningHours.openNow === false) return -2;
  return 0;
}

function calculateScore(place) {
  const rating = typeof place.rating === 'number' ? place.rating : 0;
  const count = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0;
  const base = bayesianScore(rating, count);
  const distance = distanceScore(place);
  const price = pricePenalty(place);
  const open = openBonus(place);
  return Number((base * 10 + distance * 1.5 + price + open).toFixed(2));
}

function compareByDistance(a, b) {
  const aDist = typeof a.distanceKm === 'number' ? a.distanceKm : Number.MAX_SAFE_INTEGER;
  const bDist = typeof b.distanceKm === 'number' ? b.distanceKm : Number.MAX_SAFE_INTEGER;
  return aDist - bDist;
}

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

module.exports = { bayesianScore, valueScore, distanceScore, pricePenalty, openBonus, calculateScore, comparePlaces, compareByDistance };
