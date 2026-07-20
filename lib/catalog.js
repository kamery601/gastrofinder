// PlaceCatalog implementation over PostgreSQL, plus the factory that decides
// whether the app gets the real catalog or the Null fallback. The pool is
// injected (anything with .query(text, params) -> {rows}), so unit tests run
// against a fake pool and production wires node-postgres.
//
// Hard rule: any DB error degrades to the same answers the Null catalog gives
// (empty reads, no-op writes) - a broken catalog must never break live search.

const { isEnabled } = require('./flags');
const { createNullCatalog } = require('./contracts');
const logger = require('../logger');

function createPgCatalog(pool) {
  async function safe(op, fallback, sql, params) {
    try {
      return await pool.query(sql, params);
    } catch (e) {
      logger.warn('catalog', `${op} failed, degrading to fallback`, { code: e.code || e.message });
      return fallback;
    }
  }

  return {
    isAvailable: () => true,

    /**
     * Batch variant: one round-trip for a whole search result. Dedup by
     * google_place_id via ON CONFLICT (also dedups WITHIN the batch via
     * DISTINCT). Returns {inserted, updated} counts; {inserted:0, updated:0}
     * on failure - a broken write never surfaces to the caller.
     */
    async upsertObservations(googlePlaceIds, country, seenAt) {
      const ids = [...new Set((googlePlaceIds || []).filter(Boolean))];
      if (!ids.length || !country) return { inserted: 0, updated: 0 };
      const result = await safe('upsertObservations', { rows: [] },
        `INSERT INTO places_core (google_place_id, country_code, last_seen_in_search_at)
         SELECT DISTINCT id, $2::text, $3::timestamptz FROM unnest($1::text[]) AS t(id)
         ON CONFLICT (google_place_id)
         DO UPDATE SET last_seen_in_search_at = EXCLUDED.last_seen_in_search_at,
                       updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [ids, country, seenAt || new Date()]);
      const inserted = result.rows.filter((r) => r.inserted === true).length;
      return { inserted, updated: result.rows.length - inserted };
    },

    /**
     * Records that a place was observed in a search. Dedup by google_place_id
     * happens here via ON CONFLICT - repeated observations only bump
     * last_seen_in_search_at. Returns {inserted:true} only for first sightings.
     */
    async upsertObservation({ googlePlaceId, country, seenAt }) {
      if (!googlePlaceId || !country) return { inserted: false };
      const result = await safe('upsertObservation', { rows: [] },
        `INSERT INTO places_core (google_place_id, country_code, last_seen_in_search_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (google_place_id)
         DO UPDATE SET last_seen_in_search_at = EXCLUDED.last_seen_in_search_at,
                       updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [googlePlaceId, country, seenAt || new Date()]);
      return { inserted: result.rows.length > 0 && result.rows[0].inserted === true };
    },

    /**
     * Known Place IDs for a country (optionally narrowed by module inclusion),
     * newest-seen first. Empty array on any failure.
     */
    async getKnownPlaceIds({ country, module, limit = 500 }) {
      const params = [country, limit];
      let sql =
        `SELECT p.google_place_id FROM places_core p
         WHERE p.country_code = $1
           AND p.lifecycle_status IN ('DISCOVERED','ACTIVE')`;
      if (module) {
        sql += ` AND EXISTS (SELECT 1 FROM place_module_classifications c
                             WHERE c.place_id = p.id AND c.module = $3 AND c.included = TRUE)`;
        params.push(module);
      }
      sql += ` ORDER BY p.last_seen_in_search_at DESC NULLS LAST LIMIT $2`;
      const result = await safe('getKnownPlaceIds', { rows: [] }, sql, params);
      return result.rows.map((r) => r.google_place_id);
    },

    async markSeen(googlePlaceIds, seenAt) {
      if (!Array.isArray(googlePlaceIds) || !googlePlaceIds.length) return;
      await safe('markSeen', { rows: [] },
        `UPDATE places_core SET last_seen_in_search_at = $2, updated_at = now()
         WHERE google_place_id = ANY($1)`,
        [googlePlaceIds, seenAt || new Date()]);
    }
  };
}

/**
 * Wiring decision, evaluated once at startup:
 * CATALOG_CORE_ENABLED off OR no pool/DATABASE_URL => Null catalog
 * (the app behaves exactly like the pre-platform baseline).
 * @param {object} opts
 * @param {object} [opts.env] - defaults to process.env
 * @param {object} [opts.pool] - injected pg-compatible pool (tests); if absent
 *   and DATABASE_URL is set, a real pg Pool is created lazily.
 */
function createCatalog({ env = process.env, pool = null } = {}) {
  if (!isEnabled('CATALOG_CORE_ENABLED', env)) return createNullCatalog();

  let activePool = pool;
  if (!activePool) {
    if (!env.DATABASE_URL) {
      logger.warn('catalog', 'CATALOG_CORE_ENABLED but no DATABASE_URL - using null catalog');
      return createNullCatalog();
    }
    try {
      // Lazy require: pg is only needed when the catalog is actually on.
      const { Pool } = require('pg');
      const internal = env.DATABASE_URL.includes('railway.internal');
      activePool = new Pool({
        connectionString: env.DATABASE_URL,
        max: 3,                          // small instance, small pool
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statement_timeout: 5000,         // no catalog query may hang the app
        ssl: internal ? false : { rejectUnauthorized: false }
      });
      activePool.on('error', (e) => logger.warn('catalog', 'pool error', { code: e.code || e.message }));
    } catch (e) {
      logger.error('catalog', 'pg driver unavailable - using null catalog', { message: e.message });
      return createNullCatalog();
    }
  }
  return createPgCatalog(activePool);
}

module.exports = { createCatalog, createPgCatalog };
