const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// public/location-context.js is a browser IIFE (window.GastroLocation), loaded the
// same way as public/opening-hours.js's tests: run the real shipped file under a
// minimal `window` shim rather than re-implementing the logic in the test.
const source = fs.readFileSync(path.join(__dirname, '../public/location-context.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'location-context.js' });
const { buildFromGeocode, buildFromGps, formatMessages } = sandbox.window.GastroLocation;

test('buildFromGeocode trusts formatted_address, not the raw user input', () => {
  const geocodeResult = {
    formatted_address: 'Białka Tatrzańska, 34-405, Polska',
    geometry: { location: { lat: 49.409, lng: 20.083 } },
    types: ['locality', 'political']
  };
  const context = buildFromGeocode('Białka Tatrzańska', geocodeResult);
  assert.strictEqual(context.formattedAddress, 'Białka Tatrzańska, 34-405, Polska');
  assert.strictEqual(context.userInput, 'Białka Tatrzańska');
  assert.strictEqual(context.lat, 49.409);
  assert.strictEqual(context.lng, 20.083);
  assert.strictEqual(Array.from(context.types).join(','), 'locality,political');
  assert.strictEqual(context.source, 'geocode');
});

test('"Białka" and "Białka Tatrzańska" produce distinguishable contexts', () => {
  const bialka = buildFromGeocode('Białka', {
    formatted_address: 'Białka, Polska',
    geometry: { location: { lat: 49.5, lng: 20.6 } }
  });
  const bialkaTatrzanska = buildFromGeocode('Białka Tatrzańska', {
    formatted_address: 'Białka Tatrzańska, Polska',
    geometry: { location: { lat: 49.409, lng: 20.083 } }
  });
  assert.notStrictEqual(bialka.formattedAddress, bialkaTatrzanska.formattedAddress);
  assert.notStrictEqual(formatMessages(bialka).resultsFor, formatMessages(bialkaTatrzanska).resultsFor);
});

test('formatMessages for a geocoded result shows "Wyniki dla" and the geocode distance note', () => {
  const context = buildFromGeocode('Kraków', {
    formatted_address: 'Kraków, Polska',
    geometry: { location: { lat: 50.06, lng: 19.94 } }
  });
  const messages = formatMessages(context);
  assert.strictEqual(messages.resultsFor, 'Wyniki dla: Kraków, Polska');
  assert.strictEqual(messages.distanceNote, 'Odległość liczona od rozpoznanego punktu wyszukiwania.');
});

test('buildFromGps produces no address, only a GPS distance note', () => {
  const context = buildFromGps(50.06, 19.94);
  assert.strictEqual(context.source, 'gps');
  assert.strictEqual(context.formattedAddress, null);
  const messages = formatMessages(context);
  assert.strictEqual(messages.resultsFor, null);
  assert.strictEqual(messages.distanceNote, 'Odległość liczona od Twojej lokalizacji.');
});

test('formatMessages handles a missing/null context without throwing', () => {
  const messages = formatMessages(null);
  assert.strictEqual(messages.resultsFor, null);
  assert.strictEqual(messages.distanceNote, null);
});

test('buildFromGeocode falls back to user input only when formatted_address is missing', () => {
  const context = buildFromGeocode('Zakopane', {});
  assert.strictEqual(context.formattedAddress, 'Zakopane');
});
