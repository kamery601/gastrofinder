(function (global) {
  const VENUE_MATCHERS = {
    pizza: (place) =>
      (place.types || []).includes('pizza_restaurant') ||
      /\bpizza\b/i.test(place.name || ''),
    kebab: (place) =>
      (place.types || []).includes('kebab_shop') ||
      /\bkebab\b/i.test(place.name || ''),
    cafe: (place) =>
      (place.types || []).some((t) => ['cafe', 'coffee_shop'].includes(t)),
    restaurant: (place) => {
      const types = place.types || [];
      const isRestaurant = types.some((t) =>
        ['restaurant', 'polish_restaurant', 'fast_food_restaurant', 'meal_takeaway', 'meal_delivery', 'bakery'].includes(t)
      );
      return isRestaurant && !VENUE_MATCHERS.pizza(place) && !VENUE_MATCHERS.kebab(place);
    },
    bar: (place) => (place.types || []).includes('bar')
  };

  const defaultFilters = () => ({
    maxDistanceKm: null,
    minRating: 0,
    onlyOpen: false,
    hideUnknown: false,
    venueType: ''
  });

  function matchesVenueType(place, venueType) {
    if (!venueType) return true;
    const matcher = VENUE_MATCHERS[venueType];
    return matcher ? matcher(place) : true;
  }

  function applyFilters(places, filters, openChecker) {
    return places.filter((place) => {
      const openStatus = openChecker(place);

      if (filters.onlyOpen && openStatus !== true) return false;
      if (filters.hideUnknown && openStatus === null) return false;
      if (filters.minRating > 0 && (place.rating || 0) < filters.minRating) return false;
      if (filters.maxDistanceKm != null && place.distanceKm != null && place.distanceKm > filters.maxDistanceKm) {
        return false;
      }
      if (filters.maxDistanceKm != null && place.distanceKm == null) return false;
      if (!matchesVenueType(place, filters.venueType)) return false;

      return true;
    });
  }

  function bindFilterControls(options) {
    const {
      onChange,
      getMode,
      elements
    } = options;

    const state = defaultFilters();

    function syncButtons() {
      elements.onlyOpenBtn.className = 'filter-chip toggle' + (state.onlyOpen ? ' active' : '');
      elements.hideUnknownBtn.className = 'filter-chip toggle' + (state.hideUnknown ? ' active' : '');
      elements.venueTypeRow.style.display = getMode() === 'food' ? 'flex' : 'none';
    }

    function emitChange() {
      syncButtons();
      onChange({ ...state });
    }

    elements.maxDistanceSelect.addEventListener('change', () => {
      const value = elements.maxDistanceSelect.value;
      state.maxDistanceKm = value === '' ? null : Number(value);
      emitChange();
    });

    elements.minRatingSelect.addEventListener('change', () => {
      state.minRating = Number(elements.minRatingSelect.value) || 0;
      emitChange();
    });

    elements.onlyOpenBtn.addEventListener('click', () => {
      state.onlyOpen = !state.onlyOpen;
      emitChange();
    });

    elements.hideUnknownBtn.addEventListener('click', () => {
      state.hideUnknown = !state.hideUnknown;
      emitChange();
    });

    document.querySelectorAll('[data-venue-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.venueType;
        state.venueType = state.venueType === next ? '' : next;
        document.querySelectorAll('[data-venue-type]').forEach((chip) => {
          chip.className = 'filter-chip venue' + (chip.dataset.venueType === state.venueType ? ' active' : '');
        });
        emitChange();
      });
    });

    function reset() {
      Object.assign(state, defaultFilters());
      elements.maxDistanceSelect.value = '';
      elements.minRatingSelect.value = '0';
      document.querySelectorAll('[data-venue-type]').forEach((chip) => {
        chip.className = 'filter-chip venue';
      });
      emitChange();
    }

    syncButtons();

    return {
      getState: () => ({ ...state }),
      setOnlyOpen(value) {
        state.onlyOpen = !!value;
        emitChange();
      },
      reset
    };
  }

  global.GastroFilters = {
    defaultFilters,
    applyFilters,
    bindFilterControls,
    matchesVenueType
  };
})(window);
