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
const { isOpenAt, getOpeningStatusDetails } = sandbox.window.GastroOpeningHours;

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

// --- Faza 5 / Faza 8: getOpeningStatusDetails ("otwarte do" / "otwiera o") -----

test('details: same-day period, well before closing shows "Otwarte do HH:MM"', () => {
  const place = {
    currentOpeningHours: { periods: [{ open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 22, minute: 0 } }] }
  };
  const details = getOpeningStatusDetails(place, 12, 0, { dayIndex: 1 });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.label, 'Otwarte do 22:00');
  assert.strictEqual(details.closesAt, '22:00');
});

test('details: "teraz" mode shows "Zamyka za X min" within the last hour before closing', () => {
  const place = {
    currentOpeningHours: { periods: [{ open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 22, minute: 0 } }] }
  };
  const details = getOpeningStatusDetails(place, 21, 25, { dayIndex: 1, isManual: false });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.label, 'Zamyka za 35 min');
  assert.strictEqual(details.minutesUntilChange, 35);
});

test('details: manual time mode never shows relative "Zamyka za X min", only the absolute time', () => {
  const place = {
    currentOpeningHours: { periods: [{ open: { day: 1, hour: 20, minute: 0 }, close: { day: 2, hour: 1, minute: 0 } }] }
  };
  const details = getOpeningStatusDetails(place, 0, 40, { dayIndex: 2, isManual: true });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.label, 'Otwarte do 01:00');
});

test('details: midnight crossover (22:00-04:00), open at 23:00, closes at 04:00 next day', () => {
  const place = {
    currentOpeningHours: { periods: [{ open: { day: 0, hour: 22, minute: 0 }, close: { day: 1, hour: 4, minute: 0 } }] }
  };
  const details = getOpeningStatusDetails(place, 23, 0, { dayIndex: 0 });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.closesAt, '04:00');
});

test('details: midnight crossover, still open at 02:00 the following day', () => {
  const place = {
    currentOpeningHours: { periods: [{ open: { day: 0, hour: 22, minute: 0 }, close: { day: 1, hour: 4, minute: 0 } }] }
  };
  const details = getOpeningStatusDetails(place, 2, 0, { dayIndex: 1 });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.closesAt, '04:00');
  assert.strictEqual(details.label, 'Otwarte do 04:00');
});

test('details: a period that started the previous day is still recognized after midnight', () => {
  // Friday 20:00 -> Saturday 02:00. Asking about Saturday 01:00 should see the period
  // that "started the previous day" relative to Saturday.
  const place = {
    currentOpeningHours: { periods: [{ open: { day: 4, hour: 20, minute: 0 }, close: { day: 5, hour: 2, minute: 0 } }] }
  };
  const details = getOpeningStatusDetails(place, 1, 0, { dayIndex: 5 });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.closesAt, '02:00');
});

test('details: 24h place always reports "Otwarte całą dobę" with no closesAt', () => {
  const place = {
    currentOpeningHours: { periods: [{ open: { day: 3, hour: 0, minute: 0 }, close: { day: 3, hour: 0, minute: 0 } }] }
  };
  const details = getOpeningStatusDetails(place, 3, 30, { dayIndex: 3 });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.is24Hours, true);
  assert.strictEqual(details.label, 'Otwarte całą dobę');
  assert.strictEqual(details.closesAt, null);
});

test('details: several periods the same day (lunch + dinner) picks the correct current one', () => {
  const place = {
    currentOpeningHours: {
      periods: [
        { open: { day: 2, hour: 8, minute: 0 }, close: { day: 2, hour: 14, minute: 0 } },
        { open: { day: 2, hour: 18, minute: 0 }, close: { day: 2, hour: 23, minute: 0 } }
      ]
    }
  };
  const duringLunch = getOpeningStatusDetails(place, 10, 0, { dayIndex: 2 });
  assert.strictEqual(duringLunch.isOpen, true);
  assert.strictEqual(duringLunch.closesAt, '14:00');

  const betweenShifts = getOpeningStatusDetails(place, 16, 0, { dayIndex: 2 });
  assert.strictEqual(betweenShifts.isOpen, false);
  assert.strictEqual(betweenShifts.label, 'Otwiera o 18:00');

  const duringDinner = getOpeningStatusDetails(place, 20, 0, { dayIndex: 2 });
  assert.strictEqual(duringDinner.isOpen, true);
  assert.strictEqual(duringDinner.closesAt, '23:00');
});

test('details: closed now, next opening reported as "Otwiera o HH:MM"', () => {
  const place = {
    currentOpeningHours: { periods: [{ open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 16, minute: 0 } }] }
  };
  const details = getOpeningStatusDetails(place, 20, 0, { dayIndex: 1 });
  assert.strictEqual(details.isOpen, false);
  assert.strictEqual(details.label, 'Otwiera o 08:00');
});

test('details: no opening-hours data at all falls back to "Brak danych", never guesses', () => {
  const place = { currentOpeningHours: {}, regularOpeningHours: {} };
  const details = getOpeningStatusDetails(place, 14, 0);
  assert.strictEqual(details.isOpen, null);
  assert.strictEqual(details.label, 'Brak danych');
  assert.strictEqual(details.closesAt, null);
  assert.strictEqual(details.opensAt, null);
});

test('details: only openNow (no periods) falls back to plain Otwarte/Zamknięte, no fabricated time', () => {
  const openPlace = { currentOpeningHours: { openNow: true } };
  const details = getOpeningStatusDetails(openPlace, 14, 0);
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.label, 'Otwarte');
  assert.strictEqual(details.closesAt, null);
});

// --- Production regression: "Białka Pizza Express | Dowozimy do 01:00!" ----
// Confirmed bug: currentOpeningHours.nextCloseTime + valid periods existed, but
// the card only ever showed the plain "Otwarte" label. Root cause: the day-index
// getOpeningStatusDetails/isOpenAt used by default (no explicit dayIndex) was
// silently converted to a Monday-first 0-6 scheme, while period.open.day/
// period.close.day are Google's raw Sunday-first values (0=Sunday) — every
// real-clock ("now" mode) lookup compared two incompatible day numberings and
// could both fail to find a next-change time AND, for day-varying schedules,
// get the open/closed status itself wrong.

function bialkaPizzaPlace() {
  return {
    currentOpeningHours: {
      openNow: true,
      nextCloseTime: '2026-07-16T23:00:00Z',
      periods: [
        {
          open: { day: 4, hour: 16, minute: 0, date: { year: 2026, month: 7, day: 16 } },
          close: { day: 5, hour: 1, minute: 0, date: { year: 2026, month: 7, day: 17 } }
        }
      ]
    },
    regularOpeningHours: {
      openNow: true,
      periods: [
        { open: { day: 4, hour: 16, minute: 0 }, close: { day: 5, hour: 1, minute: 0 } }
      ]
    }
  };
}

test('details: Białka Pizza Express at 23:04 Europe/Warsaw shows "Otwarte do 01:00" (production regression)', () => {
  const place = bialkaPizzaPlace();
  const details = getOpeningStatusDetails(place, 23, 4, {
    now: '2026-07-16T21:04:00Z',
    timeZone: 'Europe/Warsaw'
  });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.label, 'Otwarte do 01:00');
  assert.strictEqual(details.closesAt, '01:00');
});

test('details: within 60 min of nextCloseTime shows "Zamyka za X min"', () => {
  const place = bialkaPizzaPlace();
  const details = getOpeningStatusDetails(place, 0, 0, {
    now: '2026-07-16T22:35:00Z',
    timeZone: 'Europe/Warsaw'
  });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.label, 'Zamyka za 25 min');
  assert.strictEqual(details.minutesUntilChange, 25);
});

test('details: manual time mode ignores nextCloseTime entirely and reads regularOpeningHours.periods', () => {
  const place = bialkaPizzaPlace();
  const details = getOpeningStatusDetails(place, 23, 4, {
    isManual: true,
    // Deliberately different from nextCloseTime's real close (would be wrong if used)
    now: '2020-01-01T00:00:00Z',
    timeZone: 'Europe/Warsaw',
    dayIndex: 4 // Thursday, Google/Sunday-first convention
  });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.label, 'Otwarte do 01:00');
  assert.strictEqual(details.closesAt, '01:00');
});

test('details: a truncated currentOpeningHours entry must not shadow a valid regularOpeningHours period', () => {
  const place = {
    currentOpeningHours: {
      openNow: true,
      periods: [
        {
          open: { day: 4, hour: 16, minute: 0, truncated: true },
          close: { day: 5, hour: 1, minute: 0 }
        }
      ]
    },
    regularOpeningHours: {
      openNow: true,
      periods: [
        { open: { day: 4, hour: 16, minute: 0 }, close: { day: 5, hour: 1, minute: 0 } }
      ]
    }
  };

  const nowDetails = getOpeningStatusDetails(place, 23, 4, { dayIndex: 4 });
  assert.strictEqual(nowDetails.isOpen, true);
  assert.strictEqual(nowDetails.label, 'Otwarte do 01:00');

  const manualDetails = getOpeningStatusDetails(place, 23, 4, { isManual: true, dayIndex: 4 });
  assert.strictEqual(manualDetails.isOpen, true);
  assert.strictEqual(manualDetails.label, 'Otwarte do 01:00');
});

test('details: day 6 (Saturday) -> day 0 (Sunday) crossover resolves correctly with the fixed day index', () => {
  const place = {
    currentOpeningHours: {
      periods: [{ open: { day: 6, hour: 22, minute: 0 }, close: { day: 0, hour: 3, minute: 0 } }]
    }
  };
  const stillSaturdayNight = getOpeningStatusDetails(place, 23, 0, { dayIndex: 6 });
  assert.strictEqual(stillSaturdayNight.isOpen, true);
  assert.strictEqual(stillSaturdayNight.closesAt, '03:00');

  const earlySunday = getOpeningStatusDetails(place, 1, 30, { dayIndex: 0 });
  assert.strictEqual(earlySunday.isOpen, true);
  assert.strictEqual(earlySunday.closesAt, '03:00');
});

// --- International expansion (SK/HU): hours logic is country-agnostic --------
// PL, SK and HU all sit in the same Central European timezone today; these
// tests pin down that venues shaped like real Slovak/Hungarian places (names
// with diacritics, Google-style periods) flow through the exact same logic.

test('details: Slovak venue (Koliba Štrbské Pleso) - evening hours with diacritics in data', () => {
  const place = {
    displayName: { text: 'Koliba Štrbské Pleso' },
    currentOpeningHours: {
      periods: [{ open: { day: 2, hour: 11, minute: 0 }, close: { day: 2, hour: 22, minute: 0 } }]
    }
  };
  const details = getOpeningStatusDetails(place, 20, 0, { dayIndex: 2 });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.label, 'Otwarte do 22:00');
});

test('details: Hungarian thermal-town venue (Hajdúszoboszló étterem) - midnight crossover', () => {
  const place = {
    displayName: { text: 'Hajdúszoboszlói Étterem és Söröző' },
    currentOpeningHours: {
      periods: [{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }]
    }
  };
  const details = getOpeningStatusDetails(place, 23, 30, { dayIndex: 5 });
  assert.strictEqual(details.isOpen, true);
  assert.strictEqual(details.closesAt, '02:00');
});

test('details: SK/HU venue without hours data still honestly reports Brak danych', () => {
  const place = { displayName: { text: 'Reštaurácia Ždiar' }, currentOpeningHours: {}, regularOpeningHours: {} };
  const details = getOpeningStatusDetails(place, 14, 0);
  assert.strictEqual(details.label, 'Brak danych');
});
