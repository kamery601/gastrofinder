# PLATFORM CORE — BASELINE AUDIT

Data audytu: 2026-07-20. Wszystkie wartości poniżej zostały zebrane komendami,
nie przepisane z wcześniejszych raportów.

## Stan repozytorium

- **SHA bazowy:** `4757138` (feat: add tourist region navigation...)
- **Branch:** `main`, zsynchronizowany z `origin/main` (github.com/kamery601/gastrofinder)
- **Working tree:** clean w chwili audytu
- **Tag backupowy:** `gastrofinder-pre-platform-core` → `4757138` (wypchnięty do origin)
- **Testy:** `npm test` → **114/114 pass** (node --test, bez lint/typecheck/build — te skrypty nie istnieją)

## Weryfikacja produkcji (dowody, nie deklaracja)

- `GET /sw.js` na https://gastrofinder-production.up.railway.app → `CACHE_NAME = 'gastrofinder-v4'`
- `GET /regions.js` → zawiera `tatry-wysokie` (regiony wdrożone)
- `GET /api/geocode?address=Zakopane&country=PL` → HTTP 200
- Wniosek: produkcja odpowiada kodowi `4757138`.

## Aktywna konfiguracja

- **Kraje:** PL (domyślny), SK, HU — `public/countries.js` (UMD, jedno źródło dla frontu i serwera)
- **Regiony:** 10 (PL: Podhale i Tatry / Pieniny / Kraków i okolice; SK: Tatry Wysokie / Liptów i Jasná / Orawa / Duże miasta; HU: Termy pn-wsch / Budapeszt i okolice / Balaton) — `public/regions.js`
- **Tryby:** `food`, `clubs`, `shops24` — `SEARCH_CONFIG` w `placesService.js`

## Google API — stan obecny

- **Endpointy:** `places.googleapis.com/v1/places:searchNearby` (POST), `maps.googleapis.com/maps/api/geocode/json` (GET)
- **FieldMask (searchNearby):** `places.id, displayName, formattedAddress, rating, userRatingCount, priceLevel, types, currentOpeningHours, regularOpeningHours, businessStatus, googleMapsUri, location` — jedna maska dla wszystkiego (lista = karta; brak rozdziału Essentials/Pro per ekran)
- **Zapytania na jedno wyszukiwanie (cold cache):** 1× geocode + N typów × 2 rankingi (POPULARITY+DISTANCE): food=20, clubs=4, shops24=10 zapytań Nearby
- **Cache:** in-memory `Map` (cache.js), TTL 10 min, klucze: `geocode:CC:query`, `nearby:CC:mode:lat:lng(5dp)`. **Cache ginie przy restarcie kontenera** — brak trwałej bazy w projekcie (zweryfikowano grep: zero postgres/sqlite/prisma/knex).
- **Limity:** MAX_PLACES=300 (merged), rate limit 30 req/min/IP na `/api/*`, timeout 8 s per zapytanie zewnętrzne, Promise.allSettled (częściowe awarie nie wywracają wyniku)

## Zmienne środowiskowe (struktura, bez wartości)

- `GOOGLE_API_KEY` (Railway Variables + lokalny .env, poza gitem)
- `PORT` (wstrzykiwany przez Railway)

## Telemetria

- `search coverage`: country, byRank, totalRaw, afterDedup, capped
- `filters`: country, accepted/total, rejectedReasons (agregat)
- Logger: `[ISO] [LEVEL] [moduł] wiadomość {meta}` → stdout (Railway logs)

## Znane ograniczenia

1. **Brak trwałej bazy** — każdy restart = zimny cache = pełny koszt Google.
2. **Jedna FieldMask** — karta i lista pobierają to samo; brak rozdziału kosztowego SKU.
3. **Strefy czasowe** — godziny liczone zegarem przeglądarki; poprawne dla CET (PL/SK/HU/CZ/AT/HR/IT), niepoprawne poza CET (znane rozwiązanie: utcOffsetMinutes).
4. **Brak feature flags** — konfiguracja krajów jest binarna (jest wpis = działa).
5. **`primaryType`** świadomie nieużywany (Pro SKU, wyższy koszt).
6. **`railway logs`** nie streamuje w nieinteraktywnej powłoce — odczyt logów tylko przez dashboard.

## Miejsca silnie sprzężone z obecnym frontendem

- `server.js` → `respondWithNearbyPlaces` zwraca płaską listę `{places:[...]}` — frontend (`app.js parsePlaces`) zależy od kształtu pól Google + `score`, `reviewConfidence`, `distanceKm`, `priceLevel` (znormalizowany). Kontrakt do zachowania przy wprowadzaniu katalogu.
- `public/app.js` — stan globalny (currentCountry/Region/Mode/Sort), rendering string-template.
- SW `NETWORK_FIRST_PATHS` musi znać nowe pliki konfiguracji — każdy nowy plik konfiguracyjny = bump SW.

## Decyzja o bazie danych (rekomendacja do zatwierdzenia)

Projekt NIE MA trwałej bazy. Rekomendacja: **PostgreSQL jako usługa Railway**
(ten sam projekt co serwis findresto), sterownik **`pg` (node-postgres) bez
ciężkiego ORM** — stack to czysty Node/Express bez TypeScript, więc goły SQL z
migracjami plikowymi jest najprostszy do audytu i rollbacku; ORM (Prisma itd.)
dodałby build-step i zależności bez proporcjonalnej korzyści. Redis: brak w
projekcie; jeśli kiedyś powstanie — wyłącznie jako cache, nigdy katalog.

**UWAGA:** provisioning PostgreSQL na Railway to decyzja kosztowa właściciela —
kod katalogu ma działać w trybie „DB nieobecna → pełny fallback do live search"
(CATALOG_* flags off), więc wdrożenie kodu jest bezpieczne przed provisioningiem.
