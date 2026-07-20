-- Platform Core catalog schema (001, up).
-- Design rules (see docs/audits/GOOGLE-PLACES-COMPLIANCE.md):
--   * google_place_id is the durable external identifier (explicitly exempt
--     from Google's caching restrictions).
--   * place_dynamic_cache is the ONLY table holding Google-derived dynamic
--     content, always with fetched_at/valid_until - a TTL cache, never a
--     permanent copy.
--   * places_core.latitude/longitude exist in the schema but are
--     BLOCKED_COMPLIANCE: application code must not write them until the
--     compliance review clears coordinate persistence.

BEGIN;

CREATE TABLE countries (
  code              TEXT PRIMARY KEY,
  label_pl          TEXT NOT NULL,
  flag              TEXT NOT NULL,
  currency          TEXT NOT NULL,
  locale            TEXT NOT NULL,
  google_region     TEXT NOT NULL,
  component_country TEXT NOT NULL,
  timezone_strategy TEXT NOT NULL DEFAULT 'BROWSER_CET',
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  display_order     INTEGER NOT NULL DEFAULT 0,
  config_version    INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE regions (
  id            BIGSERIAL PRIMARY KEY,
  country_code  TEXT NOT NULL REFERENCES countries(code),
  slug          TEXT NOT NULL,
  label_pl      TEXT NOT NULL,
  label_local   TEXT,
  emoji         TEXT,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country_code, slug)
);

CREATE TABLE cities (
  id               BIGSERIAL PRIMARY KEY,
  country_code     TEXT NOT NULL REFERENCES countries(code),
  region_id        BIGINT REFERENCES regions(id),
  slug             TEXT NOT NULL,
  label_pl         TEXT NOT NULL,
  label_local      TEXT,
  google_query     TEXT NOT NULL,
  latitude         DOUBLE PRECISION,  -- own data: city centre start point for discovery, not a Google place
  longitude        DOUBLE PRECISION,
  discovery_radius INTEGER,
  priority         INTEGER NOT NULL DEFAULT 0,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country_code, slug)
);

CREATE TABLE places_core (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id          TEXT NOT NULL UNIQUE,
  canonical_slug           TEXT,
  country_code             TEXT NOT NULL REFERENCES countries(code),
  region_id                BIGINT REFERENCES regions(id),
  city_id                  BIGINT REFERENCES cities(id),
  latitude                 DOUBLE PRECISION,  -- BLOCKED_COMPLIANCE: do not write until review
  longitude                DOUBLE PRECISION,  -- BLOCKED_COMPLIANCE: do not write until review
  lifecycle_status         TEXT NOT NULL DEFAULT 'DISCOVERED'
    CHECK (lifecycle_status IN ('DISCOVERED','ACTIVE','SUSPECTED_CLOSED','CLOSED','MOVED','HIDDEN','ARCHIVED')),
  curation_status          TEXT NOT NULL DEFAULT 'AUTOMATIC'
    CHECK (curation_status IN ('AUTOMATIC','VERIFIED','CURATED','PARTNER','REJECTED')),
  activity_status          TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (activity_status IN ('ACTIVE_CONFIRMED','ACTIVE_LIKELY','UNKNOWN','POSSIBLY_INACTIVE','CLOSED_CONFIRMED','MOVED')),
  first_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_in_search_at   TIMESTAMPTZ,
  last_verified_at         TIMESTAMPTZ,
  next_refresh_at          TIMESTAMPTZ,
  refresh_priority         INTEGER NOT NULL DEFAULT 0,
  source_query_fingerprint TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_places_core_country ON places_core(country_code);
CREATE INDEX idx_places_core_city ON places_core(city_id);
CREATE INDEX idx_places_core_refresh ON places_core(next_refresh_at)
  WHERE lifecycle_status IN ('DISCOVERED','ACTIVE');

CREATE TABLE place_module_classifications (
  id                   BIGSERIAL PRIMARY KEY,
  place_id             UUID NOT NULL REFERENCES places_core(id) ON DELETE CASCADE,
  module               TEXT NOT NULL
    CHECK (module IN ('FOOD','BARS','SHOPS','AQUA','ATTRACTIONS','STAYS')),
  category             TEXT,
  classification_score DOUBLE PRECISION,
  confidence           TEXT,
  included             BOOLEAN NOT NULL DEFAULT FALSE,
  reason_codes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  classifier_version   TEXT NOT NULL,
  manually_overridden  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (place_id, module)
);
CREATE INDEX idx_pmc_module_included ON place_module_classifications(module, included);

CREATE TABLE place_source_refs (
  id            BIGSERIAL PRIMARY KEY,
  place_id      UUID NOT NULL REFERENCES places_core(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('GOOGLE','PARTNER','MANUAL','IMPORT')),
  external_id   TEXT NOT NULL,
  source_url    TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (source, external_id)
);

CREATE TABLE place_refresh_state (
  place_id                   UUID PRIMARY KEY REFERENCES places_core(id) ON DELETE CASCADE,
  place_id_checked_at        TIMESTAMPTZ,
  details_checked_at         TIMESTAMPTZ,
  hours_checked_at           TIMESTAMPTZ,
  rating_checked_at          TIMESTAMPTZ,
  business_status_checked_at TIMESTAMPTZ,
  next_details_refresh_at    TIMESTAMPTZ,
  consecutive_failures       INTEGER NOT NULL DEFAULT 0,
  last_error_code            TEXT,
  stale                      BOOLEAN NOT NULL DEFAULT FALSE
);

-- Google-derived dynamic content. TTL cache, NOT a permanent copy.
CREATE TABLE place_dynamic_cache (
  place_id           UUID NOT NULL REFERENCES places_core(id) ON DELETE CASCADE,
  field_group        TEXT NOT NULL
    CHECK (field_group IN ('SUMMARY','OPENING_HOURS','BUSINESS_STATUS','RATING','CONTACT','PHOTOS','REVIEWS_SAMPLE')),
  payload            JSONB NOT NULL,
  fetched_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until        TIMESTAMPTZ NOT NULL,
  source             TEXT NOT NULL DEFAULT 'GOOGLE',
  field_mask_version TEXT NOT NULL,
  PRIMARY KEY (place_id, field_group)
);
CREATE INDEX idx_pdc_expiry ON place_dynamic_cache(valid_until);

CREATE TABLE collections (
  id              BIGSERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  country_code    TEXT REFERENCES countries(code),
  region_id       BIGINT REFERENCES regions(id),
  module          TEXT NOT NULL CHECK (module IN ('FOOD','BARS','SHOPS','AQUA','ATTRACTIONS','STAYS')),
  title           TEXT NOT NULL,
  description     TEXT,
  collection_type TEXT NOT NULL CHECK (collection_type IN ('STATIC_CURATED','DYNAMIC_PRESET','PARTNER')),
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE collection_places (
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  place_id      UUID NOT NULL REFERENCES places_core(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, place_id)
);

CREATE TABLE discovery_runs (
  id                    BIGSERIAL PRIMARY KEY,
  country_code          TEXT NOT NULL,
  region_slug           TEXT,
  city_slug             TEXT,
  module                TEXT NOT NULL,
  query_strategy        TEXT NOT NULL,
  center_note           TEXT,          -- descriptive label, never user GPS
  radius_meters         INTEGER,
  rank_preference       TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  api_call_count        INTEGER NOT NULL DEFAULT 0,
  raw_results           INTEGER NOT NULL DEFAULT 0,
  unique_results        INTEGER NOT NULL DEFAULT 0,
  inserted              INTEGER NOT NULL DEFAULT 0,
  updated               INTEGER NOT NULL DEFAULT 0,
  filtered              INTEGER NOT NULL DEFAULT 0,
  failed                INTEGER NOT NULL DEFAULT 0,
  capped                BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms           INTEGER,
  estimated_cost_bucket TEXT,
  status                TEXT NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING','COMPLETED','INTERRUPTED','FAILED','DRY_RUN'))
);

CREATE TABLE discovery_results (
  id              BIGSERIAL PRIMARY KEY,
  run_id          BIGINT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  google_place_id TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('INSERTED','UPDATED','FILTERED','FAILED')),
  reason_code     TEXT
);

CREATE TABLE partners (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  contact_email TEXT,
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED','ARCHIVED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partner-owned data: NOT Google cache, separate ownership model.
CREATE TABLE partner_properties (
  id                 BIGSERIAL PRIMARY KEY,
  partner_id         BIGINT NOT NULL REFERENCES partners(id),
  public_name        TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,
  country_code       TEXT NOT NULL REFERENCES countries(code),
  region_id          BIGINT REFERENCES regions(id),
  city_id            BIGINT REFERENCES cities(id),
  property_type      TEXT,
  short_description  TEXT,
  status             TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','REVIEW','ACTIVE','SUSPENDED','ARCHIVED')),
  booking_mode       TEXT NOT NULL DEFAULT 'EXTERNAL_LINK'
    CHECK (booking_mode IN ('EXTERNAL_LINK','LEAD','DIRECT_REQUEST','FUTURE_BOOKING_ENGINE')),
  commission_model   TEXT NOT NULL DEFAULT 'NONE'
    CHECK (commission_model IN ('NONE','PERCENT','FIXED','CUSTOM')),
  commission_value   NUMERIC,
  source_system      TEXT,           -- e.g. TATRY_RAZEM: integration by contract, never a shared DB
  source_external_id TEXT,
  google_place_id    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE partner_referrals (
  id               BIGSERIAL PRIMARY KEY,
  property_id      BIGINT NOT NULL REFERENCES partner_properties(id),
  session_token    TEXT NOT NULL,    -- pseudonymous, never a user identity
  source_context   TEXT,
  clicked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_at     TIMESTAMPTZ,
  booking_value    NUMERIC,
  commission_value NUMERIC,
  status           TEXT NOT NULL DEFAULT 'CLICK'
    CHECK (status IN ('CLICK','LEAD','CONFIRMED','CANCELLED','SETTLED'))
);

CREATE TABLE commission_rules (
  id          BIGSERIAL PRIMARY KEY,
  partner_id  BIGINT REFERENCES partners(id),
  property_id BIGINT REFERENCES partner_properties(id),
  model       TEXT NOT NULL CHECK (model IN ('PERCENT','FIXED','CUSTOM')),
  value       NUMERIC NOT NULL,
  valid_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
