(function (global) {
  function toMinuteOfDay(hour = 0, minute = 0) {
    return (hour || 0) * 60 + (minute || 0);
  }

  /**
   * Day-of-week index, 0=Sunday..6=Saturday — the SAME convention Google Places
   * uses for period.open.day/period.close.day (and the same as JS's native
   * Date.getDay()). Previously this converted to a Monday-first 0-6 scheme by
   * default, which silently mismatched against Google's raw (unconverted)
   * period.day values any time the default (no explicit dayIndex) path was used
   * — the root cause of the "Białka Pizza Express" bug (see opening-hours fix).
   * @param {number} [dayOfWeek] - pass-through override, still 0=Sunday
   */
  function getDayIndex(dayOfWeek) {
    if (typeof dayOfWeek === 'number') return dayOfWeek;
    return new Date().getDay();
  }

  function isWithinPeriod(dayIndex, minutes, openDay, openMin, closeDay, closeMin) {
    if (openDay === closeDay && openMin === closeMin) return true;
    if (openDay === closeDay) {
      if (dayIndex !== openDay) return false;
      if (closeMin > openMin) return minutes >= openMin && minutes < closeMin;
      return minutes >= openMin || minutes < closeMin;
    }
    if (dayIndex === openDay) return minutes >= openMin;
    if (dayIndex === closeDay) return minutes < closeMin;
    return false;
  }

  function resolveOpeningPeriods(place) {
    const current = place.currentOpeningHours;
    if (current && Array.isArray(current.periods) && current.periods.length) {
      return current.periods;
    }
    const regular = place.regularOpeningHours;
    if (regular && Array.isArray(regular.periods) && regular.periods.length) {
      return regular.periods;
    }
    return null;
  }

  function isOpenAt(place, hour, minute, options = {}) {
    const dayIndex = options.dayIndex !== undefined ? options.dayIndex : getDayIndex();
    const minutes = toMinuteOfDay(hour, minute);
    const periods = resolveOpeningPeriods(place);
    if (periods) {
      for (const period of periods) {
        if (!period.open || !period.close) continue;
        const openDay = period.open.day;
        const openMin = toMinuteOfDay(period.open.hour, period.open.minute);
        const closeDay = period.close.day;
        const closeMin = toMinuteOfDay(period.close.hour, period.close.minute);
        if (isWithinPeriod(dayIndex, minutes, openDay, openMin, closeDay, closeMin)) {
          return true;
        }
      }
      return false;
    }

    if (place.currentOpeningHours && place.currentOpeningHours.openNow !== undefined) {
      return place.currentOpeningHours.openNow === true;
    }

    return null;
  }

  function formatHHMM(absMinutes) {
    const m = ((absMinutes % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function is24Hours(periods) {
    return periods.some((p) => p.open && p.close &&
      p.open.day === p.close.day &&
      (p.open.hour || 0) === (p.close.hour || 0) &&
      (p.open.minute || 0) === (p.close.minute || 0));
  }

  /**
   * A period's open/close endpoint can be marked `truncated` by Google when it
   * falls outside the requested time window — i.e. it isn't a real, trustworthy
   * boundary. Such a period must never be used to compute a status/time (it must
   * not shadow a clean regularOpeningHours period either).
   */
  function isUsablePeriod(period) {
    if (!period || !period.open || !period.close) return false;
    if (period.open.truncated || period.close.truncated) return false;
    return true;
  }

  function usablePeriods(periodsArr) {
    if (!Array.isArray(periodsArr) || !periodsArr.length) return null;
    const usable = periodsArr.filter(isUsablePeriod);
    return usable.length ? usable : null;
  }

  /**
   * Which periods list to trust for the *details* computation, mode-dependent:
   * "now" mode trusts currentOpeningHours first (it reflects today's real,
   * possibly-exceptional hours); manual-time simulation trusts regularOpeningHours
   * first (the simulated hour has no specific date, so the general weekly
   * schedule is the more honest answer than today's possibly-exceptional one).
   */
  function resolvePeriodsForDetails(place, isManual) {
    const current = usablePeriods(place.currentOpeningHours && place.currentOpeningHours.periods);
    const regular = usablePeriods(place.regularOpeningHours && place.regularOpeningHours.periods);
    return isManual ? (regular || current || null) : (current || regular || null);
  }

  function parseIsoInstant(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Formats an absolute instant as local HH:MM. With no explicit timeZone, this
   * uses the runtime's own local timezone (correct as-is for a real browser).
   * Tests pass `timeZone: 'Europe/Warsaw'` explicitly so results don't depend on
   * the machine/CI running them.
   */
  function formatInstantLocal(date, timeZone) {
    if (!timeZone) {
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(date);
    let h = parts.find((p) => p.type === 'hour').value;
    const m = parts.find((p) => p.type === 'minute').value;
    if (h === '24') h = '00';
    return `${h}:${m}`;
  }

  function resolveNow(options) {
    if (options.now instanceof Date && !isNaN(options.now.getTime())) return options.now;
    if (typeof options.now === 'string') {
      const parsed = parseIsoInstant(options.now);
      if (parsed) return parsed;
    }
    return new Date();
  }

  /**
   * "Now" mode only: currentOpeningHours.nextCloseTime/nextOpenTime are absolute
   * ISO instants Google itself already computed correctly (no day-of-week
   * arithmetic needed) — authoritative whenever present, per the required source
   * order (nextCloseTime/nextOpenTime before periods).
   */
  function detailsFromAbsoluteTimes(currentHours, now, timeZone) {
    if (!currentHours) return null;

    if (currentHours.openNow === true && currentHours.nextCloseTime) {
      const closeDate = parseIsoInstant(currentHours.nextCloseTime);
      if (closeDate) {
        const minutesUntilChange = Math.round((closeDate.getTime() - now.getTime()) / 60000);
        const closesAt = formatInstantLocal(closeDate, timeZone);
        const label = minutesUntilChange >= 0 && minutesUntilChange <= 60
          ? `Zamyka za ${minutesUntilChange} min`
          : `Otwarte do ${closesAt}`;
        return { isOpen: true, label, closesAt, opensAt: null, minutesUntilChange, is24Hours: false };
      }
    }

    if (currentHours.openNow === false && currentHours.nextOpenTime) {
      const openDate = parseIsoInstant(currentHours.nextOpenTime);
      if (openDate) {
        const minutesUntilChange = Math.round((openDate.getTime() - now.getTime()) / 60000);
        const opensAt = formatInstantLocal(openDate, timeZone);
        return { isOpen: false, label: `Otwiera o ${opensAt}`, closesAt: null, opensAt, minutesUntilChange, is24Hours: false };
      }
    }

    return null;
  }

  /**
   * Scans a periods list (already the "right" one for the mode - see
   * resolvePeriodsForDetails) for the current open/closed status and, when
   * possible, the next change time — using a single, convention-consistent
   * day index (0=Sunday, matching Google's period.day) for both "today" and
   * the periods themselves, which is what the old default-dayIndex path got
   * wrong.
   */
  function detailsFromPeriods(periods, dayIndex, hour, minute, isManual) {
    if (is24Hours(periods)) {
      return { isOpen: true, label: 'Otwarte całą dobę', closesAt: null, opensAt: null, minutesUntilChange: null, is24Hours: true };
    }

    const minutes = toMinuteOfDay(hour, minute);
    const nowAbs = dayIndex * 1440 + minutes;

    let isOpen = false;
    for (const period of periods) {
      const openMin = toMinuteOfDay(period.open.hour, period.open.minute);
      const closeMin = toMinuteOfDay(period.close.hour, period.close.minute);
      if (isWithinPeriod(dayIndex, minutes, period.open.day, openMin, period.close.day, closeMin)) {
        isOpen = true;
        break;
      }
    }

    let closesAtAbs = null;
    let opensAtAbs = null;

    for (const period of periods) {
      const openAbsBase = period.open.day * 1440 + toMinuteOfDay(period.open.hour, period.open.minute);
      let closeAbsBase = period.close.day * 1440 + toMinuteOfDay(period.close.hour, period.close.minute);
      if (closeAbsBase <= openAbsBase) closeAbsBase += 7 * 1440;

      // A period can apply to "this week", "last week" (started a few days ago
      // and may still be running), or "next week" relative to `now` - check all
      // three shifts so a period starting the previous day is still recognized,
      // and day 6 (Sat) -> day 0 (Sun) wraps correctly.
      for (const shift of [-7 * 1440, 0, 7 * 1440]) {
        const openAbs = openAbsBase + shift;
        const closeAbs = closeAbsBase + shift;

        if (isOpen && nowAbs >= openAbs && nowAbs < closeAbs) {
          if (closesAtAbs === null || closeAbs < closesAtAbs) closesAtAbs = closeAbs;
        }
        if (!isOpen && openAbs > nowAbs) {
          if (opensAtAbs === null || openAbs < opensAtAbs) opensAtAbs = openAbs;
        }
      }
    }

    if (isOpen && closesAtAbs !== null) {
      const minutesUntilChange = closesAtAbs - nowAbs;
      const closesAt = formatHHMM(closesAtAbs);
      const label = !isManual && minutesUntilChange <= 60
        ? `Zamyka za ${minutesUntilChange} min`
        : `Otwarte do ${closesAt}`;
      return { isOpen: true, label, closesAt, opensAt: null, minutesUntilChange, is24Hours: false };
    }

    if (!isOpen && opensAtAbs !== null) {
      const minutesUntilChange = opensAtAbs - nowAbs;
      const opensAt = formatHHMM(opensAtAbs);
      return { isOpen: false, label: `Otwiera o ${opensAt}`, closesAt: null, opensAt, minutesUntilChange, is24Hours: false };
    }

    // Couldn't determine the next change from the periods we have - don't guess.
    return { isOpen, label: isOpen ? 'Otwarte' : 'Zamknięte', closesAt: null, opensAt: null, minutesUntilChange: null, is24Hours: false };
  }

  /**
   * Rich "otwarte do / otwiera o" details for a place. Never guesses: if a next
   * change can't be determined from the data we have, it falls back to the
   * plain Otwarte/Zamknięte/Brak danych label instead of fabricating a time.
   *
   * Source priority - "now" mode (options.isManual falsy):
   *   1. currentOpeningHours.nextCloseTime / nextOpenTime (absolute, authoritative)
   *   2. currentOpeningHours.periods
   *   3. regularOpeningHours.periods
   *   4. currentOpeningHours.openNow / regularOpeningHours.openNow (plain status only)
   *   5. brak danych
   * Source priority - manual-time mode (options.isManual true):
   *   1. regularOpeningHours.periods
   *   2. currentOpeningHours.periods
   *   3. openNow as a last resort (plain status only - never a fabricated time)
   *   nextCloseTime/nextOpenTime are never used for a simulated hour.
   *
   * @param {object} place
   * @param {number} hour
   * @param {number} minute
   * @param {object} [options]
   * @param {number} [options.dayIndex] - 0=Sun..6=Sat, defaults to today
   * @param {boolean} [options.isManual] - true when the user picked the time by hand
   * @param {Date|string} [options.now] - inject "the current instant" (tests only);
   *   defaults to `new Date()`. Only consulted in "now" mode.
   * @param {string} [options.timeZone] - e.g. 'Europe/Warsaw' (tests only); with no
   *   value, absolute-time formatting uses the runtime's own local timezone.
   * @returns {{isOpen: boolean|null, label: string, closesAt: string|null, opensAt: string|null, minutesUntilChange: number|null, is24Hours: boolean}}
   */
  function getOpeningStatusDetails(place, hour, minute, options = {}) {
    const dayIndex = options.dayIndex !== undefined ? options.dayIndex : getDayIndex();
    const isManual = !!options.isManual;

    if (!isManual) {
      const now = resolveNow(options);
      const fromAbsolute = detailsFromAbsoluteTimes(place.currentOpeningHours, now, options.timeZone);
      if (fromAbsolute) return fromAbsolute;
    }

    const periods = resolvePeriodsForDetails(place, isManual);
    if (periods) return detailsFromPeriods(periods, dayIndex, hour, minute, isManual);

    const openNow = isManual
      ? (place.regularOpeningHours && place.regularOpeningHours.openNow !== undefined
          ? place.regularOpeningHours.openNow === true
          : (place.currentOpeningHours && place.currentOpeningHours.openNow !== undefined
              ? place.currentOpeningHours.openNow === true
              : null))
      : isOpenAt(place, hour, minute, { dayIndex });

    if (openNow === null) return { isOpen: null, label: 'Brak danych', closesAt: null, opensAt: null, minutesUntilChange: null, is24Hours: false };
    return { isOpen: openNow, label: openNow ? 'Otwarte' : 'Zamknięte', closesAt: null, opensAt: null, minutesUntilChange: null, is24Hours: false };
  }

  global.GastroOpeningHours = { isOpenAt, getDayIndex, getOpeningStatusDetails };
})(window);
