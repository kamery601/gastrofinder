#!/usr/bin/env node
// Fala 1 observation report - the evidence for the Fala 2 (catalog read)
// decision. Aggregates only; no secrets, no PII, no query texts.
// Usage: DATABASE_URL=postgres://... node scripts/catalog-stats.js [--days 7]

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) || 7 : 7;

  const { Pool } = require('pg');
  const internal = process.env.DATABASE_URL.includes('railway.internal');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl: internal ? false : { rejectUnauthorized: false }
  });
  const q = (sql, params) => pool.query(sql, params);

  try {
    console.log(`=== GastroFinder — raport obserwacyjny (ostatnie ${days} dni) ===\n`);

    // --- KATALOG -------------------------------------------------------------
    const total = (await q('SELECT COUNT(*)::int AS n FROM places_core')).rows[0].n;
    const perDay = (await q(
      `SELECT date_trunc('day', first_seen_at)::date AS day, COUNT(*)::int AS n
       FROM places_core WHERE first_seen_at > now() - ($1 || ' days')::interval
       GROUP BY 1 ORDER BY 1`, [days])).rows;
    const reSeen = (await q(
      `SELECT COUNT(*)::int AS n FROM places_core
       WHERE last_seen_in_search_at > first_seen_at + interval '1 minute'`)).rows[0].n;
    const seenOnce = total - reSeen;
    const byCountry = (await q(
      `SELECT country_code, COUNT(*)::int AS n FROM places_core GROUP BY 1 ORDER BY 2 DESC`)).rows;
    const noCity = (await q(
      `SELECT COUNT(*)::int AS n FROM places_core WHERE city_id IS NULL`)).rows[0].n;
    const dupCheck = (await q(
      `SELECT COUNT(*)::int AS n FROM (SELECT google_place_id FROM places_core
        GROUP BY 1 HAVING COUNT(*) > 1) d`)).rows[0].n;
    const dbSize = (await q(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS s`)).rows[0].s;

    console.log('KATALOG');
    console.log(`  Place ID łącznie:        ${total}`);
    console.log(`  widziane ponownie:       ${reSeen} (${total ? (100 * reSeen / total).toFixed(1) : 0}%)`);
    console.log(`  widziane tylko raz:      ${seenOnce} (${total ? (100 * seenOnce / total).toFixed(1) : 0}%)`);
    console.log(`  kraje:                   ${byCountry.map((r) => `${r.country_code}=${r.n}`).join(' ')}`);
    console.log(`  bez powiązania z miastem: ${noCity} (city-mapping czeka na discovery runs)`);
    console.log(`  duplikaty google_place_id: ${dupCheck} (musi być 0)`);
    console.log(`  nowe rekordy per dzień:  ${perDay.map((r) => `${r.day.toISOString().slice(5, 10)}:${r.n}`).join(' ') || '(brak)'}`);
    console.log(`  rozmiar bazy:            ${dbSize}\n`);

    // --- WYSZUKIWANIA --------------------------------------------------------
    const s = (await q(
      `SELECT COUNT(*)::int AS searches,
              COALESCE(AVG(google_nearby_calls),0)::numeric(10,1) AS avg_nearby,
              COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms),0)::int AS p50,
              COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms),0)::int AS p95,
              COALESCE(AVG(CASE WHEN cache_hit THEN 1 ELSE 0 END),0)::numeric(4,3) AS cache_rate,
              COALESCE(AVG(raw_results),0)::numeric(10,1) AS avg_raw,
              COALESCE(AVG(unique_results),0)::numeric(10,1) AS avg_unique,
              COALESCE(SUM(CASE WHEN capped THEN 1 ELSE 0 END),0)::int AS capped_n
       FROM search_telemetry WHERE at > now() - ($1 || ' days')::interval`, [days])).rows[0];
    const buckets = (await q(
      `SELECT cost_bucket, COUNT(*)::int AS n FROM search_telemetry
       WHERE at > now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 2 DESC`, [days])).rows;
    const perCountrySearches = (await q(
      `SELECT country, COUNT(*)::int AS n FROM search_telemetry
       WHERE at > now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 2 DESC`, [days])).rows;

    console.log('WYSZUKIWANIA');
    console.log(`  liczba:                  ${s.searches} (${perCountrySearches.map((r) => `${r.country}=${r.n}`).join(' ') || '-'})`);
    console.log(`  śr. Nearby calls:        ${s.avg_nearby}`);
    console.log(`  czas p50/p95:            ${s.p50} ms / ${s.p95} ms`);
    console.log(`  cache hit rate:          ${(100 * s.cache_rate).toFixed(1)}%`);
    console.log(`  śr. raw / unique:        ${s.avg_raw} / ${s.avg_unique}`);
    console.log(`  capped:                  ${s.capped_n}`);
    console.log(`  koszt (buckety):         ${buckets.map((r) => `${r.cost_bucket || '-'}=${r.n}`).join(' ') || '-'}\n`);

    // --- SHADOW WRITE --------------------------------------------------------
    const w = (await q(
      `SELECT COALESCE(SUM(write_inserted),0)::int AS ins,
              COALESCE(SUM(write_updated),0)::int AS upd,
              COALESCE(SUM(write_errors),0)::int AS errs,
              COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY shadow_write_ms),0)::int AS p95w
       FROM search_telemetry WHERE at > now() - ($1 || ' days')::interval`, [days])).rows[0];

    console.log('SHADOW WRITE');
    console.log(`  nowe / istniejące:       ${w.ins} / ${w.upd}`);
    console.log(`  błędy zapisu:            ${w.errs}`);
    console.log(`  p95 czasu batcha:        ${w.p95w} ms (po odpowiedzi — nie dotyka użytkownika)\n`);

    // --- SHADOW READ (porównanie live vs katalog) ---------------------------
    const c = (await q(
      `SELECT COUNT(*)::int AS n,
              COALESCE(AVG(coverage_ratio),0)::numeric(5,4) AS avg_cov,
              COALESCE(MIN(coverage_ratio),0)::numeric(5,4) AS min_cov,
              COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY shadow_read_ms),0)::int AS p95r
       FROM search_telemetry
       WHERE at > now() - ($1 || ' days')::interval AND coverage_ratio IS NOT NULL`, [days])).rows[0];

    console.log('SHADOW READ (pokrycie wyników live przez katalog)');
    if (c.n === 0) {
      console.log('  brak danych — CATALOG_SHADOW_READ_ENABLED wyłączone lub brak wyszukiwań\n');
    } else {
      console.log(`  porównań:                ${c.n}`);
      console.log(`  śr. pokrycie:            ${(100 * c.avg_cov).toFixed(1)}%   (próg Fali 2: ≥90% dla kluczowych miejscowości)`);
      console.log(`  najgorsze pokrycie:      ${(100 * c.min_cov).toFixed(1)}%`);
      console.log(`  p95 czasu porównania:    ${c.p95r} ms\n`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
