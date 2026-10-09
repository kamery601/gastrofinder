(function (global) {
  // ACTIVITY_UNCONFIRMED: established place with no sign of life for 6+ months
  // (from the activity audit). Never presented as open - we only recommend
  // what we have evidence for.
  const CLOSED_STATUSES = new Set(['SEASONAL_CLOSED', 'CLOSED_CONFIRMED', 'ACTIVITY_UNCONFIRMED']);
  const BADGES = {
    SEASONAL_CLOSED: 'Sezonowo zamknięte',
    CLOSED_CONFIRMED: 'Zamknięte',
    ACTIVITY_UNCONFIRMED: 'Niepotwierdzone'
  };

  function activeOverride(place) {
    const override = place && place.availabilityOverride;
    return override && CLOSED_STATUSES.has(override.status) ? override : null;
  }

  function effectiveOpenStatus(place, openingChecker, hour, minute) {
    if (activeOverride(place)) return false;
    return openingChecker(place, hour, minute);
  }

  function presentation(place, openingChecker, detailsProvider, hour, minute) {
    const override = activeOverride(place);
    if (override) {
      return {
        isOpen: false,
        status: 'seasonal',
        badge: BADGES[override.status] || 'Sezonowo zamknięte',
        detail: override.label || 'Nieczynne poza sezonem',
        source: override.source || null,
        verifiedAt: override.verifiedAt || null,
        validUntil: override.validUntil || null
      };
    }

    const isOpen = openingChecker(place, hour, minute);
    const details = detailsProvider(place);
    return {
      isOpen,
      status: isOpen === true ? 'open' : isOpen === false ? 'closed' : 'unknown',
      badge: isOpen === true ? 'Otwarte' : isOpen === false ? 'Zamknięte' : 'Brak danych',
      detail: details && (details.closesAt || details.opensAt || details.is24Hours) ? details.label : '',
      source: null,
      verifiedAt: null,
      validUntil: null
    };
  }

  global.GastroAvailability = {
    activeOverride,
    effectiveOpenStatus,
    presentation
  };
})(typeof window !== 'undefined' ? window : globalThis);
