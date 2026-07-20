const assert = require('node:assert');
const { test } = require('node:test');

// public/countries.js is UMD: in Node it exports via module.exports, and the
// server require()s this exact file - so testing the require path tests both.
const {
  COUNTRIES,
  DEFAULT_COUNTRY,
  isValidCountry,
  normalizeCountry,
  getCountry,
  getSavedCountry,
  saveCountry
} = require('../public/countries');

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data
  };
}

test('Poland is the default country', () => {
  assert.strictEqual(DEFAULT_COUNTRY, 'PL');
  assert.strictEqual(getCountry().code, 'PL');
});

test('all three pilot countries are configured with the fields the app needs', () => {
  for (const code of ['PL', 'SK', 'HU']) {
    const c = COUNTRIES[code];
    assert.ok(c, `${code} missing`);
    for (const field of ['code', 'googleRegion', 'label', 'flag', 'currency', 'defaultCity', 'searchPlaceholder']) {
      assert.ok(c[field], `${code}.${field} missing`);
    }
  }
  assert.strictEqual(COUNTRIES.SK.currency, 'EUR');
  assert.strictEqual(COUNTRIES.HU.currency, 'HUF');
});

test('normalizeCountry accepts case-insensitive codes and falls back to PL for unknowns', () => {
  assert.strictEqual(normalizeCountry('sk'), 'SK');
  assert.strictEqual(normalizeCountry('HU'), 'HU');
  assert.strictEqual(normalizeCountry('DE'), 'PL');
  assert.strictEqual(normalizeCountry(''), 'PL');
  assert.strictEqual(normalizeCountry(null), 'PL');
  assert.strictEqual(normalizeCountry('__proto__'), 'PL');
});

test('isValidCountry rejects unsupported codes without prototype tricks', () => {
  assert.strictEqual(isValidCountry('PL'), true);
  assert.strictEqual(isValidCountry('CZ'), false);
  assert.strictEqual(isValidCountry('toString'), false);
});

test('first visit (empty storage) always starts from Poland', () => {
  assert.strictEqual(getSavedCountry(fakeStorage()), 'PL');
});

test('country choice persists and restores: PL -> SK -> HU', () => {
  const storage = fakeStorage();
  assert.strictEqual(saveCountry('SK', storage), 'SK');
  assert.strictEqual(getSavedCountry(storage), 'SK');
  assert.strictEqual(saveCountry('HU', storage), 'HU');
  assert.strictEqual(getSavedCountry(storage), 'HU');
});

test('corrupted stored value falls back to Poland instead of breaking the app', () => {
  const storage = fakeStorage({ 'gastrofinder.country': 'XX' });
  assert.strictEqual(getSavedCountry(storage), 'PL');
});

test('getSavedCountry survives a storage that throws (private mode)', () => {
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.strictEqual(getSavedCountry(throwing), 'PL');
  assert.strictEqual(saveCountry('SK', throwing), 'SK');
});
