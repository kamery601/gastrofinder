require('dotenv').config();
const express = require('express');
const { geocodeAddress } = require('./geocode');
const { getNearbyPlaces } = require('./placesService');
const { filterPlaces } = require('./filters');
const { ratingScore } = require('./ranking');
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_API_KEY;
const VALID_MODES = new Set(['food', 'clubs', 'shops24']);

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

async function respondWithNearbyPlaces(center, mode, res) {
  const places = await getNearbyPlaces(center, mode, API_KEY);
  const filteredPlaces = filterPlaces(places, mode).map(place => ({
    ...place,
    score: Number(ratingScore(place).toFixed(2))
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
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/nearby', async (req, res) => {
  if (!ensureApiKey(res)) return;
  if (!req.query.location) return res.status(400).json({ error: 'Brak location' });
  try {
    const [lat, lng] = req.query.location.split(',');
    const center = { latitude: parseFloat(lat), longitude: parseFloat(lng) };
    if (Number.isNaN(center.latitude) || Number.isNaN(center.longitude)) {
      return res.status(400).json({ error: 'Nieprawidłowe współrzędne' });
    }
    await respondWithNearbyPlaces(center, normalizeMode(req.query.mode), res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/nearby-location', async (req, res) => {
  if (!ensureApiKey(res)) return;
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'Nieprawidłowe współrzędne' });
    }
    const center = { latitude: lat, longitude: lng };
    await respondWithNearbyPlaces(center, normalizeMode(req.query.mode), res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`GastroFinder działa na http://localhost:${PORT}`));
