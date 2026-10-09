const assert = require('node:assert');
const { test } = require('node:test');
const {
  classifyActivity,
  validUntilFor,
  buildChecksFile,
  applyAvailabilityChecks,
  loadChecks
} = require('../lib/availability-checks');

// Audit date of the real Podhale cases below.
const NOW = new Date('2026-10-09T10:00:00Z');

// --- classifier: real cases from the October 2026 Podhale audit --------------

test('"Gril Bar." - 64 reviews, newest Dec 2023, Google still says open -> INACTIVE', () => {
  const c = classifyActivity({
    businessStatus: 'OPERATIONAL', totalReviews: 64,
    reviewDates: ['2023-12-31', '2023-11-14', '2023-05-09', '2023-02-18', '2022-09-21']
  }, NOW);
  assert.strictEqual(c.verdict, 'INACTIVE');
  assert.match(c.reason, /Brak aktywności od \d+ mies\./);
});

test('"Kurtoszkolacz" at the Kotelnica lift - only winter reviews -> WINTER_SEASONAL', () => {
  const c = classifyActivity({
    businessStatus: 'OPERATIONAL', totalReviews: 16,
    reviewDates: ['2026-02-24', '2026-01-06', '2025-02-26', '2025-02-21', '2025-01-26']
  }, NOW);
  assert.strictEqual(c.verdict, 'WINTER_SEASONAL');
});

test('winter pattern tolerates one off-season review (Grill bar Śleboda)', () => {
  const c = classifyActivity({
    businessStatus: 'OPERATIONAL', totalReviews: 9,
    reviewDates: ['2026-02-13', '2026-01-28', '2026-01-05', '2026-01-04', '2025-09-22']
  }, NOW);
  assert.strictEqual(c.verdict, 'WINTER_SEASONAL');
});

test('established place silent for 6+ months (Liptakówka fast food, 144 reviews) -> DORMANT', () => {
  const c = classifyActivity({
    businessStatus: 'OPERATIONAL', totalReviews: 144,
    reviewDates: ['2026-02-22', '2025-09-25', '2025-08-18', '2025-05-06', '2025-02-23']
  }, NOW);
  assert.strictEqual(c.verdict, 'DORMANT');
  assert.match(c.reason, /może być nieczynny/);
});

test('busy year-round place near a lift with summer reviews stays OK (Karczma Polana)', () => {
  const c = classifyActivity({
    businessStatus: 'OPERATIONAL', totalReviews: 516,
    reviewDates: ['2026-08-23', '2026-07-25', '2026-07-09', '2026-07-07', '2026-03-19']
  }, NOW);
  assert.strictEqual(c.verdict, 'OK');
});

test('a quiet October for a busy place is NOT enough to flag it (Gazda, 46 days)', () => {
  const c = classifyActivity({
    businessStatus: 'OPERATIONAL', totalReviews: 511,
    reviewDates: ['2026-08-25', '2026-08-14', '2026-06-08', '2026-01-27', '2025-12-25']
  }, NOW);
  assert.strictEqual(c.verdict, 'OK');
});

test('busy place with only very recent winter-ish dates is not winter-seasonal (needs 60+ days silence)', () => {
  const winterNow = new Date('2027-01-20T10:00:00Z');
  const c = classifyActivity({
    businessStatus: 'OPERATIONAL', totalReviews: 300,
    reviewDates: ['2027-01-19', '2027-01-15', '2027-01-10', '2027-01-02', '2026-12-28']
  }, winterNow);
  assert.strictEqual(c.verdict, 'OK');
});

test('small but active place is LOW_DATA, never hidden', () => {
  const c = classifyActivity({ businessStatus: 'OPERATIONAL', totalReviews: 6, reviewDates: ['2026-09-26', '2026-08-01'] }, NOW);
  assert.strictEqual(c.verdict, 'LOW_DATA');
});

test('no reviews at all is LOW_DATA (ranking sinks it, the audit does not hide it)', () => {
  assert.strictEqual(classifyActivity({ businessStatus: 'OPERATIONAL', totalReviews: 0, reviewDates: [] }, NOW).verdict, 'LOW_DATA');
});

test('Google-reported closure is surfaced as CLOSED_IN_GOOGLE', () => {
  const c = classifyActivity({ businessStatus: 'CLOSED_PERMANENTLY', totalReviews: 7, reviewDates: ['2023-12-12'] }, NOW);
  assert.strictEqual(c.verdict, 'CLOSED_IN_GOOGLE');
});

// --- checks file -------------------------------------------------------------

test('checks file stores only actionable verdicts and own derived data', () => {
  const file = buildChecksFile([
    { placeId: 'A', verdict: 'INACTIVE', reason: 'Brak aktywności od 34 mies.' },
    { placeId: 'B', verdict: 'OK', reason: null },
    { placeId: 'C', verdict: 'WINTER_SEASONAL', reason: 'Lokal sezonowy' },
    { placeId: 'D', verdict: 'LOW_DATA', reason: null },
    { placeId: 'E', verdict: 'DORMANT', reason: 'Brak aktywności od 8 mies.' }
  ], NOW);
  assert.deepStrictEqual(Object.keys(file.checks).sort(), ['A', 'C', 'E']);
  assert.deepStrictEqual(Object.keys(file.checks.A).sort(), ['checkedAt', 'reason', 'validUntil', 'verdict']);
  assert.ok(file.rulesVersion);
});

test('every verdict expires: inactive 120 days, dormant 45 days, winter at the end of the off-season', () => {
  assert.strictEqual(validUntilFor('INACTIVE', NOW), '2027-02-06');
  assert.strictEqual(validUntilFor('DORMANT', NOW), '2026-11-23');
  assert.strictEqual(validUntilFor('WINTER_SEASONAL', NOW), '2026-11-30');
});

test('missing checks file degrades to "no checks", never a crash', () => {
  const file = loadChecks('/nonexistent/path.json');
  assert.deepStrictEqual(file.checks, {});
});

// --- applying checks to a search result -----------------------------------

const FILE = {
  checks: {
    DEAD: { verdict: 'INACTIVE', reason: 'Brak aktywności od 34 mies.', checkedAt: '2026-10-09', validUntil: '2027-02-06' },
    WINTER: { verdict: 'WINTER_SEASONAL', reason: 'Lokal sezonowy', checkedAt: '2026-10-09', validUntil: '2026-11-30' },
    QUIET: { verdict: 'DORMANT', reason: 'Brak aktywności od 8 mies. – może być nieczynny', checkedAt: '2026-10-09', validUntil: '2026-11-23' },
    OLD: { verdict: 'INACTIVE', reason: 'x', checkedAt: '2026-01-01', validUntil: '2026-05-01' }
  }
};
const PLACES = ['DEAD', 'WINTER', 'QUIET', 'OLD', 'FINE'].map((id) => ({ id, currentOpeningHours: { openNow: true } }));

test('flag OFF returns results unchanged', () => {
  const r = applyAvailabilityChecks(PLACES, { enabled: false, checksFile: FILE, now: NOW });
  assert.strictEqual(r.places.length, 5);
  assert.strictEqual(r.hidden, 0);
});

test('flag ON: dead listing hidden, winter stand and dormant place marked, others untouched', () => {
  const r = applyAvailabilityChecks(PLACES, { enabled: true, checksFile: FILE, now: NOW });
  const ids = r.places.map((p) => p.id);
  assert.ok(!ids.includes('DEAD'));
  assert.strictEqual(r.hidden, 1);
  assert.strictEqual(r.annotated, 2);
  assert.strictEqual(r.places.find((p) => p.id === 'WINTER').availabilityOverride.status, 'SEASONAL_CLOSED');
  assert.strictEqual(r.places.find((p) => p.id === 'QUIET').availabilityOverride.status, 'ACTIVITY_UNCONFIRMED');
  assert.strictEqual(r.places.find((p) => p.id === 'FINE').availabilityOverride, undefined);
  assert.deepStrictEqual(r.places.find((p) => p.id === 'WINTER').currentOpeningHours, { openNow: true }, 'Google data is never altered');
});

test('expired verdict fails open: the place is shown as Google reports it', () => {
  const r = applyAvailabilityChecks(PLACES, { enabled: true, checksFile: FILE, now: NOW });
  const old = r.places.find((p) => p.id === 'OLD');
  assert.ok(old);
  assert.strictEqual(old.availabilityOverride, undefined);
});

test('in winter a winter-seasonal place is NOT marked closed', () => {
  const january = new Date('2026-01-15T10:00:00Z');
  const fileInWinter = { checks: { WINTER: { ...FILE.checks.WINTER, validUntil: '2026-11-30' } } };
  const r = applyAvailabilityChecks([{ id: 'WINTER' }], { enabled: true, checksFile: fileInWinter, now: january });
  assert.strictEqual(r.places[0].availabilityOverride, undefined);
});

test('a manual, locally verified override always wins over an automatic verdict', () => {
  const manual = { id: 'DEAD', availabilityOverride: { status: 'SEASONAL_CLOSED', source: 'LOCAL_VERIFICATION' } };
  const r = applyAvailabilityChecks([manual], { enabled: true, checksFile: FILE, now: NOW });
  assert.strictEqual(r.places.length, 1);
  assert.strictEqual(r.places[0].availabilityOverride.source, 'LOCAL_VERIFICATION');
});
