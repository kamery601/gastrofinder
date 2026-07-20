// Central feature flags for Platform Core. Every flag defaults to the CURRENT
// production behavior (SHA 4757138) - i.e. everything new is OFF until
// explicitly enabled via environment variables on Railway. This is the
// selective-rollback mechanism documented in docs/operations/ROLLBACK-PLATFORM-CORE.md.
//
// Reading is env-based (no DB, no network) so flags work even when everything
// else is down - the fallback path must never depend on the thing it guards.

const DEFINITIONS = {
  // Catalog Core
  CATALOG_CORE_ENABLED: false,
  CATALOG_READ_ENABLED: false,
  CATALOG_WRITE_ENABLED: false,
  DISCOVERY_ENABLED: false,
  SCHEDULED_REFRESH_ENABLED: false,
  DETAILS_REFRESH_ENABLED: false,
  // Modules
  MODE_AQUA_ENABLED: false,
  MODE_ATTRACTIONS_ENABLED: false,
  MODE_STAYS_ENABLED: false,
  PARTNER_PROPERTIES_ENABLED: false,
  REVIEW_FRESHNESS_ENABLED: false,
  // Countries (PL/SK/HU are live and NOT flag-gated - they are the baseline)
  COUNTRY_CZ_ENABLED: false,
  COUNTRY_AT_ENABLED: false,
  COUNTRY_HR_ENABLED: false,
  COUNTRY_IT_ENABLED: false,
  EXPANDED_CITY_COVERAGE_ENABLED: false
};

// Budgets / limits (numeric, with safe defaults matching current behavior)
const NUMERIC_DEFAULTS = {
  MAX_GOOGLE_CALLS_PER_USER_SEARCH: 21, // 1 geocode + 10 types x 2 ranks (food)
  MAX_DISCOVERY_CALLS_PER_RUN: 60,
  MAX_DETAILS_PER_PAGE: 10,
  MAX_CONCURRENT_GOOGLE_CALLS: 20,
  GOOGLE_REQUEST_TIMEOUT_MS: 8000,
  DISCOVERY_DAILY_BUDGET: 500
};

function parseBool(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function parseNum(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * @param {string} name - a key from DEFINITIONS
 * @param {object} [env] - injectable for tests; defaults to process.env
 * @returns {boolean}
 */
function isEnabled(name, env = process.env) {
  if (!(name in DEFINITIONS)) return false; // unknown flag is never on
  return parseBool(env[name], DEFINITIONS[name]);
}

/**
 * @param {string} name - a key from NUMERIC_DEFAULTS
 * @param {object} [env]
 * @returns {number}
 */
function limit(name, env = process.env) {
  if (!(name in NUMERIC_DEFAULTS)) return 0;
  return parseNum(env[name], NUMERIC_DEFAULTS[name]);
}

/** Snapshot of every flag/limit - for telemetry and the admin surface. */
function snapshot(env = process.env) {
  const flags = {};
  for (const name of Object.keys(DEFINITIONS)) flags[name] = isEnabled(name, env);
  const limits = {};
  for (const name of Object.keys(NUMERIC_DEFAULTS)) limits[name] = limit(name, env);
  return { flags, limits };
}

module.exports = { DEFINITIONS, NUMERIC_DEFAULTS, isEnabled, limit, snapshot };
