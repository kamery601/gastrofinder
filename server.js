require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const { geocodeAddress } = require('./geocode');
const { getNearbyPlaces } = require('./placesService');
const { filterPlaces } = require('./filters');
const { calculateScore } = require('./ranking');
const logger = require('./logger');
const app = express();
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

async function respondWithNearbyPlaces(center, mode, res) {
  const places = await getNearbyPlaces(center, mode, API_KEY);
  const filteredPlaces = filterPlaces(places, mode).map(place => ({
    ...place,
    score: calculateScore(place)
  }));
  res.json({ places: filteredPlaces });
}

app.get('/api/geocode', async (req, res) => {
  if (!ensureApiKey(res)) return;
  if (!req.query.address || !String(req.query.address).trim()) return res.status(400).json({ error: 'Brak adresu' });
  try {
    const json = await geocodeAddress(req.query.address, API_KEY);
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
    await respondWithNearbyPlaces(center, normalizeMode(req.query.mode), res);
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
    await respondWithNearbyPlaces(center, normalizeMode(req.query.mode), res);
  } catch (e) {
    respondWithError(res, e, 'nearby-location');
  }
});

app.listen(PORT, () => logger.info('server', `GastroFinder działa na http://localhost:${PORT}`));
