#!/usr/bin/env node
// Catalog statistics - the evidence tool for Fala 1 observation.
// Usage: DATABASE_URL=postgres://... node scripts/catalog-stats.js
// Prints aggregates only - no secrets, no per-user data.

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  const { Pool } = require('pg');
  const internal = process.env.DATABASE_URL.includes('railway.internal');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl: internal ? false : { rejectUnauthorized: false }
  });

  try {
    const total = await pool.query('SELECT COUNT(*)::int AS n FROM places_core');
    const byCountry = await pool.query(
      `SELECT country_code, COUNT(*)::int AS n,
              MIN(first_seen_at) AS first_seen,
              MAX(last_seen_in_search_at) AS last_seen
       FROM places_core GROUP BY country_code ORDER BY n DESC`);
    const last24h = await pool.query(
      `SELECT COUNT(*)::int AS n FROM places_core WHERE first_seen_at > now() - interval '24 hours'`);
    const lifecycle = await pool.query(
      `SELECT lifecycle_status, COUNT(*)::int AS n FROM places_core GROUP BY 1 ORDER BY 2 DESC`);
    const size = await pool.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`);

    console.log('=== GastroFinder Catalog Stats ===');
    console.log(`places_core total: ${total.rows[0].n}`);
    console.log(`new in last 24h:  ${last24h.rows[0].n}`);
    console.log('by country:');
    for (const r of byCountry.rows) {
      console.log(`  ${r.country_code}: ${r.n} (first: ${r.first_seen?.toISOString?.().slice(0, 16) || '-'}, last seen: ${r.last_seen?.toISOString?.().slice(0, 16) || '-'})`);
    }
    console.log('lifecycle:', lifecycle.rows.map((r) => `${r.lifecycle_status}=${r.n}`).join(' ') || '(empty)');
    console.log(`database size: ${size.rows[0].size}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
