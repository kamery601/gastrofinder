# Changelog

## Etap 4 – filtry, mapa i PWA

### 4A Filtry UX
- max odległość (500 m – 5 km)
- min. ocena (3.5+, 4.0+, 4.5+)
- tylko otwarte
- ukryj lokale bez danych o godzinach
- typ lokalu: pizza, kebab, kawiarnia, restauracja, bar

### 4B Mapa
- Leaflet + OpenStreetMap
- pinezki zielone / czerwone / szare
- popup: nazwa, status, ocena, odległość, link Google Maps
- marker użytkownika przy wyszukiwaniu GPS

### 4C PWA
- `manifest.json`
- ikony 192 / 512 / maskable
- service worker (cache powłoki aplikacji)

## Etap 3 – poprawki krytyczne i dopracowanie

- naprawiono liczenie odległości (Google Places zwraca `latitude`/`longitude`, nie `lat`/`lng`)
- ujednolicono logikę godzin otwarcia (frontend używa tej samej implementacji co backend)
- sortowanie „Najlepsze” oparte o `rating × log10(opinie + 10)` zamiast złożonego score
- równoległe zapytania Places API (szybsze wyszukiwanie)
- refaktoryzacja endpointów `/api/nearby` i `/api/nearby-location`
- walidacja `GOOGLE_API_KEY` i współrzędnych
- odległość wyświetlana w metrach poniżej 1 km

## Etap 2 – GPS, odległość, ranking i UX

- dodano wyszukiwanie po lokalizacji GPS
- dodano endpoint /api/nearby-location
- dodano liczenie odległości Haversine
- dodano score dla wyników
- poprawiono sortowanie Najlepsze i Najbliższe
- dodano tryb shops24
- dodano cache TTL 10 minut
- poprawiono komunikaty GPS i loading state
- dodano testy dla distance, ranking i openingHours
