const LODGING = new Set(['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house','inn']);
const ALLOWED_FOOD = new Set(['restaurant','cafe','bar','bakery','meal_takeaway','meal_delivery','coffee_shop','fast_food_restaurant','pizza_restaurant','kebab_shop']);
const REJECTED_FOOD = new Set(['shopping_mall','movie_theater','tourist_attraction','museum','lodging','park','gym','school','university','spa','casino']);
const CLUB_TYPES = new Set(['night_club','live_music_venue']);
const NON_CLUB = new Set(['restaurant','cafe','bakery','fast_food_restaurant','meal_takeaway','meal_delivery','pizza_restaurant','burger_restaurant']);
const SHOP24_TYPES = new Set(['convenience_store','supermarket','grocery_store','gas_station','pharmacy']);
const COMMON_EXCLUDE_NAMES = ['żabka','zabka','shell','bp stacja','orlen','circle k','biedronka','lidl','auchan','carrefour'];

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function hasAnyType(types, set) {
  return types.some(t => set.has(t));
}

function isExcludedChainName(lowerName) {
  return COMMON_EXCLUDE_NAMES.some(n => new RegExp(`(^|[^\\p{L}])${n}($|[^\\p{L}])`, 'u').test(lowerName));
}

function isFoodPlace(types, name) {
  const lowerName = normalizeText(name);
  if (!hasAnyType(types, ALLOWED_FOOD)) return false;
  if (hasAnyType(types, REJECTED_FOOD)) return false;
  if (hasAnyType(types, LODGING)) return false;
  return !isExcludedChainName(lowerName);
}

function isClubPlace(types) {
  if (!hasAnyType(types, CLUB_TYPES)) return false;
  if (hasAnyType(types, LODGING)) return false;
  if (hasAnyType(types, NON_CLUB)) return false;
  return true;
}

function isShop24Place(types) {
  if (!hasAnyType(types, SHOP24_TYPES)) return false;
  if (hasAnyType(types, LODGING)) return false;
  return true;
}

function filterPlaces(places, mode) {
  return places.filter(place => {
    if (place.businessStatus !== 'OPERATIONAL') return false;
    const types = place.types || [];
    const name = place.displayName?.text || '';

    if (mode === 'food') return isFoodPlace(types, name);
    if (mode === 'clubs') return isClubPlace(types);
    if (mode === 'shops24') return isShop24Place(types);
    return false;
  });
}

module.exports = { filterPlaces };
