-- Seed the geography root: 7 configurable countries.
-- PL/SK/HU enabled (live baseline); CZ/AT/HR/IT prepared but DISABLED -
-- activation is a separate, flag-gated decision per country.
-- Own configuration data (not Google content) - safe to store permanently.

BEGIN;

INSERT INTO countries (code, label_pl, flag, currency, locale, google_region, component_country, enabled, display_order) VALUES
  ('PL', 'Polska',    '🇵🇱', 'PLN', 'pl-PL', 'pl', 'PL', TRUE,  1),
  ('SK', 'Słowacja',  '🇸🇰', 'EUR', 'sk-SK', 'sk', 'SK', TRUE,  2),
  ('HU', 'Węgry',     '🇭🇺', 'HUF', 'hu-HU', 'hu', 'HU', TRUE,  3),
  ('CZ', 'Czechy',    '🇨🇿', 'CZK', 'cs-CZ', 'cz', 'CZ', FALSE, 4),
  ('AT', 'Austria',   '🇦🇹', 'EUR', 'de-AT', 'at', 'AT', FALSE, 5),
  ('HR', 'Chorwacja', '🇭🇷', 'EUR', 'hr-HR', 'hr', 'HR', FALSE, 6),
  ('IT', 'Włochy',    '🇮🇹', 'EUR', 'it-IT', 'it', 'IT', FALSE, 7)
ON CONFLICT (code) DO NOTHING;

COMMIT;
