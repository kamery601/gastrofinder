function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function calculateDistanceKm(a, b) {
  if (!a || !b || typeof a.latitude !== 'number' || typeof a.longitude !== 'number' || typeof b.lat !== 'number' || typeof b.lng !== 'number') {
    return null;
  }

  const R = 6371; // km
  const dLat = toRadians(b.lat - a.latitude);
  const dLng = toRadians(b.lng - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const aHarv = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(aHarv), Math.sqrt(1 - aHarv));
  const km = R * c;

  return Number(km.toFixed(1));
}

module.exports = { calculateDistanceKm };