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
