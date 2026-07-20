const assert = require('node:assert');
const { test } = require('node:test');
const { createCatalog, createPgCatalog } = require('../lib/catalog');

// Fake pg-compatible pool: records queries, returns scripted responses.
function fakePool(responses = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      if (r instanceof Error) throw r;
      return r || { rows: [] };
    }
  };
}

// --- wiring: flags and fallback ---------------------------------------------

test('catalog flag off => Null catalog (baseline behavior)', () => {
  const catalog = createCatalog({ env: {} });
  assert.strictEqual(catalog.isAvailable(), false);
});

test('catalog flag on but no DATABASE_URL => Null catalog, never a crash', async () => {
  const catalog = createCatalog({ env: { CATALOG_CORE_ENABLED: 'true' } });
  assert.strictEqual(catalog.isAvailable(), false);
  assert.deepStrictEqual(await catalog.getKnownPlaceIds({ country: 'PL' }), []);
});

test('catalog flag on with injected pool => real catalog', () => {
  const catalog = createCatalog({ env: { CATALOG_CORE_ENABLED: 'true' }, pool: fakePool() });
  assert.strictEqual(catalog.isAvailable(), true);
});

// --- upsert / dedup ----------------------------------------------------------

test('upsertObservation inserts a new Place ID (parametrized, no SQL injection surface)', async () => {
  const pool = fakePool([{ rows: [{ inserted: true }] }]);
  const catalog = createPgCatalog(pool);
  const result = await catalog.upsertObservation({ googlePlaceId: 'ChIJabc', country: 'PL' });
  assert.deepStrictEqual(result, { inserted: true });
  assert.match(pool.calls[0].sql, /ON CONFLICT \(google_place_id\)/);
  assert.strictEqual(pool.calls[0].params[0], 'ChIJabc');
  assert.ok(!pool.calls[0].sql.includes('ChIJabc'), 'values must go through parameters, not string interpolation');
});

test('upsertObservation dedups: second sighting reports inserted=false', async () => {
  const pool = fakePool([{ rows: [{ inserted: false }] }]);
  const catalog = createPgCatalog(pool);
  const result = await catalog.upsertObservation({ googlePlaceId: 'ChIJabc', country: 'PL' });
  assert.deepStrictEqual(result, { inserted: false });
});

test('upsertObservation refuses incomplete observations without touching the DB', async () => {
  const pool = fakePool();
  const catalog = createPgCatalog(pool);
  assert.deepStrictEqual(await catalog.upsertObservation({ googlePlaceId: '', country: 'PL' }), { inserted: false });
  assert.deepStrictEqual(await catalog.upsertObservation({ googlePlaceId: 'x', country: '' }), { inserted: false });
  assert.strictEqual(pool.calls.length, 0);
});

// --- reads -------------------------------------------------------------------

test('getKnownPlaceIds filters by country and optional module', async () => {
  const pool = fakePool([{ rows: [{ google_place_id: 'A' }, { google_place_id: 'B' }] }]);
  const catalog = createPgCatalog(pool);
  const ids = await catalog.getKnownPlaceIds({ country: 'SK', module: 'AQUA' });
  assert.deepStrictEqual(ids, ['A', 'B']);
  assert.match(pool.calls[0].sql, /c\.module = \$3 AND c\.included = TRUE/);
  assert.strictEqual(pool.calls[0].params[0], 'SK');
  assert.strictEqual(pool.calls[0].params[2], 'AQUA');
});

test('markSeen is a no-op for empty input and batches ids otherwise', async () => {
  const pool = fakePool();
  const catalog = createPgCatalog(pool);
  await catalog.markSeen([]);
  assert.strictEqual(pool.calls.length, 0);
  await catalog.markSeen(['A', 'B']);
  assert.strictEqual(pool.calls.length, 1);
  assert.deepStrictEqual(pool.calls[0].params[0], ['A', 'B']);
});

// --- degradation: DB errors never break the app ------------------------------

test('DB unavailable mid-flight degrades to Null-catalog answers, no throw', async () => {
  const boom = new Error('connection refused');
  boom.code = 'ECONNREFUSED';
  const pool = fakePool([boom]);
  const catalog = createPgCatalog(pool);
  assert.deepStrictEqual(await catalog.getKnownPlaceIds({ country: 'PL' }), []);
  assert.deepStrictEqual(await catalog.upsertObservation({ googlePlaceId: 'x', country: 'PL' }), { inserted: false });
  await catalog.markSeen(['x']);
});

// --- schema files ------------------------------------------------------------

test('migration files exist in pairs and down drops everything up creates', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const up = fs.readFileSync(path.join(dir, '001_platform_core.up.sql'), 'utf8');
  const down = fs.readFileSync(path.join(dir, '001_platform_core.down.sql'), 'utf8');

  const created = [...up.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]);
  assert.ok(created.length >= 16, `expected the full model, got ${created.length} tables`);
  for (const table of created) {
    assert.ok(down.includes(`DROP TABLE IF EXISTS ${table}`), `down migration misses ${table}`);
  }
  assert.match(up, /google_place_id\s+TEXT NOT NULL UNIQUE/, 'Place ID must be the unique external identifier');
  assert.match(up, /BLOCKED_COMPLIANCE/, 'compliance marker for coordinates must be present');
  assert.match(up, /status\s+TEXT NOT NULL DEFAULT 'DRAFT'/, 'partner properties must default to DRAFT');
});

// --- Fala 1: shadow write must never hurt the user request -------------------

test('slow DB does not add latency to the response path (write happens after res.json)', async () => {
  // The contract: respondWithNearbyPlaces sends res.json() BEFORE any catalog
  // write. Here we prove the catalog itself tolerates a slow pool without
  // throwing, and (in server.js) the call site is fire-and-forget.
  const slowPool = {
    query: () => new Promise((resolve) => setTimeout(() => resolve({ rows: [{ inserted: true }] }), 50))
  };
  const catalog = createPgCatalog(slowPool);
  const t0 = Date.now();
  const p = catalog.upsertObservation({ googlePlaceId: 'x', country: 'PL' });
  assert.ok(Date.now() - t0 < 20, 'starting the write must not block');
  await p;
});

test('DB timeout during shadow write degrades silently (no throw, inserted=false)', async () => {
  const timeoutErr = new Error('canceling statement due to statement timeout');
  timeoutErr.code = '57014';
  const pool = fakePool([timeoutErr]);
  const catalog = createPgCatalog(pool);
  const result = await catalog.upsertObservation({ googlePlaceId: 'x', country: 'PL' });
  assert.deepStrictEqual(result, { inserted: false });
});

test('duplicates between POPULARITY and DISTANCE collapse to one row (ON CONFLICT)', async () => {
  // Same Place ID observed twice in one search: first insert, then conflict-update.
  const pool = fakePool([
    { rows: [{ inserted: true }] },
    { rows: [{ inserted: false }] }
  ]);
  const catalog = createPgCatalog(pool);
  const first = await catalog.upsertObservation({ googlePlaceId: 'DUP', country: 'SK' });
  const second = await catalog.upsertObservation({ googlePlaceId: 'DUP', country: 'SK' });
  assert.strictEqual(first.inserted, true);
  assert.strictEqual(second.inserted, false);
  assert.strictEqual(pool.calls.length, 2);
});

test('batch upsertObservations: one round-trip, in-batch dedup, inserted/updated counts', async () => {
  const pool = fakePool([{ rows: [{ inserted: true }, { inserted: true }, { inserted: false }] }]);
  const catalog = createPgCatalog(pool);
  const result = await catalog.upsertObservations(['A', 'B', 'B', 'C', null], 'PL');
  assert.deepStrictEqual(result, { inserted: 2, updated: 1 });
  assert.strictEqual(pool.calls.length, 1, 'a whole search must be one DB round-trip');
  assert.deepStrictEqual(pool.calls[0].params[0], ['A', 'B', 'C'], 'nulls dropped, in-batch duplicates removed');
});

test('batch upsertObservations: empty input is a no-op; DB failure returns zero counts', async () => {
  const pool = fakePool();
  const catalog = createPgCatalog(pool);
  assert.deepStrictEqual(await catalog.upsertObservations([], 'PL'), { inserted: 0, updated: 0 });
  assert.strictEqual(pool.calls.length, 0);

  const boom = new Error('down'); boom.code = 'ECONNREFUSED';
  const failing = createPgCatalog(fakePool([boom]));
  assert.deepStrictEqual(await failing.upsertObservations(['A'], 'PL'), { inserted: 0, updated: 0 });
});
