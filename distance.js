function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function readCoords(point) {
  if (!point) return null;
  const lat = typeof point.latitude === 'number' ? point.latitude : point.lat;
  const lng = typeof point.longitude === 'number' ? point.longitude : point.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
}

/**
 * Haversine great-circle distance between two lat/lng points, in kilometers.
 * Accepts Google Places' `{latitude, longitude}` shape for `a`, and either that
 * or `{lat, lng}` for `b`.
 * @returns {number|null} distance rounded to 1 decimal, or null if either point is invalid
 */
function calculateDistanceKm(a, b) {
  if (!a || !b || typeof a.latitude !== 'number' || typeof a.longitude !== 'number') {
    return null;
  }

  const target = readCoords(b);
  if (!target) return null;

  const R = 6371; // km
  const dLat = toRadians(target.lat - a.latitude);
  const dLng = toRadians(target.lng - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(target.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const aHarv = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(aHarv), Math.sqrt(1 - aHarv));
  const km = R * c;

  return Number(km.toFixed(1));
}

module.exports = { calculateDistanceKm };