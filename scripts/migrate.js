#!/usr/bin/env node
// Minimal migration runner for the Platform Core catalog.
// Usage:
//   DATABASE_URL=postgres://... node scripts/migrate.js up
//   DATABASE_URL=postgres://... node scripts/migrate.js down 001
//   node scripts/migrate.js up --dry-run   (prints SQL, no DB needed)
//
// No ORM by design (see PLATFORM-CORE-BASELINE.md): plain SQL files in
// db/migrations, applied in filename order, tracked in schema_migrations.

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

function listMigrations(direction) {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(`.${direction}.sql`))
    .sort();
}

async function main() {
  const direction = process.argv[2];
  const only = process.argv.find((a) => /^\d+$/.test(a));
  const dryRun = process.argv.includes('--dry-run');

  if (!['up', 'down'].includes(direction)) {
    console.error('Usage: node scripts/migrate.js up|down [NNN] [--dry-run]');
    process.exit(1);
  }

  let files = listMigrations(direction);
  if (only) files = files.filter((f) => f.startsWith(only));
  if (direction === 'down') files = files.reverse();

  if (dryRun) {
    for (const f of files) {
      console.log(`-- DRY RUN: ${f}`);
      console.log(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    }
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required (or use --dry-run).');
    process.exit(1);
  }

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

    for (const f of files) {
      const base = f.replace(/\.(up|down)\.sql$/, '');
      const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [base]);
      const applied = rows.length > 0;

      if (direction === 'up' && applied) { console.log(`skip (applied): ${f}`); continue; }
      if (direction === 'down' && !applied) { console.log(`skip (not applied): ${f}`); continue; }

      console.log(`apply: ${f}`);
      await pool.query(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
      if (direction === 'up') {
        await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [base]);
      } else {
        await pool.query('DELETE FROM schema_migrations WHERE name = $1', [base]);
      }
    }
    console.log('done');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
