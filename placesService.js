const fetch = require('node-fetch');
const { cached } = require('./cache');
const { calculateDistanceKm } = require('./distance');

const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.types,places.currentOpeningHours,places.regularOpeningHours,places.businessStatus,places.googleMapsUri,places.location';

const SEARCH_CONFIG = {
  food: {
    includedTypes: ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway', 'meal_delivery', 'coffee_shop', 'fast_food_restaurant', 'pizza_restaurant'],
    excludedTypes: ['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house','shopping_mall','movie_theater','tourist_attraction','museum','park','gym','store','school','university','spa','casino']
  },
  clubs: {
    includedTypes: ['night_club', 'live_music_venue'],
    excludedTypes: ['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house']
  },
  shops24: {
    includedTypes: ['convenience_store', 'supermarket', 'grocery_store', 'gas_station', 'pharmacy'],
    excludedTypes: ['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house']
  }
};

async function fetchPlaces(center, type, excludedTypes, apiKey) {
  const body = {
    includedTypes: [type],
    maxResultCount: 20,
    locationRestriction: { circle: { center, radius: 3000.0 } },
    rankPreference: 'POPULARITY'
  };
  if (excludedTypes.length) body.excludedTypes = excludedTypes;

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK
    },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }
  return json.places || [];
}

async function getNearbyPlaces(center, mode, apiKey) {
  const config = SEARCH_CONFIG[mode] || SEARCH_CONFIG.food;
  const cacheKey = `nearby:${mode}:${center.latitude.toFixed(5)}:${center.longitude.toFixed(5)}`;

  return cached(cacheKey, 10 * 60 * 1000, async () => {
    const seen = new Set();
    const results = [];

    for (const type of config.includedTypes) {
      const places = await fetchPlaces(center, type, config.excludedTypes, apiKey);
      for (const place of places) {
        if (place.id && !seen.has(place.id)) {
          seen.add(place.id);
          if (place.location) {
            const distanceKm = calculateDistanceKm(center, place.location);
            if (distanceKm !== null) place.distanceKm = distanceKm;
          }
          results.push(place);
        }
      }
    }

    return results;
  });
}

module.exports = { getNearbyPlaces };
