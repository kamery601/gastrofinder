(function (global) {
  function toMinuteOfDay(hour = 0, minute = 0) {
    return (hour || 0) * 60 + (minute || 0);
  }

  function getDayIndex(dayOfWeek) {
    if (typeof dayOfWeek === 'number') {
      return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    }
    const dow = new Date().getDay();
    return dow === 0 ? 6 : dow - 1;
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

  const NO_DETAILS = { closesAt: null, opensAt: null, minutesUntilChange: null };

  /**
   * Rich "otwarte do / otwiera o" details for a place, built on top of isOpenAt so
   * the isOpen boolean always stays consistent with it. Never guesses: if a next
   * change can't be determined from the periods we have, it falls back to the
   * plain Otwarte/Zamknięte/Brak danych label instead of fabricating a time.
   *
   * @param {object} place
   * @param {number} hour
   * @param {number} minute
   * @param {object} [options]
   * @param {number} [options.dayIndex] - 0=Mon..6=Sun, defaults to today
   * @param {boolean} [options.isManual] - true when the user picked the time by hand;
   *   suppresses "Zamyka za X min" in favor of the absolute "Otwarte do HH:MM"
   * @returns {{isOpen: boolean|null, label: string, closesAt: string|null, opensAt: string|null, minutesUntilChange: number|null, is24Hours: boolean}}
   */
  function getOpeningStatusDetails(place, hour, minute, options = {}) {
    const dayIndex = options.dayIndex !== undefined ? options.dayIndex : getDayIndex();
    const isManual = !!options.isManual;
    const periods = resolveOpeningPeriods(place);

    if (!periods) {
      const openNow = isOpenAt(place, hour, minute, options);
      if (openNow === null) return { isOpen: null, label: 'Brak danych', is24Hours: false, ...NO_DETAILS };
      return { isOpen: openNow, label: openNow ? 'Otwarte' : 'Zamknięte', is24Hours: false, ...NO_DETAILS };
    }

    if (is24Hours(periods)) {
      return { isOpen: true, label: 'Otwarte całą dobę', is24Hours: true, ...NO_DETAILS };
    }

    const isOpen = isOpenAt(place, hour, minute, options);
    const nowAbs = dayIndex * 1440 + toMinuteOfDay(hour, minute);

    let closesAtAbs = null;
    let opensAtAbs = null;

    for (const period of periods) {
      if (!period.open || !period.close) continue;
      const openAbsBase = period.open.day * 1440 + toMinuteOfDay(period.open.hour, period.open.minute);
      let closeAbsBase = period.close.day * 1440 + toMinuteOfDay(period.close.hour, period.close.minute);
      if (closeAbsBase <= openAbsBase) closeAbsBase += 7 * 1440;

      // A period can apply to "this week", "last week" (started a few days ago and
      // may still be running), or "next week" relative to `now` — check all three
      // shifts so a period starting the previous day is still recognized.
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
    return { isOpen, label: isOpen ? 'Otwarte' : 'Zamknięte', is24Hours: false, ...NO_DETAILS };
  }

  global.GastroOpeningHours = { isOpenAt, getDayIndex, getOpeningStatusDetails };
})(window);
