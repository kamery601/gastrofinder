let allRestaurants = [];
let currentSort = 'rating';
let currentMode = 'food';
let currentCountry = 'PL';
let simHour = new Date().getHours();
let simMin = new Date().getMinutes();
let manualTime = false;
let mapCenter = null;
let userLocation = null;
let locationContext = null;
let filterControls = null;
let mapView = null;

function checkOpenAtTime(place, hour, minute) {
  return GastroOpeningHours.isOpenAt(place, hour, minute);
}

function getOpeningDetails(place) {
  return GastroOpeningHours.getOpeningStatusDetails(place, simHour, simMin, { isManual: manualTime });
}

function getTimeStr() {
  return String(simHour).padStart(2, '0') + ':' + String(simMin).padStart(2, '0');
}

function timeStatusLabel() {
  return `godz. ${getTimeStr()}, ${manualTime ? 'wybrana ręcznie' : 'teraz'}`;
}

function applyCurrentTime() {
  const n = new Date();
  simHour = n.getHours();
  simMin = n.getMinutes();
  const input = document.getElementById('simulatedTime');
  if (input) input.value = getTimeStr();
}

function refreshToNowIfAuto(options = {}) {
  if (manualTime) return false;
  applyCurrentTime();
  if (options.render && allRestaurants.length) renderResults();
  return true;
}

function resetToNow() {
  manualTime = false;
  applyCurrentTime();
  if (allRestaurants.length) renderResults();
}

function onTimeChange() {
  const v = document.getElementById('simulatedTime').value;
  if (!v) return;
  [simHour, simMin] = v.split(':').map(Number);
  manualTime = true;
  if (allRestaurants.length) renderResults();
}

function initTimeHandling() {
  manualTime = false;
  applyCurrentTime();

  const timeInput = document.getElementById('simulatedTime');
  if (timeInput) {
    timeInput.addEventListener('change', onTimeChange);
    timeInput.addEventListener('input', onTimeChange);
  }

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      refreshToNowIfAuto({ render: true });
    }
  });
}

function syncCountryUi() {
  const config = GastroCountries.getCountry(currentCountry);
  Object.keys(GastroCountries.COUNTRIES).forEach((code) => {
    const btn = document.getElementById('country-' + code);
    if (btn) btn.setAttribute('aria-pressed', String(code === currentCountry));
  });
  const input = document.getElementById('cityInput');
  if (input) input.placeholder = config.searchPlaceholder;
}

function setCountry(code) {
  const normalized = GastroCountries.saveCountry(code);
  if (normalized === currentCountry) return;
  currentCountry = normalized;
  syncCountryUi();
  // Same convention as setMode: if a city is already typed, re-run the search
  // in the new country context so the change takes effect immediately.
  const city = document.getElementById('cityInput').value.trim();
  if (city) startSearch();
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

function renderLocationContext(context) {
  locationContext = context;
  const box = document.getElementById('locationContext');
  const resultsForEl = document.getElementById('locationResultsFor');
  const distanceNoteEl = document.getElementById('locationDistanceNote');
  const { resultsFor, distanceNote } = GastroLocation.formatMessages(context);

  if (!resultsFor && !distanceNote) {
    box.style.display = 'none';
    return;
  }
  resultsForEl.textContent = resultsFor || '';
  resultsForEl.style.display = resultsFor ? 'block' : 'none';
  distanceNoteEl.textContent = distanceNote || '';
  box.style.display = 'block';
}

function showEmptyState(title, message, variant) {
  document.getElementById('restaurantsList').innerHTML =
    `<div class="empty-state${variant ? ' ' + variant : ''}"><h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;
}

/**
 * Fetches JSON from our own API and normalizes every failure mode (network error,
 * non-2xx status, malformed JSON, or a { error } payload) into a single thrown
 * Error with a message already safe to show the user.
 */
async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error('Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.');
  }

  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error('Otrzymano nieprawidłową odpowiedź serwera.');
  }

  if (!res.ok || json.error) {
    throw new Error(json.error || `Błąd serwera (${res.status})`);
  }
  return json;
}

/**
 * Central handler for any failed API call: logs the technical detail to the
 * console for debugging, and shows a single, consistent, Polish-language error
 * state to the user (never a raw stack trace or "undefined").
 */
function handleApiError(error, context) {
  console.error(`[GastroFinder] ${context}:`, error);
  const message = error?.message || 'Wystąpił nieoczekiwany błąd.';
  setStatus('error', message);
  showEmptyState('Błąd', message, 'is-error');
  renderLocationContext(null);
  if (mapView) mapView.hide();
}

function priceStr(lvl) {
  if (lvl === null || lvl === undefined) {
    return '<span class="price-unknown" title="Brak danych o cenie">Brak ceny</span>';
  }
  return ['', '$', '$$', '$$$', '$$$$'][lvl] || '';
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
    priceLevel: typeof p.priceLevel === 'number' ? p.priceLevel : null,
    distanceKm: p.distanceKm ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    score: p.score ?? null,
    reviewConfidence: p.reviewConfidence || null,
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
    if (currentSort === 'price') {
      return GastroRankingUI.compareByPrice(a, b);
    }
    if (currentSort === 'value') {
      return GastroRankingUI.compareByValue(a, b);
    }
    return (b.score ?? 0) - (a.score ?? 0);
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

function updatePriceSortAvailability(visible) {
  const enabled = GastroRankingUI.priceSortEnabled(visible);
  const tooltip = 'Za mało lokali ma wiarygodne dane o poziomie cen.';

  ['price', 'value'].forEach((key) => {
    const btn = document.getElementById('sort-' + key);
    btn.disabled = !enabled;
    btn.setAttribute('aria-disabled', String(!enabled));
    btn.title = enabled ? '' : tooltip;
  });

  if (!enabled && (currentSort === 'price' || currentSort === 'value')) {
    currentSort = 'rating';
    ['rating', 'distance', 'price', 'value'].forEach((s) => {
      document.getElementById('sort-' + s).className = 'sort-btn ' + (s === currentSort ? 'active' : 'inactive');
    });
    return true;
  }
  return false;
}

function updateStatusSummary(visible) {
  const openCount = visible.filter((r) => checkOpenAtTime(r, simHour, simMin) === true).length;
  const closedCount = visible.filter((r) => checkOpenAtTime(r, simHour, simMin) === false).length;
  const unknownCount = visible.filter((r) => checkOpenAtTime(r, simHour, simMin) === null).length;
  const countLabel = visible.length !== allRestaurants.length
    ? `Po filtrach: ${visible.length} z ${allRestaurants.length} lokali`
    : `${allRestaurants.length} lokali`;

  setStatus(
    'done',
    `${countLabel} — ${openCount} otwartych, ${closedCount} zamkniętych` +
      (unknownCount ? `, ${unknownCount} bez danych` : '') +
      ` (${timeStatusLabel()})`
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
      const details = getOpeningDetails(r);
      const hasExtraDetail = details.closesAt || details.opensAt || details.is24Hours;
      return `<div class="resto-card is-${sc} mode-${currentMode}">
      <div class="card-body">
        <div class="card-top">
          <div class="card-name">${esc(r.name)}</div>
          <span class="open-badge ${sc}">${lb}</span>
        </div>
        <div class="card-type">${typeLabel(r.types, currentMode)}</div>
        ${hasExtraDetail ? `<div class="hours-detail">${esc(details.label)}</div>` : ''}
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
            ${r.reviewConfidence === 'very_low' ? '<span class="low-sample-hint">Mało opinii</span>' : ''}
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
  let visible = getVisiblePlaces();
  const switchedAwayFromPrice = updatePriceSortAvailability(visible);
  if (switchedAwayFromPrice) visible = getVisiblePlaces();
  updateStatusSummary(visible);
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
    if (currentMode === 'food') {
      showEmptyState(
        'Brak wyników',
        'Nie znaleziono pasujących lokali gastronomicznych w tej okolicy. Spróbuj wpisać większe miasto lub sąsiednią miejscowość.'
      );
    } else {
      showEmptyState(
        'Brak wyników',
        'Nie znaleziono lokali w promieniu 3 km. Spróbuj wpisać większe miasto lub sąsiednią miejscowość.'
      );
    }
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
    renderLocationContext(null);
    showEmptyState('Geolokalizacja niedostępna', 'Twoja przeglądarka nie wspiera funkcji lokalizacji.', 'is-error');
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
    renderLocationContext(GastroLocation.buildFromGps(lat, lng));

    // GPS is never blocked by the selected country: coordinates are the truth.
    // The country param only scopes the cache/telemetry context.
    const near = await fetchJson(
      '/api/nearby-location?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng) + '&mode=' + currentMode + '&country=' + currentCountry
    );

    setLoading(false);
    handleNearbyResponse(near, { lat, lng });
  } catch (error) {
    setLoading(false);

    if (error.code === 1 || error.code === 2 || error.code === 3) {
      const geoMessages = {
        1: ['Odmowa dostępu do lokalizacji', 'Zezwól na lokalizację w ustawieniach przeglądarki.'],
        2: ['Pozycja niedostępna', 'Nie można pobrać sygnału GPS. Spróbuj ponownie za chwilę.'],
        3: ['Przekroczony czas oczekiwania', 'Wyszukiwanie pozycji trwało zbyt długo. Spróbuj ponownie.']
      };
      const [title, detail] = geoMessages[error.code];
      setStatus('error', title);
      renderLocationContext(null);
      document.getElementById('restaurantsList').innerHTML =
        `<div class="empty-state is-error"><h3>${esc(title)}</h3><p>${esc(detail)}</p>` +
        '<p style="font-size:0.85rem;color:var(--g400);margin-top:1rem;">Alternatywa: wyszukaj manualnie miasto w polu powyżej.</p></div>';
      return;
    }

    handleApiError(error, 'useMyLocation');
  }
}

async function startSearch() {
  const city = document.getElementById('cityInput').value.trim();
  if (!city) {
    document.getElementById('cityInput').focus();
    return;
  }

  refreshToNowIfAuto();
  document.getElementById('mainContent').style.display = 'block';
  userLocation = null;
  const modeLabels = { food: 'restauracji i barów', clubs: 'klubów i dyskotek', shops24: 'sklepów' };
  setStatus('searching', 'Szukam ' + modeLabels[currentMode] + ' w: ' + city + '...');
  setLoading(true);

  try {
    const countryLabel = GastroCountries.getCountry(currentCountry).label;
    const geo = await fetchJson(
      '/api/geocode?address=' + encodeURIComponent(city) + '&country=' + currentCountry
    );
    if (!geo.results?.length) {
      renderLocationContext(null);
      setStatus('error', 'Nie znaleziono miejscowości.');
      showEmptyState('Nie znaleziono', `Nie znaleziono „${city}" w kraju: ${countryLabel}. Sprawdź pisownię lub zmień kraj.`);
      return;
    }

    const loc = geo.results[0].geometry.location;
    mapCenter = { lat: loc.lat, lng: loc.lng };
    renderLocationContext(GastroLocation.buildFromGeocode(city, geo.results[0]));
    const near = await fetchJson('/api/nearby?location=' + loc.lat + ',' + loc.lng + '&mode=' + currentMode + '&country=' + currentCountry);

    handleNearbyResponse(near, mapCenter);
  } catch (e) {
    handleApiError(e, 'startSearch');
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
  currentCountry = GastroCountries.getSavedCountry();
  syncCountryUi();
  mapView = GastroMap.createMapView('resultsMap');
  initFilters();
  initPwa();
  initTimeHandling();
}

window.startSearch = startSearch;
window.useMyLocation = useMyLocation;
window.setMode = setMode;
window.setCountry = setCountry;
window.setSort = setSort;
window.resetToNow = resetToNow;
window.onTimeChange = onTimeChange;
window.onload = initApp;
