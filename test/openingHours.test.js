const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// public/opening-hours.js is a browser IIFE (attaches to `window`), not a CommonJS
// module — there is no server-side copy of this logic (the app checks opening
// hours entirely client-side). Load the real file under a minimal `window` shim
// so these tests exercise the actual code the app ships, not a duplicate.
const source = fs.readFileSync(path.join(__dirname, '../public/opening-hours.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'opening-hours.js' });
const { isOpenAt } = sandbox.window.GastroOpeningHours;

test('Lokal otwarty 22:00-04:00 działa dla 23:00', () => {
  const place = {
    currentOpeningHours: {
      periods: [
        { open: { day: 0, hour: 22, minute: 0 }, close: { day: 1, hour: 4, minute: 0 } }
      ]
    }
  };
  assert.strictEqual(isOpenAt(place, 23, 0, { dayIndex: 0 }), true);
});

test('Lokal otwarty 22:00-04:00 działa dla 02:00 następnego dnia', () => {
  const place = {
    currentOpeningHours: {
      periods: [
        { open: { day: 0, hour: 22, minute: 0 }, close: { day: 1, hour: 4, minute: 0 } }
      ]
    }
  };
  assert.strictEqual(isOpenAt(place, 2, 0, { dayIndex: 1 }), true);
});

test('Lokal 24h pozostaje otwarty o dowolnej godzinie', () => {
  const place = {
    currentOpeningHours: {
      periods: [
        { open: { day: 0, hour: 0, minute: 0 }, close: { day: 0, hour: 0, minute: 0 } }
      ]
    }
  };
  assert.strictEqual(isOpenAt(place, 12, 0, { dayIndex: 0 }), true);
  assert.strictEqual(isOpenAt(place, 3, 0, { dayIndex: 0 }), true);
});

test('Lokal zamknięty danego dnia', () => {
  const place = {
    currentOpeningHours: {
      periods: [
        { open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 16, minute: 0 } }
      ]
    }
  };
  assert.strictEqual(isOpenAt(place, 18, 0, { dayIndex: 1 }), false);
  assert.strictEqual(isOpenAt(place, 10, 0, { dayIndex: 2 }), false);
});

test('Brak godzin otwarcia zwraca null', () => {
  const place = { currentOpeningHours: {}, regularOpeningHours: {} };
  assert.strictEqual(isOpenAt(place, 14, 0), null);
});
