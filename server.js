require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const { geocodeAddress } = require('./geocode');
const { getNearbyPlaces } = require('./placesService');
const { classifyAndSummarize } = require('./filters');
const { rankingScore, reviewConfidence } = require('./ranking');
const crypto = require('crypto');
const logger = require('./logger');
const { normalizeCountry } = require('./public/countries');
const { createCatalog } = require('./lib/catalog');
const { isEnabled } = require('./lib/flags');
const { applyAvailabilityOverrides } = require('./lib/availability-overrides');
const app = express();

// Railway terminates HTTPS at one reverse-proxy hop. Without this, Express
// Rate Limit rejects X-Forwarded-For validation and cannot identify the real
// client IP, weakening the guard on paid Google API endpoints.
app.set('trust proxy', 1);

// Wired once at startup: Null catalog unless CATALOG_CORE_ENABLED + DATABASE_URL.
const catalog = createCatalog();
logger.info('server', `catalog: ${catalog.isAvailable() ? 'ENABLED' : 'disabled (live search only)'}`);

// Environment fingerprint: instantly distinguishes THIS deploy from any stray
// clone project (the findresto-v1 incident). Non-secret values only.
const SW_VERSION = (() => {
  try {
    const m = require('fs').readFileSync(require('path').join(__dirname, 'public', 'sw.js'), 'utf8')
      .match(/CACHE_NAME = 'gastrofinder-(v\d+)'/);
    return m ? m[1] : 'unknown';
  } catch (e) { return 'unknown'; }
})();
const FINGERPRINT = {
  app: 'gastrofinder',
  environment: process.env.RAILWAY_ENVIRONMENT_NAME || 'local',
  railwayProject: process.env.RAILWAY_PROJECT_NAME || null,
  version: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || 'local',
  serviceWorker: SW_VERSION
};

// Post-response work must never crash the process.
process.on('unhandledRejection', (e) => {
  logger.error('server', 'unhandled rejection', { message: e?.message || String(e) });
});

// Graceful shutdown: drain the catalog pool so in-flight shadow writes finish.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    logger.info('server', `${sig} received - closing catalog pool`);
    await catalog.close();
    process.exit(0);
  });
}
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_API_KEY;
const VALID_MODES = new Set(['food', 'clubs', 'shops24']);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Zbyt wiele zapytań, spróbuj za chwilę' });
  }
});

app.use('/api/', apiLimiter);
app.use(express.static('public'));

function ensureApiKey(res) {
  if (!API_KEY) {
    res.status(503).json({ error: 'Brak konfiguracji GOOGLE_API_KEY' });
    return false;
  }
  return true;
}

function normalizeMode(mode) {
  const value = String(mode || 'food');
  return VALID_MODES.has(value) ? value : 'food';
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean} true when both coordinates are within their valid real-world range
 */
function areValidCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Maps an internal error to an HTTP status + Polish message safe to show the user.
 */
function respondWithError(res, e, context) {
  logger.error('server', `${context} failed`, { message: e.message });
  if (e.message === 'QUOTA_EXCEEDED') {
    return res.status(503).json({ error: 'Limit zapytań do Google wyczerpany, spróbuj ponownie później' });
  }
  if (/Przekroczono czas oczekiwania/.test(e.message)) {
    return res.status(504).json({ error: 'Serwis map jest chwilowo niedostępny, spróbuj ponownie' });
  }
  return res.status(500).json({ error: e.message });
}

function costBucket(googleCalls) {
  if (googleCalls === 0) return 'FREE_CACHE';
  if (googleCalls <= 5) return 'LOW';
  if (googleCalls <= 25) return 'MEDIUM';
  return 'HIGH';
}

/**
 * Fala 1 shadow write: records observed Place IDs AFTER the response has been
 * sent - a user request is never slowed down or failed by the catalog. Errors
 * degrade inside the catalog itself (see lib/catalog.js).
 */
/**
 * All post-response catalog work for one search: shadow WRITE (Fala 1),
 * optional shadow READ comparison (Fala 2 evidence - never shown to the user),
 * then persist + log one telemetry row. Every step is failure-isolated; the
 * user's response was already sent before this runs.
 */
async function afterResponsePipeline(places, country, telemetry) {
  const ids = places.map((p) => p.id).filter(Boolean);
  const row = { ...telemetry, writeInserted: 0, writeUpdated: 0, writeErrors: 0 };

  // ORDER MATTERS: the comparison must run BEFORE the shadow write, otherwise
  // it would see the ids this very search just inserted and report a
  // meaningless 100% coverage. The honest Fala 2 metric is "how much of what
  // live found did the catalog already know BEFORE this search".
  if (isEnabled('CATALOG_SHADOW_READ_ENABLED')) {
    const t0 = Date.now();
    try {
      const { known, oldestSeen } = await catalog.knownPlaceInfo(ids);
      row.liveCount = ids.length;
      row.catalogKnownCount = known;
      row.coverageRatio = ids.length ? Number((known / ids.length).toFixed(4)) : null;
      row.catalogOldestSeen = oldestSeen;
    } catch (e) {
      // comparison is best-effort evidence, never required
    }
    row.shadowReadMs = Date.now() - t0;
  }

  if (isEnabled('CATALOG_WRITE_ENABLED')) {
    const t0 = Date.now();
    try {
      const { inserted, updated } = await catalog.upsertObservations(ids, country, new Date());
      row.writeInserted = inserted;
      row.writeUpdated = updated;
    } catch (e) {
      row.writeErrors = 1;
    }
    row.shadowWriteMs = Date.now() - t0;
  }

  await catalog.recordSearchTelemetry(row);
  logger.info('telemetry', 'search', {
    ...row,
    catalogWrites: row.writeInserted + row.writeUpdated,
    newPlaceIds: row.writeInserted,
    existingPlaceIds: row.writeUpdated
  });
}

async function respondWithNearbyPlaces(center, mode, country, res) {
  const searchRequestId = crypto.randomUUID();
  const startedAt = Date.now();
  const stats = {};

  const places = await getNearbyPlaces(center, mode, API_KEY, country, stats);
  const { accepted, rejectedReasons, total } = classifyAndSummarize(places, mode);
  logger.info('filters', `${mode}: ${accepted.length}/${total} accepted`, { country, rejectedReasons });

  const filteredPlaces = accepted.map(place => ({
    ...place,
    score: rankingScore(place),
    reviewConfidence: reviewConfidence(place)
  }));
  const responsePlaces = applyAvailabilityOverrides(filteredPlaces, {
    enabled: isEnabled('SEASONALITY_OVERRIDES_ENABLED')
  });
  res.json({ places: responsePlaces });

  const telemetry = {
    searchRequestId,
    country,
    mode,
    googleNearbyCalls: stats.googleNearbyCalls ?? 0,
    cacheHit: !!stats.cacheHit,
    raw: stats.raw ?? null,
    unique: stats.unique ?? null,
    capped: stats.capped ?? false,
    durationMs: Date.now() - startedAt,
    costBucket: costBucket(stats.googleNearbyCalls ?? 0)
  };

  if (catalog.isAvailable()) {
    // Fire-and-forget with an explicit catch: never in the response path,
    // never an unhandled rejection.
    afterResponsePipeline(accepted, country, telemetry).catch((e) =>
      logger.warn('server', 'after-response pipeline failed', { message: e.message }));
  } else {
    logger.info('telemetry', 'search', { ...telemetry, catalogWrites: 0, newPlaceIds: 0, existingPlaceIds: 0, writeErrors: 0 });
  }
}

// Ops diagnostics: no secrets, aggregate state only.
app.get('/api/health', async (req, res) => {
  const db = await catalog.ping();
  res.json({
    ...FINGERPRINT,
    catalogAvailable: catalog.isAvailable(),
    writeEnabled: isEnabled('CATALOG_WRITE_ENABLED'),
    readEnabled: isEnabled('CATALOG_READ_ENABLED'),
    shadowReadEnabled: isEnabled('CATALOG_SHADOW_READ_ENABLED'),
    seasonalityOverridesEnabled: isEnabled('SEASONALITY_OVERRIDES_ENABLED'),
    db
  });
});

app.get('/api/geocode', async (req, res) => {
  if (!ensureApiKey(res)) return;
  if (!req.query.address || !String(req.query.address).trim()) return res.status(400).json({ error: 'Brak adresu' });
  try {
    const json = await geocodeAddress(req.query.address, API_KEY, normalizeCountry(req.query.country));
    res.json(json);
  } catch (e) {
    respondWithError(res, e, 'geocode');
  }
});

app.get('/api/nearby', async (req, res) => {
  if (!ensureApiKey(res)) return;
  if (!req.query.location) return res.status(400).json({ error: 'Brak location' });
  try {
    const [lat, lng] = req.query.location.split(',');
    const center = { latitude: parseFloat(lat), longitude: parseFloat(lng) };
    if (!areValidCoords(center.latitude, center.longitude)) {
      return res.status(400).json({ error: 'Nieprawidłowe współrzędne' });
    }
    await respondWithNearbyPlaces(center, normalizeMode(req.query.mode), normalizeCountry(req.query.country), res);
  } catch (e) {
    respondWithError(res, e, 'nearby');
  }
});

app.get('/api/nearby-location', async (req, res) => {
  if (!ensureApiKey(res)) return;
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!areValidCoords(lat, lng)) {
      return res.status(400).json({ error: 'Nieprawidłowe współrzędne' });
    }
    const center = { latitude: lat, longitude: lng };
    await respondWithNearbyPlaces(center, normalizeMode(req.query.mode), normalizeCountry(req.query.country), res);
  } catch (e) {
    respondWithError(res, e, 'nearby-location');
  }
});

app.listen(PORT, () => logger.info('server', `GastroFinder działa na http://localhost:${PORT}`));
