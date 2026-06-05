require('dotenv').config();
const express = require('express');
const { geocodeAddress } = require('./geocode');
const { getNearbyPlaces } = require('./placesService');
const { filterPlaces } = require('./filters');
const { calculateScore } = require('./ranking');
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_API_KEY;

app.use(express.static('public'));

app.get('/api/geocode', async (req, res) => {
  try {
    const json = await geocodeAddress(req.query.address, API_KEY);
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/nearby', async (req, res) => {
  try {
    const [lat, lng] = req.query.location.split(',');
    const center = { latitude: parseFloat(lat), longitude: parseFloat(lng) };
    const mode = req.query.mode || 'food';

    const places = await getNearbyPlaces(center, mode, API_KEY);
    const filteredPlaces = filterPlaces(places, mode).map(place => ({
      ...place,
      score: calculateScore(place)
    }));

    res.json({ places: filteredPlaces });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/nearby-location', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'Nieprawidłowe współrzędne' });
    }
    const center = { latitude: lat, longitude: lng };
    const mode = req.query.mode || 'food';

    const places = await getNearbyPlaces(center, mode, API_KEY);
    const filteredPlaces = filterPlaces(places, mode).map(place => ({
      ...place,
      score: calculateScore(place)
    }));

    res.json({ places: filteredPlaces });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`GastroFinder działa na http://localhost:${PORT}`));
