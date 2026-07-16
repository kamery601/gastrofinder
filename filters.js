const LODGING = new Set(['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house','inn']);
const ALLOWED_FOOD = new Set(['restaurant','cafe','bar','bakery','meal_takeaway','meal_delivery','coffee_shop','fast_food_restaurant','pizza_restaurant','kebab_shop']);
const CLUB_TYPES = new Set(['night_club','live_music_venue']);
const NON_CLUB = new Set(['restaurant','cafe','bakery','fast_food_restaurant','meal_takeaway','meal_delivery','pizza_restaurant','burger_restaurant']);
const SHOP24_TYPES = new Set(['convenience_store','supermarket','grocery_store','gas_station','pharmacy']);

// Types that, wherever they appear in `types`, mean this business fundamentally
// sells fuel or groceries/institutional services — never a standalone restaurant,
// regardless of any food-ish type Google also attached to it.
const FUEL_TYPES = new Set(['gas_station']);
const GROCERY_TYPES = new Set(['supermarket', 'grocery_store', 'convenience_store', 'department_store']);
const NON_FOOD_INSTITUTION_TYPES = new Set([
  'movie_theater', 'museum', 'school', 'university', 'gym', 'parking', 'amusement_center', 'tourist_attraction', 'spa', 'casino', 'park'
]);

// 'store' and 'shopping_mall' are deliberately NOT hard-reject types: a real
// restaurant/cafe commonly carries one of these as a secondary type (galleries,
// retail parks) and must not be rejected for it alone (see classifyFoodPlace).

const FUEL_NAME_PATTERNS = ['stacja paliw', 'bp', 'orlen', 'shell', 'circle k', 'amic', 'moya'];
const GROCERY_NAME_PATTERNS = ['kaufland', 'lewiatan', 'gama', 'sklep spożywczy', 'dyskont', 'supermarket', 'żabka', 'zabka', 'biedronka', 'lidl', 'auchan', 'carrefour'];

const FOOD_DESCRIPTOR_WORDS = ['restauracja', 'restauracji', 'bistro', 'trattoria', 'pizzeria', 'karczma', 'kawiarnia', 'kawiarni', 'cafe', 'coffee', 'grill', 'bar', 'kuchnia', 'cukiernia', 'piekarnia', 'sushi', 'kebab', 'burger', 'gastropub'];
const GENERIC_HOTEL_NAME_WORDS = ['hotel', 'hostel', 'motel', 'resort', 'pensjonat', 'apartamenty'];
const GENERIC_MALL_NAME_WORDS = ['galeria', 'centrum handlowe', 'park handlowy', 'outlet', 'dom handlowy', 'pasaż handlowy'];

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function hasAnyType(types, set) {
  return types.some(t => set.has(t));
}

function firstMatchingType(types, set) {
  return types.find(t => set.has(t)) || null;
}

function matchesWord(lowerName, phrase) {
  return new RegExp(`(^|[^\\p{L}])${phrase}($|[^\\p{L}])`, 'u').test(lowerName);
}

function matchesAnyWord(lowerName, phrases) {
  return phrases.some(p => matchesWord(lowerName, p));
}

/**
 * @returns {'fuel_station'|'grocery_store'|null} - a hard-noise reason if the NAME
 * itself unambiguously identifies a known fuel or grocery chain, regardless of
 * whatever (possibly mislabeled) type Google attached to it.
 */
function matchNoiseName(lowerName) {
  if (matchesAnyWord(lowerName, FUEL_NAME_PATTERNS)) return 'fuel_station';
  if (matchesAnyWord(lowerName, GROCERY_NAME_PATTERNS)) return 'grocery_store';
  return null;
}

/**
 * True when the name reads as a generic instance of `genericWords` (e.g. "Hotel
 * Górski") with no distinguishing food-descriptor word — used to tell "just a
 * hotel/mall" apart from "a restaurant that happens to sit inside one".
 */
function looksGenericNonFood(lowerName, genericWords) {
  return matchesAnyWord(lowerName, genericWords) && !matchesAnyWord(lowerName, FOOD_DESCRIPTOR_WORDS);
}

/**
 * Central, testable classification for the `food` mode. Returns why a place was
 * accepted/rejected so callers (and logs) can reason about it instead of a bare
 * boolean. Does NOT check businessStatus — that's filterPlaces' job.
 * @returns {{accepted: boolean, reason: string|null, confidence?: string}}
 */
function classifyFoodPlace(place) {
  const types = place.types || [];
  const lowerName = normalizeText(place.displayName?.text || place.name || '');

  const nameNoise = matchNoiseName(lowerName);
  if (nameNoise) return { accepted: false, reason: nameNoise, confidence: 'high' };

  if (hasAnyType(types, FUEL_TYPES)) return { accepted: false, reason: 'fuel_station', confidence: 'high' };
  if (hasAnyType(types, GROCERY_TYPES)) return { accepted: false, reason: 'grocery_store', confidence: 'high' };
  if (hasAnyType(types, NON_FOOD_INSTITUTION_TYPES)) {
    return { accepted: false, reason: firstMatchingType(types, NON_FOOD_INSTITUTION_TYPES), confidence: 'high' };
  }

  const hasFoodType = hasAnyType(types, ALLOWED_FOOD);
  if (!hasFoodType) return { accepted: false, reason: 'non_food_type', confidence: 'high' };

  if (hasAnyType(types, LODGING) && looksGenericNonFood(lowerName, GENERIC_HOTEL_NAME_WORDS)) {
    return { accepted: false, reason: 'lodging_without_restaurant', confidence: 'medium' };
  }

  if (hasAnyType(types, new Set(['shopping_mall', 'department_store'])) && looksGenericNonFood(lowerName, GENERIC_MALL_NAME_WORDS)) {
    return { accepted: false, reason: 'shopping_mall_whole', confidence: 'medium' };
  }

  return { accepted: true, reason: null, confidence: 'high' };
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

/**
 * Same decision as filterPlaces, but also tallies WHY each rejected place was
 * rejected (aggregated counts only — no per-place logging) so the server can
 * log a summary like { fuel_station: 4, grocery_store: 3, non_food_type: 2 }
 * without ever logging an individual place's name/address.
 * @param {object[]} places
 * @param {'food'|'clubs'|'shops24'} mode
 * @returns {{accepted: object[], rejectedReasons: Object<string, number>, total: number}}
 */
function classifyAndSummarize(places, mode) {
  const accepted = [];
  const rejectedReasons = {};
  const tally = (reason) => { rejectedReasons[reason] = (rejectedReasons[reason] || 0) + 1; };

  for (const place of places) {
    if (place.businessStatus !== 'OPERATIONAL') {
      tally('not_operational');
      continue;
    }
    const types = place.types || [];

    if (mode === 'food') {
      const result = classifyFoodPlace(place);
      if (result.accepted) accepted.push(place); else tally(result.reason || 'non_food_type');
    } else if (mode === 'clubs') {
      if (isClubPlace(types)) accepted.push(place); else tally('non_club');
    } else if (mode === 'shops24') {
      if (isShop24Place(types)) accepted.push(place); else tally('non_shop24');
    }
  }

  return { accepted, rejectedReasons, total: places.length };
}

/**
 * Filters raw Google Places results down to what a given mode should actually show:
 * operational places only, matched against mode-specific type/name rules
 * (see classifyFoodPlace / isClubPlace / isShop24Place).
 * @param {object[]} places
 * @param {'food'|'clubs'|'shops24'} mode
 * @returns {object[]}
 */
function filterPlaces(places, mode) {
  return classifyAndSummarize(places, mode).accepted;
}

module.exports = { filterPlaces, classifyFoodPlace, classifyAndSummarize };
