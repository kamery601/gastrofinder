# AUDYT ZGODNOŚCI — GOOGLE PLACES

Data: 2026-07-20. Źródło: developers.google.com/maps/documentation/places/web-service/policies
(sprawdzone w dniu audytu). Ten dokument to techniczny audyt implementacyjny —
NIE jest opinią prawną. Pozycje niejednoznaczne oznaczono `BLOCKED_COMPLIANCE`.

## Co potwierdzają zasady Google (stan na dzień audytu)

1. **Place ID — trwałe przechowywanie DOZWOLONE.** Polityka wprost: place ID
   jest wyłączony z restrykcji cache i można go przechowywać bezterminowo
   (z zaleceniem odświeżenia po 12 miesiącach). ⇒ Fundament katalogu
   `places_core` (Place ID jako główny identyfikator zewnętrzny) jest zgodny.
2. **Pozostała treść Places (rating, godziny, adres, nazwa) — zakaz trwałego
   przechowywania** poza dozwolonymi wyjątkami; polityka nie podaje jednego
   uniwersalnego limitu czasowego. ⇒ Nasz model `place_dynamic_cache`
   z `fetched_at`/`valid_until` i automatycznym wygaszaniem jest właściwym
   wzorcem; TTL trzymać krótkie (godziny–dni, nie miesiące).
3. **Atrybucja bez mapy Google — WYMAGANA.** Logo Google Maps (lub tekst przy
   braku miejsca), kontrast ≥4.5:1, przy górze/dole treści.
4. **Zdjęcia i opinie:** autor (nazwa/avatar/link), link do źródła
   (`googleMapsUri`), data względna, mechanizm zgłaszania (`flagContentUri`);
   dla lokali we Francji dodatkowo `visitDate`.
5. **EEA:** obowiązują osobne warunki dla klientów z EOG.

## Ocena obecnej implementacji (SHA 4757138)

| Obszar | Stan | Ocena |
|---|---|---|
| Cache wyników (10 min, in-memory, ulotny) | krótki TTL, znika przy restarcie | ✅ bezpieczny |
| Place ID | nie przechowujemy trwale (jeszcze) | ✅ / planowane zgodnie z wyjątkiem |
| Zdjęcia | nie pobieramy (brak w FieldMask) | ✅ nic do atrybucji |
| Opinie (treść) | nie pobieramy | ✅ |
| googleMapsUri jako link do źródła | jest na każdej karcie | ✅ |
| **Atrybucja Google przy danych bez mapy** | **BRAK logo/tekstu Google przy liście wyników** | ⚠️ **DO NAPRAWY (P1)** — dane Places wyświetlamy na własnym UI z mapą OSM/Leaflet, nie Google Map ⇒ wymagana atrybucja tekst/logo |
| Privacy Policy / Terms strony | brak podstron | ⚠️ P2 — wymagane przy dalszej rozbudowie |

## BLOCKED_COMPLIANCE — nie wdrażać bez wyjaśnienia

1. **Trwałe przechowywanie lat/lng miejsc w places_core** — polityka nie daje
   jasnego wyjątku dla współrzędnych. Decyzja: kolumny `latitude/longitude`
   w places_core oznaczone „subject to compliance review"; do czasu wyjaśnienia
   przechowujemy je wyłącznie w `place_dynamic_cache` (TTL) albo wcale —
   katalog może żyć samym Place ID + własną klasyfikacją.
2. **REVIEWS_SAMPLE w dynamic cache** — pobranie próbki opinii dopuszczalne
   przy wyświetleniu z pełną atrybucją; ZAPIS nawet krótkoterminowy wymaga
   przeglądu. Do wyjaśnienia przed implementacją field_group=REVIEWS_SAMPLE.
3. **PHOTOS** — przechowywanie kopii zdjęć zabronione bez osobnych praw;
   dozwolone tylko podawanie referencji photo i lazy-load z API z atrybucją.

## Wnioski dla architektury Platform Core

- `places_core`: Place ID + dane WŁASNE (klasyfikacje, regiony, statusy,
  kuratorstwo) — zgodne.
- `place_dynamic_cache`: wyłącznie dane Google z TTL i automatycznym
  wygaszaniem — zgodne co do wzorca; TTL konserwatywne.
- Bez kolumn z kopiami: zdjęć, treści opinii, długoterminowych adresów.
- Frontend: dodać atrybucję Google przy wynikach (P1, mała zmiana UI).
