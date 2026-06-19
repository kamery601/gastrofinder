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

  global.GastroOpeningHours = { isOpenAt, getDayIndex };
})(window);
