(function (global) {
  const CLOSED_STATUSES = new Set(['SEASONAL_CLOSED', 'CLOSED_CONFIRMED']);

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
        badge: 'Sezonowo zamknięte',
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
