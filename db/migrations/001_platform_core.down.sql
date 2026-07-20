-- Platform Core catalog schema (001, down).
-- Drops in reverse dependency order. Only own-catalog data is affected;
-- the application keeps working via live search (CATALOG_CORE_ENABLED=false).

BEGIN;

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS commission_rules;
DROP TABLE IF EXISTS partner_referrals;
DROP TABLE IF EXISTS partner_properties;
DROP TABLE IF EXISTS partners;
DROP TABLE IF EXISTS discovery_results;
DROP TABLE IF EXISTS discovery_runs;
DROP TABLE IF EXISTS collection_places;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS place_dynamic_cache;
DROP TABLE IF EXISTS place_refresh_state;
DROP TABLE IF EXISTS place_source_refs;
DROP TABLE IF EXISTS place_module_classifications;
DROP TABLE IF EXISTS places_core;
DROP TABLE IF EXISTS cities;
DROP TABLE IF EXISTS regions;
DROP TABLE IF EXISTS countries;

COMMIT;
