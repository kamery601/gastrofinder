# Seasonal availability overrides

## Purpose

Google opening hours remain the live source. A locally verified seasonal
closure is attached as separate first-party metadata and takes precedence only
while its explicit validity window is active.

Automated clues (ski-lift proximity, review timing/count, seasonal wording)
may create a verification candidate in a future phase. They must never close a
place automatically.

## Production switch

`SEASONALITY_OVERRIDES_ENABLED=true`

Rollback is one environment-variable change to `false`; no database or Google
data is modified. `/api/health` exposes `seasonalityOverridesEnabled`.

## Adding or renewing a rule

Edit `lib/availability-overrides.js` and provide:

- durable Google Place ID;
- status and public label;
- season;
- verification date and source;
- inclusive `validFrom` / `validUntil` dates.

Never create an annually recurring closure. Renew it after fresh local or owner
verification. Never infer a closure from ratings, review count or location
alone.

## Current verified rule

- Bar Za Lasem, Leśna 22, Bukowina Tatrzańska
- Google Place ID: `ChIJIfGBY3H3FUcRsYNjhX6eC08`
- Closed outside the winter season through 2026-11-30
- Source class: local verification

## Audyt aktywności lokali (od 2026-10-09)

Decyzja właściciela (09.10.2026): polecamy tylko lokale, co do których mamy
dowód, że działają. Google potrafi latami pokazywać godziny i „otwarte” dla
martwych wpisów oraz budek działających tylko zimą przy wyciągach.

Mechanizm (flaga `AVAILABILITY_CHECKS_ENABLED`):

1. `scripts/audit-availability.js` bierze listy dokładnie takie, jakie widzi
   klient (produkcyjne `/api/nearby`), pobiera daty najnowszych opinii z Google
   (same daty, bez treści) i klasyfikuje każdy lokal
   (`lib/availability-checks.js`).
2. Wynik trafia do `data/availability-checks.json` — tylko identyfikator
   miejsca, werdykt, powód i daty ważności (dane własne, nie treść Google).
3. Serwer stosuje plik przy każdym wyszukiwaniu, bez dodatkowych zapytań:
   - `INACTIVE` — brak opinii od ponad 12 miesięcy → lokal ukryty;
   - `WINTER_SEASONAL` — najnowsze opinie (prawie) wyłącznie z grudnia–marca
     i nic od wiosny → poza zimą „Sezonowo zamknięte”;
   - `DORMANT` — lokal z 30+ opiniami bez żadnej od 6 miesięcy →
     „Niepotwierdzone”, nie jest pokazywany jako otwarty.
4. Każdy werdykt wygasa (INACTIVE 120 dni, DORMANT 45 dni, WINTER do 30.11) —
   bez ponownego audytu wraca czysty stan z Google.
5. Ręczna weryfikacja (`lib/availability-overrides.js`) zawsze wygrywa.

Bliskość wyciągu NIE decyduje o werdykcie (typ `ski_resort` w Google obejmuje
też szkółki, wypożyczalnie, a nawet bar sushi) — w raporcie jest tylko pomocą.

### Odświeżanie automatyczne (od 2026-10-09)

GitHub Actions `.github/workflows/monthly-availability-audit.yml` uruchamia
audyt 1. dnia każdego miesiąca o 04:00 UTC (to obejmuje 1.12 i 1.04), commituje
nowe werdykty, a Railway sam wdraża. Ręcznie: zakładka Actions → „Monthly
availability audit” → Run workflow. Klucz Google: sekret repozytorium
`GOOGLE_API_KEY`. Jeśli Google zablokuje klucz albo listy będą podejrzanie
krótkie, uruchomienie kończy się błędem, nic nie jest zapisywane, stare
werdykty zostają, a GitHub wysyła maila o niepowodzeniu.

### Odświeżenie ręczne (gdy potrzeba poza harmonogramem)

```bash
GOOGLE_API_KEY=... node scripts/audit-availability.js \
  --cache ~/gastrofinder-audit-cache.json --out ~/gastrofinder-audit.json \
  --write-checks data/availability-checks.json
npm test && git add data/availability-checks.json && git commit && git push
```

Koszt: ok. 280 zapytań Place Details (raz na audyt, mieści się w darmowym
limicie miesięcznym Google) + zwykłe wyszukiwania. Plik `--cache` sprawia, że
powtórne uruchomienie nie pyta Google o te same lokale.

Rollback: `AVAILABILITY_CHECKS_ENABLED=false` w Railway.
