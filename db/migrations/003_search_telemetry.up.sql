-- Search telemetry persisted to the catalog DB - the evidence base for the
-- Fala 1 observation report and the Fala 2 (shadow read) decision.
-- Aggregate numbers only: no query text, no user GPS, no PII, no payloads.
-- Needed because Railway CLI log streaming is unavailable non-interactively,
-- so log-only telemetry cannot be analyzed for the readiness report.

BEGIN;

CREATE TABLE search_telemetry (
  id                  BIGSERIAL PRIMARY KEY,
  at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_request_id   UUID NOT NULL,
  country             TEXT NOT NULL,
  mode                TEXT NOT NULL,
  google_nearby_calls INTEGER NOT NULL DEFAULT 0,
  cache_hit           BOOLEAN NOT NULL DEFAULT FALSE,
  raw_results         INTEGER,
  unique_results      INTEGER,
  capped              BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms         INTEGER,
  cost_bucket         TEXT,
  -- shadow write outcome
  write_inserted      INTEGER NOT NULL DEFAULT 0,
  write_updated       INTEGER NOT NULL DEFAULT 0,
  write_errors        INTEGER NOT NULL DEFAULT 0,
  shadow_write_ms     INTEGER,
  -- shadow read comparison (live vs catalog), NULL until the flag is on
  live_count          INTEGER,
  catalog_known_count INTEGER,
  coverage_ratio      DOUBLE PRECISION,
  catalog_oldest_seen TIMESTAMPTZ,
  shadow_read_ms      INTEGER
);

CREATE INDEX idx_search_telemetry_at ON search_telemetry(at);
CREATE INDEX idx_search_telemetry_country ON search_telemetry(country, at);

COMMIT;
