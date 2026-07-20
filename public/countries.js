// Central country configuration - the single source of truth for the
// international expansion. Adding a future country should mean adding an entry
// here (plus verifying Google data quality and noise filters), never copying
// logic elsewhere. UMD-style: served to the browser as window.GastroCountries
// AND require()-able from the Node server, so both sides share one definition.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GastroCountries = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DEFAULT_COUNTRY = 'PL';
  const STORAGE_KEY = 'gastrofinder.country';

  const COUNTRIES = {
    PL: {
      code: 'PL',
      googleRegion: 'pl',
      language: 'pl',
      label: 'Polska',
      flag: '\u{1F1F5}\u{1F1F1}',
      currency: 'PLN',
      defaultCity: 'Zakopane',
      searchPlaceholder: 'Wpisz miasto lub miejscowość w Polsce, np. Zakopane'
    },
    SK: {
      code: 'SK',
      googleRegion: 'sk',
      language: 'sk',
      label: 'Słowacja',
      flag: '\u{1F1F8}\u{1F1F0}',
      currency: 'EUR',
      defaultCity: 'Poprad',
      searchPlaceholder: 'Wpisz miasto lub miejscowość na Słowacji, np. Poprad'
    },
    HU: {
      code: 'HU',
      googleRegion: 'hu',
      language: 'hu',
      label: 'Węgry',
      flag: '\u{1F1ED}\u{1F1FA}',
      currency: 'HUF',
      defaultCity: 'Budapeszt',
      searchPlaceholder: 'Wpisz miasto lub miejscowość na Węgrzech, np. Eger'
    }
  };

  /**
   * @param {string} code
   * @returns {boolean} true only for a country this app actually supports
   */
  function isValidCountry(code) {
    return Object.prototype.hasOwnProperty.call(COUNTRIES, code);
  }

  /**
   * Normalizes any stored/user-supplied value to a supported country code,
   * falling back to the default (Poland) for anything unknown.
   */
  function normalizeCountry(code) {
    const upper = String(code || '').toUpperCase();
    return isValidCountry(upper) ? upper : DEFAULT_COUNTRY;
  }

  function getCountry(code) {
    return COUNTRIES[normalizeCountry(code)];
  }

  /**
   * Reads the persisted country choice. First visit (nothing stored) always
   * starts from Poland, per product requirement.
   * @param {Storage} [storage] - injectable for tests; defaults to localStorage
   */
  function getSavedCountry(storage) {
    try {
      const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!store) return DEFAULT_COUNTRY;
      return normalizeCountry(store.getItem(STORAGE_KEY));
    } catch (e) {
      return DEFAULT_COUNTRY;
    }
  }

  /**
   * Persists the country choice. Returns the normalized code actually saved.
   * @param {Storage} [storage] - injectable for tests; defaults to localStorage
   */
  function saveCountry(code, storage) {
    const normalized = normalizeCountry(code);
    try {
      const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (store) store.setItem(STORAGE_KEY, normalized);
    } catch (e) {
      // Private mode / blocked storage: selection still works for the session.
    }
    return normalized;
  }

  return {
    COUNTRIES,
    DEFAULT_COUNTRY,
    STORAGE_KEY,
    isValidCountry,
    normalizeCountry,
    getCountry,
    getSavedCountry,
    saveCountry
  };
});
