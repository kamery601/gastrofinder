-- Remove seeded countries (only if nothing references them yet).
BEGIN;
DELETE FROM countries WHERE code IN ('PL','SK','HU','CZ','AT','HR','IT')
  AND code NOT IN (SELECT DISTINCT country_code FROM places_core);
COMMIT;
