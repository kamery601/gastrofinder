function ratingScore(place) {
  const rating = typeof place.rating === 'number' ? place.rating : 0;
  const count = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0;
  return rating * Math.log10(count + 10);
}

function valueScore(place) {
  const rating = typeof place.rating === 'number' ? place.rating : 0;
  if (typeof place.priceLevel === 'number' && place.priceLevel > 0) {
    return rating / place.priceLevel;
  }
  return rating * 0.5;
}

function distanceScore(place) {
  if (typeof place.distanceKm !== 'number') return 0;
  const distance = place.distanceKm;
  if (distance <= 1) return 10;
  if (distance <= 3) return 6;
  if (distance <= 5) return 3;
  return Math.max(0, 1 - (distance - 5) * 0.2);
}

function pricePenalty(place) {
  if (typeof place.priceLevel !== 'number') return 0;
  switch (place.priceLevel) {
    case 0: return 4;
    case 1: return 2;
    case 2: return 1;
    case 3: return 0;
    case 4: return -2;
    default: return 0;
  }
}

function openBonus(place) {
  if (place.currentOpeningHours && place.currentOpeningHours.openNow === true) return 6;
  if (place.currentOpeningHours && place.currentOpeningHours.openNow === false) return -4;
  return 0;
}

function calculateScore(place) {
  const baseRating = ratingScore(place);
  const value = valueScore(place);
  const distance = distanceScore(place);
  const price = pricePenalty(place);
  const open = openBonus(place);
  return Number((baseRating * 0.9 + value * 8 + distance * 2 + price + open).toFixed(2));
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
  if (sortKey === 'value') {
    return valueScore(b) - valueScore(a);
  }
  return calculateScore(b) - calculateScore(a);
}

module.exports = { ratingScore, valueScore, distanceScore, pricePenalty, openBonus, calculateScore, comparePlaces, compareByDistance };
