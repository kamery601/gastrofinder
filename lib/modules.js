// Module registry - the domain contract for what GastroFinder can search for.
// FOOD/BARS/SHOPS are the existing live modes under their platform names;
// AQUA/ATTRACTIONS/STAYS are flag-gated. This file changes NO production
// behavior: server.js still speaks legacy mode names, and the registry maps
// between the two worlds until the frontend migrates.

const { isEnabled } = require('./flags');

const MODULES = {
  FOOD: {
    id: 'FOOD',
    legacyMode: 'food',
    label: 'Restauracje i bary',
    live: true, // baseline module, never flag-gated
    flag: null,
    searchRadiusMeters: 3000
  },
  BARS: {
    id: 'BARS',
    legacyMode: 'clubs',
    label: 'Kluby i dyskoteki',
    live: true,
    flag: null,
    searchRadiusMeters: 3000
  },
  SHOPS: {
    id: 'SHOPS',
    legacyMode: 'shops24',
    label: 'Sklepy całodobowe',
    live: true,
    flag: null,
    searchRadiusMeters: 3000
  },
  AQUA: {
    id: 'AQUA',
    legacyMode: 'aqua',
    label: 'Termy i akwaparki',
    live: false,
    flag: 'MODE_AQUA_ENABLED',
    // Thermal complexes draw visitors from much farther than restaurants;
    // 15-60 km to be benchmarked per docs - 25 km is the starting point.
    searchRadiusMeters: 25000
  },
  ATTRACTIONS: {
    id: 'ATTRACTIONS',
    legacyMode: 'attractions',
    label: 'Atrakcje',
    live: false,
    flag: 'MODE_ATTRACTIONS_ENABLED',
    searchRadiusMeters: 25000
  },
  STAYS: {
    id: 'STAYS',
    legacyMode: 'stays',
    label: 'Noclegi',
    live: false,
    flag: 'MODE_STAYS_ENABLED',
    // Partner-data-first module: no Google discovery radius semantics yet.
    searchRadiusMeters: null
  }
};

/** @returns {boolean} module exists and is either baseline-live or flag-enabled */
function isModuleEnabled(moduleId, env) {
  const m = MODULES[moduleId];
  if (!m) return false;
  if (m.live) return true;
  return m.flag ? isEnabled(m.flag, env) : false;
}

/** Maps a legacy mode string (food/clubs/shops24/...) to its platform module. */
function moduleForLegacyMode(mode) {
  return Object.values(MODULES).find((m) => m.legacyMode === mode) || null;
}

/** All modules a user may currently see, in a stable order. */
function enabledModules(env) {
  return Object.values(MODULES).filter((m) => isModuleEnabled(m.id, env));
}

module.exports = { MODULES, isModuleEnabled, moduleForLegacyMode, enabledModules };
