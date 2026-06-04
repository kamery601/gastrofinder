require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_API_KEY;

app.use(express.static('public'));

app.get('/api/geocode', async (req, res) => {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(req.query.address)}&key=${API_KEY}&language=pl`;
    const r = await fetch(url);
    res.json(await r.json());
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/nearby', async (req, res) => {
  try {
    const [lat, lng] = req.query.location.split(',');
    const center = { latitude: parseFloat(lat), longitude: parseFloat(lng) };
    const mode = req.query.mode || 'food'; // food | clubs | shops24

    let includedTypes, excludedTypes = [];
    const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.types,places.currentOpeningHours,places.businessStatus,places.googleMapsUri';

    if (mode === 'clubs') {
      includedTypes = ['night_club', 'live_music_venue'];
      excludedTypes = ['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house'];
    } else if (mode === 'shops24') {
      includedTypes = ['convenience_store', 'supermarket', 'grocery_store', 'gas_station', 'pharmacy'];
      excludedTypes = ['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house'];
    } else {
      // food mode
      includedTypes = ['restaurant', 'cafe', 'bar'];
      excludedTypes = ['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house'];
    }

    const seen = new Set();
    let allPlaces = [];

    for (const type of includedTypes) {
      const body = {
        includedTypes: [type],
        maxResultCount: 20,
        locationRestriction: { circle: { center, radius: 3000.0 } },
        rankPreference: 'POPULARITY'
      };
      if (excludedTypes.length) body.excludedTypes = excludedTypes;

      const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': FIELD_MASK
        },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if (data.error) { res.status(500).json(data); return; }
      for (const p of (data.places || [])) {
        if (!seen.has(p.id)) { seen.add(p.id); allPlaces.push(p); }
      }
    }

    // Filtry wspólne
    const LODGING = new Set(['lodging','hotel','motel','resort_hotel','extended_stay_hotel','bed_and_breakfast','hostel','guest_house','inn']);
    const EXCLUDED_NAMES = ['żabka','zabka','shell','bp stacja','orlen','circle k','biedronka','lidl','auchan','carrefour'];

    allPlaces = allPlaces.filter(p => {
      if (p.businessStatus !== 'OPERATIONAL') return false;
      const types = p.types || [];
      const name = (p.displayName?.text || '').toLowerCase();

      if (mode === 'food') {
        if (types[0] && LODGING.has(types[0])) return false;
        if (types.includes('lodging') && !p.currentOpeningHours) return false;
        const NIGHTCLUB = new Set(['night_club','amusement_center','casino','live_music_venue']);
        const FOOD = new Set(['restaurant','cafe','bar','meal_takeaway','meal_delivery','bakery','fast_food_restaurant','pizza_restaurant']);
        if (types[0] && NIGHTCLUB.has(types[0])) return false;
        if (types.includes('night_club') && !types.some(t => FOOD.has(t))) return false;
        if (EXCLUDED_NAMES.some(n => name.includes(n))) return false;
        const NON_FOOD = new Set(['gas_station','car_wash','grocery_store','supermarket','convenience_store','book_store','clothing_store','liquor_store','courier_service','shipping_service']);
        if (types[0] && NON_FOOD.has(types[0])) return false;
      }

      if (mode === 'clubs') {
        const CLUB_TYPES = new Set(['night_club','live_music_venue']);
        const NON_CLUB = new Set(['restaurant','cafe','bakery','fast_food_restaurant','meal_takeaway','meal_delivery','bar','pub','pizza_restaurant','burger_restaurant']);
        // Musi zawierać night_club LUB live_music_venue
        if (!types.some(t => CLUB_TYPES.has(t))) return false;
        // Nie może zawierać hotelu/zakwaterowania
        if (types.some(t => LODGING.has(t))) return false;
        // Nie może zawierać restauracji/baru/pubu NA ŻADNEJ POZYCJI
        if (types.some(t => NON_CLUB.has(t))) return false;
      }

      if (mode === 'shops24') {
        // Tylko sklepy czynne całą dobę lub późno — pokażemy wszystkie z otwartymi godzinami
      }

      return true;
    });

    res.json({ places: allPlaces });
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.listen(PORT, () => console.log(`GastroFinder działa na http://localhost:${PORT}`));
