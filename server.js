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
const app = express();

// Wired once at startup: Null catalog unless CATALOG_CORE_ENABLED + DATABASE_URL.
const catalog = createCatalog();
logger.info('server', `catalog: ${catalog.isAvailable() ? 'ENABLED' : 'disabled (live search only)'}`);
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
async function shadowWriteObservations(places, country, telemetry) {
  let inserted = 0;
  let updated = 0;
  let writeErrors = 0;
  try {
    const ids = places.map((p) => p.id).filter(Boolean);
    ({ inserted, updated } = await catalog.upsertObservations(ids, country, new Date()));
  } catch (e) {
    writeErrors = 1;
  }
  logger.info('telemetry', 'search', {
    ...telemetry,
    catalogWrites: inserted + updated,
    newPlaceIds: inserted,
    existingPlaceIds: updated,
    writeErrors
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
  res.json({ places: filteredPlaces });

  const telemetry = {
    searchRequestId,
    country,
    mode,
    googleGeocodeCalls: 0, // geocode is a separate endpoint with its own cache
    googleNearbyCalls: stats.googleNearbyCalls ?? 0,
    googleTextSearchCalls: 0,
    googleDetailsCalls: 0,
    cacheHits: stats.cacheHit ? 1 : 0,
    raw: stats.raw ?? null,
    unique: stats.unique ?? null,
    capped: stats.capped ?? false,
    durationMs: Date.now() - startedAt,
    estimatedCostBucket: costBucket(stats.googleNearbyCalls ?? 0)
  };

  if (catalog.isAvailable() && isEnabled('CATALOG_WRITE_ENABLED')) {
    // Fire-and-forget: runs after res.json, never in the response path.
    shadowWriteObservations(accepted, country, telemetry).catch((e) =>
      logger.warn('server', 'shadow write batch failed', { message: e.message }));
  } else {
    logger.info('telemetry', 'search', { ...telemetry, catalogWrites: 0, newPlaceIds: 0, existingPlaceIds: 0, writeErrors: 0 });
  }
}

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
