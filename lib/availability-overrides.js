// First-party availability corrections layered over live Google Places data.
//
// These records never alter or pretend to be Google opening hours. Each rule:
//   * targets one durable Google Place ID,
//   * has an explicit validity window,
//   * carries its own provenance,
//   * expires automatically instead of silently recurring next year.
//
// The list is intentionally small and manually verified. Automated signals
// (near a ski lift, few/recent reviews, seasonal wording) may nominate a place
// for verification later, but must never create a closure by themselves.

const OVERRIDES = Object.freeze({
  ChIJIfGBY3H3FUcRsYNjhX6eC08: Object.freeze({
    status: 'SEASONAL_CLOSED',
    season: 'WINTER',
    label: 'Nieczynne poza sezonem zimowym',
    verifiedAt: '2026-07-21',
    validFrom: '2026-04-01',
    validUntil: '2026-11-30',
    source: 'LOCAL_VERIFICATION'
  })
});

function isoDateInTimeZone(date, timeZone = 'Europe/Warsaw') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isActive(rule, date = new Date()) {
  if (!rule || !rule.validFrom || !rule.validUntil) return false;
  const today = isoDateInTimeZone(date);
  return today >= rule.validFrom && today <= rule.validUntil;
}

function applyAvailabilityOverrides(places, options = {}) {
  if (!options.enabled || !Array.isArray(places) || !places.length) return places;
  const now = options.now || new Date();

  return places.map((place) => {
    const rule = place && OVERRIDES[place.id];
    if (!isActive(rule, now)) return place;
    return {
      ...place,
      availabilityOverride: { ...rule }
    };
  });
}

module.exports = {
  OVERRIDES,
  isoDateInTimeZone,
  isActive,
  applyAvailabilityOverrides
};
