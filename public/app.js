let allRestaurants = [];
let currentSort = 'rating';
let currentMode = 'food';
let simHour = new Date().getHours();
let simMin = new Date().getMinutes();
let mapCenter = null;
let userLocation = null;
let filterControls = null;
let mapView = null;

const PRICE_MAP = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4
};

function checkOpenAtTime(place, hour, minute) {
  return GastroOpeningHours.isOpenAt(place, hour, minute);
}

function resetToNow() {
  const n = new Date();
  simHour = n.getHours();
  simMin = n.getMinutes();
  document.getElementById('simulatedTime').value =
    String(simHour).padStart(2, '0') + ':' + String(simMin).padStart(2, '0');
  if (allRestaurants.length) renderResults();
}

function onTimeChange() {
  const v = document.getElementById('simulatedTime').value;
  if (!v) return;
  [simHour, simMin] = v.split(':').map(Number);
  if (allRestaurants.length) renderResults();
}

function setMode(mode) {
  currentMode = mode;
  ['food', 'clubs', 'shops24'].forEach((m) => {
    const btn = document.getElementById('tab-' + m);
    btn.className = 'mode-tab ' + m + (m === mode ? ' active' : ' inactive');
  });
  if (filterControls) filterControls.reset();
  const city = document.getElementById('cityInput').value.trim();
  if (city) startSearch();
}

function setSort(sortKey) {
  currentSort = sortKey;
  ['rating', 'distance', 'price', 'value'].forEach((s) => {
    document.getElementById('sort-' + s).className = 'sort-btn ' + (s === sortKey ? 'active' : 'inactive');
  });
  renderResults();
}

function setStatus(state, text) {
  document.getElementById('statusDot').className = 'status-dot ' + state;
  document.getElementById('statusText').textContent = text;
}

function setLoading(on) {
  const searchBtn = document.getElementById('searchBtn');
  const geoBtn = document.getElementById('geoBtn');
  searchBtn.disabled = on;
  geoBtn.disabled = on;
  searchBtn.textContent = on ? 'Szukam...' : 'Szukaj';
  if (on) {
    document.getElementById('restaurantsList').innerHTML =
      Array(6).fill('<div class="skeleton"></div>').join('');
    if (mapView) mapView.hide();
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function priceStr(lvl) {
  if (lvl === null || lvl === undefined) return '<span style="color:var(--g400)">–</span>';
  return ['', '$', '$$', '$$$', '$$$$'][lvl] || '–';
}

function formatDistance(km) {
  if (km === null || km === undefined) return '–';
  if (km < 1) return Math.max(50, Math.round(km * 1000)) + ' m';
  return km.toFixed(1) + ' km';
}

function typeLabel(types, mode) {
  if (mode === 'clubs') {
    const m = { night_club: 'Klub nocny', bar: 'Bar', live_music_venue: 'Live music', pub: 'Pub', disco: 'Dyskoteka' };
    for (const t of types || []) if (m[t]) return m[t];
    return 'Klub / bar';
  }
  if (mode === 'shops24') {
    const m = {
      convenience_store: 'Sklep całodobowy',
      supermarket: 'Supermarket',
      grocery_store: 'Sklep spożywczy',
      gas_station: 'Stacja paliw',
      pharmacy: 'Apteka'
    };
    for (const t of types || []) if (m[t]) return m[t];
    return 'Sklep';
  }
  const m = {
    restaurant: 'Restauracja',
    cafe: 'Kawiarnia',
    bar: 'Bar',
    bakery: 'Piekarnia',
    meal_takeaway: 'Na wynos',
    meal_delivery: 'Dostawa',
    coffee_shop: 'Kawiarnia',
    fast_food_restaurant: 'Fast food',
    pizza_restaurant: 'Pizza',
    kebab_shop: 'Kebab'
  };
  for (const t of types || []) if (m[t]) return m[t];
  return 'Lokal';
}

function parsePlaces(places) {
  return places.map((p) => ({
    name: p.displayName?.text || '?',
    address: p.formattedAddress || '',
    rating: p.rating || 0,
    ratingCount: p.userRatingCount || 0,
    priceLevel: PRICE_MAP[p.priceLevel] != null ? PRICE_MAP[p.priceLevel] : null,
    distanceKm: p.distanceKm ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    score: p.score ?? null,
    types: p.types || [],
    currentOpeningHours: p.currentOpeningHours || {},
    regularOpeningHours: p.regularOpeningHours || {},
    mapsUrl:
      p.googleMapsUri ||
      'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.displayName?.text || '')
  }));
}

function sortPlaces(places) {
  const statusOrder = (v) => (v === true ? 0 : v === false ? 2 : 1);

  return [...places].sort((a, b) => {
    const aOpen = checkOpenAtTime(a, simHour, simMin);
    const bOpen = checkOpenAtTime(b, simHour, simMin);
    const statusDiff = statusOrder(aOpen) - statusOrder(bOpen);
    if (statusDiff !== 0) return statusDiff;

    if (currentSort === 'distance') {
      return (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999);
    }
    if (currentSort === 'rating') {
      return (b.score ?? 0) - (a.score ?? 0);
    }
    if (currentSort === 'price') {
      return (a.priceLevel ?? 99) - (b.priceLevel ?? 99);
    }

    const valueA = a.priceLevel ? a.rating / Math.max(1, a.priceLevel) : a.rating * 0.55;
    const valueB = b.priceLevel ? b.rating / Math.max(1, b.priceLevel) : b.rating * 0.55;
    return valueB - valueA;
  });
}

function getActiveFilters() {
  return filterControls ? filterControls.getState() : GastroFilters.defaultFilters();
}

function getVisiblePlaces() {
  const filters = getActiveFilters();
  const sorted = sortPlaces(allRestaurants);
  return GastroFilters.applyFilters(sorted, filters, (place) => checkOpenAtTime(place, simHour, simMin));
}

function updateStatusSummary() {
  const visible = getVisiblePlaces();
  const openCount = visible.filter((r) => checkOpenAtTime(r, simHour, simMin) === true).length;
  const closedCount = visible.filter((r) => checkOpenAtTime(r, simHour, simMin) === false).length;
  const unknownCount = visible.filter((r) => checkOpenAtTime(r, simHour, simMin) === null).length;
  const timeStr = String(simHour).padStart(2, '0') + ':' + String(simMin).padStart(2, '0');
  const filterNote = visible.length !== allRestaurants.length
    ? ` · po filtrach: ${visible.length}/${allRestaurants.length}`
    : '';

  setStatus(
    'done',
    `${allRestaurants.length} lokali${filterNote} — ${openCount} otwartych, ${closedCount} zamkniętych` +
      (unknownCount ? `, ${unknownCount} bez danych` : '') +
      ` (godz. ${timeStr})`
  );
}

function renderList(visible) {
  const list = document.getElementById('restaurantsList');

  if (!visible.length) {
    list.innerHTML =
      '<div class="empty-state"><h3>Brak wyników</h3><p>Żaden lokal nie spełnia wybranych filtrów. Zmień kryteria wyszukiwania.</p></div>';
    return;
  }

  list.innerHTML = visible
    .map((r) => {
      const openStatus = checkOpenAtTime(r, simHour, simMin);
      const sc = openStatus === true ? 'open' : openStatus === false ? 'closed' : 'unknown';
      const lb = openStatus === true ? 'Otwarte' : openStatus === false ? 'Zamknięte' : 'Brak danych';
      return `<div class="resto-card is-${sc} mode-${currentMode}">
      <div class="card-body">
        <div class="card-top">
          <div class="card-name">${esc(r.name)}</div>
          <span class="open-badge ${sc}">${lb}</span>
        </div>
        <div class="card-type">${typeLabel(r.types, currentMode)}</div>
        <a class="card-address" href="${r.mapsUrl}" target="_blank" rel="noopener">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${esc(r.address)}
        </a>
        <a class="maps-btn" href="${r.mapsUrl}" target="_blank" rel="noopener">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Google Maps
        </a>
      </div>
      <div class="card-footer">
        <div>
          <div style="display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap;">
            <div class="rating-badge">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--a200)" stroke="var(--a200)" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              ${r.rating ? r.rating.toFixed(1) : '–'}
              <span class="rating-count">${r.ratingCount ? '(' + r.ratingCount.toLocaleString('pl') + ')' : ''}</span>
            </div>
            ${r.distanceKm != null ? '<div class="distance-badge">' + formatDistance(r.distanceKm) + '</div>' : ''}
          </div>
        </div>
        <div class="price-badge">${priceStr(r.priceLevel)}</div>
      </div>
    </div>`;
    })
    .join('');
}

function renderResults() {
  const visible = getVisiblePlaces();
  updateStatusSummary();
  renderList(visible);

  if (mapView && mapCenter) {
    mapView.renderMarkers(visible, mapCenter, {
      getOpenStatus: (place) => checkOpenAtTime(place, simHour, simMin),
      formatDistance,
      esc
    });
    if (userLocation) {
      mapView.setUserLocation(userLocation.lat, userLocation.lng);
    }
  }
}

function handleNearbyResponse(near, center) {
  const places = near.places || [];
  if (!places.length) {
    setStatus('done', 'Brak wyników w okolicy.');
    document.getElementById('restaurantsList').innerHTML =
      '<div class="empty-state"><h3>Brak wyników</h3><p>Nie znaleziono lokali w promieniu 3 km.</p></div>';
    if (mapView) mapView.hide();
    return false;
  }

  allRestaurants = parsePlaces(places);
  mapCenter = center;
  renderResults();
  return true;
}

async function useMyLocation() {
  document.getElementById('mainContent').style.display = 'block';
  setLoading(true);

  if (!navigator.geolocation) {
    setLoading(false);
    setStatus('error', 'Brak wsparcia dla geolokalizacji');
    document.getElementById('restaurantsList').innerHTML =
      '<div class="empty-state"><h3>Geolokalizacja niedostępna</h3><p>Twoja przeglądarka nie wspiera funkcji lokalizacji.</p></div>';
    return;
  }

  const getPosition = (options) =>
    new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));

  try {
    let position;
    try {
      position = await getPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
    } catch (error1) {
      if (error1.code === 3 || error1.code === 2) {
        position = await getPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
      } else {
        throw error1;
      }
    }

    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    userLocation = { lat, lng };

    const nearRes = await fetch(
      '/api/nearby-location?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng) + '&mode=' + currentMode
    );
    const near = await nearRes.json();

    if (near.error) {
      setStatus('error', 'Błąd wyszukiwania');
      document.getElementById('restaurantsList').innerHTML =
        '<div class="empty-state"><h3>Błąd API</h3><p>' + esc(near.error.message || JSON.stringify(near.error)) + '</p></div>';
      return;
    }

    setLoading(false);
    handleNearbyResponse(near, { lat, lng });
  } catch (error) {
    setLoading(false);
    let errorMsg = 'Nie udało się pobrać lokalizacji';
    let errorDetail = error.message || '';

    if (error.code === 1) {
      errorMsg = 'Odmowa dostępu do lokalizacji';
      errorDetail = 'Zezwól na lokalizację w ustawieniach przeglądarki.';
    } else if (error.code === 2) {
      errorMsg = 'Pozycja niedostępna';
      errorDetail = 'Nie można pobrać sygnału GPS. Spróbuj ponownie za chwilę.';
    } else if (error.code === 3) {
      errorMsg = 'Przekroczony czas oczekiwania';
      errorDetail = 'Wyszukiwanie pozycji trwało zbyt długo. Spróbuj ponownie.';
    }

    setStatus('error', errorMsg);
    document.getElementById('restaurantsList').innerHTML =
      '<div class="empty-state"><h3>' +
      errorMsg +
      '</h3><p>' +
      esc(errorDetail) +
      '</p><p style="font-size:0.85rem;color:var(--g400);margin-top:1rem;">Alternatywa: wyszukaj manualnie miasto w polu powyżej.</p></div>';
  }
}

async function startSearch() {
  const city = document.getElementById('cityInput').value.trim();
  if (!city) {
    document.getElementById('cityInput').focus();
    return;
  }

  document.getElementById('mainContent').style.display = 'block';
  userLocation = null;
  const modeLabels = { food: 'restauracji i barów', clubs: 'klubów i dyskotek', shops24: 'sklepów' };
  setStatus('searching', 'Szukam ' + modeLabels[currentMode] + ' w: ' + city + '...');
  setLoading(true);

  try {
    const geoRes = await fetch('/api/geocode?address=' + encodeURIComponent(city + ', Polska'));
    const geo = await geoRes.json();
    if (!geo.results?.length) {
      setStatus('error', 'Nie znaleziono miasta.');
      document.getElementById('restaurantsList').innerHTML =
        '<div class="empty-state"><h3>Nie znaleziono</h3><p>Sprawdź pisownię nazwy miasta.</p></div>';
      return;
    }

    const loc = geo.results[0].geometry.location;
    mapCenter = { lat: loc.lat, lng: loc.lng };
    const nearRes = await fetch('/api/nearby?location=' + loc.lat + ',' + loc.lng + '&mode=' + currentMode);
    const near = await nearRes.json();

    if (near.error) {
      setStatus('error', 'Błąd API: ' + (near.error.message || ''));
      document.getElementById('restaurantsList').innerHTML =
        '<div class="empty-state"><h3>Błąd API</h3><p>' + esc(near.error.message || '') + '</p></div>';
      return;
    }

    handleNearbyResponse(near, mapCenter);
  } catch (e) {
    setStatus('error', 'Błąd: ' + e.message);
    document.getElementById('restaurantsList').innerHTML =
      '<div class="empty-state"><h3>Błąd</h3><p>' + esc(e.message) + '</p></div>';
  } finally {
    setLoading(false);
  }
}

function initFilters() {
  filterControls = GastroFilters.bindFilterControls({
    getMode: () => currentMode,
    onChange: () => renderResults(),
    elements: {
      maxDistanceSelect: document.getElementById('filterMaxDistance'),
      minRatingSelect: document.getElementById('filterMinRating'),
      onlyOpenBtn: document.getElementById('filterOnlyOpen'),
      hideUnknownBtn: document.getElementById('filterHideUnknown'),
      venueTypeRow: document.getElementById('venueTypeRow')
    }
  });
}

function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });

  let deferredPrompt = null;
  const installBtn = document.getElementById('installBtn');
  if (!installBtn) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installBtn.style.display = 'inline-flex';
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });
}

function initApp() {
  mapView = GastroMap.createMapView('resultsMap');
  initFilters();
  initPwa();
  resetToNow();
}

window.startSearch = startSearch;
window.useMyLocation = useMyLocation;
window.setMode = setMode;
window.setSort = setSort;
window.resetToNow = resetToNow;
window.onTimeChange = onTimeChange;
window.onload = initApp;
