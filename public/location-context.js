(function (global) {
  /**
   * Builds a location context from a successful Geocoding API result.
   * Always trusts the geocoder's `formatted_address` as the source of truth for
   * what to display — the user's raw typed input is kept only for reference/logging,
   * never shown as if it were the resolved place.
   * @param {string} userInput - what the user typed, e.g. "Białka"
   * @param {object} geocodeResult - a single result from Google's geocode `results[]`
   */
  function buildFromGeocode(userInput, geocodeResult) {
    const formattedAddress = geocodeResult?.formatted_address || userInput || null;
    const location = geocodeResult?.geometry?.location || null;
    return {
      source: 'geocode',
      userInput: userInput || null,
      formattedAddress,
      lat: typeof location?.lat === 'number' ? location.lat : null,
      lng: typeof location?.lng === 'number' ? location.lng : null,
      types: Array.isArray(geocodeResult?.types) ? geocodeResult.types : []
    };
  }

  /**
   * Builds a location context from the browser's GPS position. There is no
   * "recognized address" here — the distance reference is the device's own position.
   */
  function buildFromGps(lat, lng) {
    return {
      source: 'gps',
      userInput: null,
      formattedAddress: null,
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
      types: []
    };
  }

  /**
   * Formats the two user-facing lines describing where results are centered on:
   * - resultsFor: "Wyniki dla: <formatted_address>" (null for GPS - there's no address to show)
   * - distanceNote: what the distance is measured from
   */
  function formatMessages(context) {
    if (!context) return { resultsFor: null, distanceNote: null };
    if (context.source === 'gps') {
      return { resultsFor: null, distanceNote: 'Odległość liczona od Twojej lokalizacji.' };
    }
    const resultsFor = context.formattedAddress ? `Wyniki dla: ${context.formattedAddress}` : null;
    return { resultsFor, distanceNote: 'Odległość liczona od rozpoznanego punktu wyszukiwania.' };
  }

  global.GastroLocation = { buildFromGeocode, buildFromGps, formatMessages };
})(window);
