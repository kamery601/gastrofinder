# ROLLBACK — PLATFORM CORE

Plan powrotu do stanu sprzed programu Platform Core. Punkt odniesienia:
tag `gastrofinder-pre-platform-core` = SHA `4757138` (produkcja z SW v4,
kraje PL/SK/HU, regiony, tryby food/clubs/shops24, testy 114/114).

## Rollback pełny (kod)

```bash
cd ~/findResto
git status                     # najpierw: nic niezacommitowanego do stracenia
git checkout main
git reset --hard gastrofinder-pre-platform-core
git push --force-with-lease origin main   # Railway auto-deploy z main
```

Weryfikacja po deployu:
```bash
curl -s https://gastrofinder-production.up.railway.app/sw.js | grep CACHE_NAME
# oczekiwane: gastrofinder-v4
curl -s "https://gastrofinder-production.up.railway.app/api/nearby?location=49.299181,19.9495621&mode=food&country=PL" | python3 -c "import json,sys;print(len(json.load(sys.stdin)['places']))"
# oczekiwane: ~142 dla Zakopanego
```

## Rollback selektywny (flagi, bez cofania kodu)

Platform Core jest projektowany flag-first. Wyłączenie w Railway → Variables
(restart kontenera stosuje zmiany):

| Problem | Flaga | Efekt |
|---|---|---|
| Katalog psuje wyniki | `CATALOG_READ_ENABLED=false` | powrót do czystego live search |
| Zapis do DB zawodzi | `CATALOG_WRITE_ENABLED=false` | discovery przestaje pisać |
| DB w ogóle padła | `CATALOG_CORE_ENABLED=false` | katalog całkowicie ominięty |
| AQUA daje śmieci | `MODE_AQUA_ENABLED=false` | zakładka znika |
| Nowy kraj daje śmieci | `COUNTRY_CZ_ENABLED=false` (analogicznie AT/HR/IT) | kraj znika z selektora |
| Discovery przepala budżet | `DISCOVERY_ENABLED=false` | żadnych runów |

Zasada wbudowana w kod: **brak `DATABASE_URL` lub wyłączone flagi ⇒ aplikacja
działa dokładnie jak w `4757138` (live search PL/SK/HU)**. Fallback nie jest
osobnym trybem awaryjnym — to domyślna ścieżka przy wyłączonych flagach.

## Service Worker

Rollback kodu przywraca SW v4 — użytkownicy z nowszą wersją dostaną v4 przy
następnym wejściu (HTML jest network-first od v3, `activate` czyści stare
cache). Nie trzeba ręcznie czyścić pamięci klientów. Gdyby nowy SW był
uszkodzony tak, że nie serwuje HTML: Railway → redeploy z tagu wystarcza,
bo SW sam pobiera nowy `sw.js` przy nawigacji (max opóźnienie: 24 h zgodnie
ze specyfikacją SW, zwykle natychmiast przy network-first HTML).

## Dane własne (katalog)

- Backup przed migracjami schematu: `pg_dump` z Railway (dashboard → Postgres
  → Backups albo `pg_dump $DATABASE_URL > backup-$(date +%F).sql` lokalnie).
- Backupów NIE commitować do gita.
- Migracje mają pliki `down` — cofnięcie schematu bez kasowania całej bazy.
- Skasowanie/wyłączenie bazy przy CATALOG_CORE_ENABLED=false nie wpływa na
  działanie aplikacji (fallback = live search).

## Czyszczenie błędnego cache

- Cache wyszukiwania jest in-memory → restart kontenera Railway czyści go w całości.
- Cache PWA: bump `CACHE_NAME` w sw.js + deploy (stary cache usuwany w `activate`).
