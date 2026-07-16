(function (global) {
  const PRICE_COVERAGE_THRESHOLD = 0.6;

  function hasPrice(place) {
    return typeof place.priceLevel === 'number';
  }

  /**
   * Fraction of places that carry a real priceLevel. Computed over whatever set
   * is passed in — callers should pass the currently VISIBLE (post-filter) places,
   * since that's what the price/value sorts actually operate on.
   * @returns {number} 0 when the list is empty (never claim price sorts are trustworthy with no data)
   */
  function priceCoverage(places) {
    if (!places || !places.length) return 0;
    return places.filter(hasPrice).length / places.length;
  }

  function priceSortEnabled(places) {
    return priceCoverage(places) >= PRICE_COVERAGE_THRESHOLD;
  }

  /**
   * "Najtańsze": priced places first (ascending price), unpriced places always
   * after — never interpreted as cheap or expensive, just placed outside the
   * comparison entirely. Relative order among unpriced places is left untouched.
   */
  function compareByPrice(a, b) {
    const aHas = hasPrice(a);
    const bHas = hasPrice(b);
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (!aHas && !bHas) return 0;
    return a.priceLevel - b.priceLevel;
  }

  /**
   * "Jakość/Cena": quality-per-price using the server's Bayesian `score`, only
   * for places that actually have a price. No `rating * 0.55` (or any other)
   * fallback for unpriced places — they simply don't participate and sort after
   * every priced place.
   */
  function compareByValue(a, b) {
    const aHas = hasPrice(a);
    const bHas = hasPrice(b);
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (!aHas && !bHas) return 0;
    const aValue = (typeof a.score === 'number' ? a.score : 0) / a.priceLevel;
    const bValue = (typeof b.score === 'number' ? b.score : 0) / b.priceLevel;
    return bValue - aValue;
  }

  global.GastroRankingUI = {
    PRICE_COVERAGE_THRESHOLD,
    hasPrice,
    priceCoverage,
    priceSortEnabled,
    compareByPrice,
    compareByValue
  };
})(window);
