const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  OVERRIDES,
  isoDateInTimeZone,
  isActive,
  applyAvailabilityOverrides
} = require('../lib/availability-overrides');

const BAR_ID = 'ChIJIfGBY3H3FUcRsYNjhX6eC08';

test('manual seasonal rule targets the verified Bar Za Lasem Place ID and expires', () => {
  const rule = OVERRIDES[BAR_ID];
  assert.ok(rule);
  assert.strictEqual(rule.status, 'SEASONAL_CLOSED');
  assert.strictEqual(rule.source, 'LOCAL_VERIFICATION');
  assert.match(rule.validFrom, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(rule.validUntil, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(rule.validUntil >= rule.validFrom);
});

test('Polish local date is deterministic around a UTC midnight boundary', () => {
  assert.strictEqual(
    isoDateInTimeZone(new Date('2026-07-20T22:30:00Z')),
    '2026-07-21'
  );
});

test('validity window is inclusive and does not recur automatically next year', () => {
  const rule = OVERRIDES[BAR_ID];
  assert.strictEqual(isActive(rule, new Date('2026-04-01T12:00:00Z')), true);
  assert.strictEqual(isActive(rule, new Date('2026-11-30T12:00:00Z')), true);
  assert.strictEqual(isActive(rule, new Date('2026-12-01T12:00:00Z')), false);
  assert.strictEqual(isActive(rule, new Date('2027-07-21T12:00:00Z')), false);
});

test('flag OFF returns the original array and changes no production result', () => {
  const places = [{ id: BAR_ID, displayName: { text: 'Bar Za Lasem' } }];
  const result = applyAvailabilityOverrides(places, {
    enabled: false,
    now: new Date('2026-07-21T12:00:00Z')
  });
  assert.strictEqual(result, places);
  assert.strictEqual(result[0].availabilityOverride, undefined);
});

test('flag ON adds own metadata only to the active matching place without mutating Google data', () => {
  const matching = {
    id: BAR_ID,
    displayName: { text: 'Bar Za Lasem' },
    currentOpeningHours: { openNow: true }
  };
  const unrelated = { id: 'OTHER', currentOpeningHours: { openNow: true } };
  const places = [matching, unrelated];
  const result = applyAvailabilityOverrides(places, {
    enabled: true,
    now: new Date('2026-07-21T12:00:00Z')
  });

  assert.notStrictEqual(result, places);
  assert.notStrictEqual(result[0], matching);
  assert.strictEqual(result[0].availabilityOverride.status, 'SEASONAL_CLOSED');
  assert.deepStrictEqual(result[0].currentOpeningHours, { openNow: true }, 'Google hours remain untouched');
  assert.strictEqual(matching.availabilityOverride, undefined, 'input is not mutated');
  assert.strictEqual(result[1], unrelated, 'unrelated places retain object identity');
});

test('expired rule is omitted even when the feature flag remains ON', () => {
  const places = [{ id: BAR_ID }];
  const result = applyAvailabilityOverrides(places, {
    enabled: true,
    now: new Date('2026-12-01T12:00:00Z')
  });
  assert.strictEqual(result[0].availabilityOverride, undefined);
});

// Exercise the exact browser helper shipped to users.
const browserSource = fs.readFileSync(path.join(__dirname, '../public/availability.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(browserSource, sandbox, { filename: 'availability.js' });
const availability = sandbox.window.GastroAvailability;

test('client layer makes an active seasonal override effectively closed despite Google openNow', () => {
  const place = {
    availabilityOverride: {
      status: 'SEASONAL_CLOSED',
      label: 'Nieczynne poza sezonem zimowym'
    },
    currentOpeningHours: { openNow: true }
  };
  const googleChecker = () => true;
  assert.strictEqual(availability.effectiveOpenStatus(place, googleChecker, 12, 0), false);

  const view = availability.presentation(place, googleChecker, () => ({ label: 'Otwarte do 21:00' }), 12, 0);
  assert.strictEqual(view.status, 'seasonal');
  assert.strictEqual(view.badge, 'Sezonowo zamknięte');
  assert.strictEqual(view.detail, 'Nieczynne poza sezonem zimowym');
});

test('client layer delegates byte-for-byte opening logic when no override exists', () => {
  let calls = 0;
  const checker = (place, hour, minute) => {
    calls += 1;
    assert.strictEqual(hour, 9);
    assert.strictEqual(minute, 30);
    return true;
  };
  const details = () => ({ label: 'Otwarte do 21:00', closesAt: '21:00' });
  const view = availability.presentation({}, checker, details, 9, 30);
  assert.strictEqual(calls, 1);
  assert.strictEqual(view.status, 'open');
  assert.strictEqual(view.detail, 'Otwarte do 21:00');
});

test('service worker v6 precaches and network-first refreshes the availability helper', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  assert.match(sw, /gastrofinder-v6/);
  assert.match(sw, /'\/availability\.js'/);
  assert.match(sw, /NETWORK_FIRST_PATHS[^;]+availability\.js/);
});
