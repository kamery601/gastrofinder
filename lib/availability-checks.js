// Activity checks: is a place Google still lists actually operating?
//
// Google keeps showing opening hours (and "open now") for listings that are
// long dead or only run in winter next to a ski lift - confirmed in Zakopane /
// Bukowina / Białka in October 2026 (e.g. a grill bar with no review since
// Dec 2023 shown as "Otwarte"). Google's own businessStatus does not catch it.
//
// Source of truth for the verdicts: scripts/audit-availability.js, which
// fetches the newest review DATES per place (texts are never kept) and writes
// data/availability-checks.json. The server applies that file to every search
// - no extra Google calls at request time.
//
// What is stored is first-party derived classification only (verdict, reason,
// validity window), never Google content. Every verdict expires, so a stale
// audit fails open back to plain Google data instead of hiding places forever.

const fs = require('node:fs');
const path = require('node:path');

const RULES_VERSION = '2026-10-09';
const CHECKS_PATH = path.join(__dirname, '..', 'data', 'availability-checks.json');

const WINTER_MONTHS = new Set([12, 1, 2, 3]);
const INACTIVE_AFTER_DAYS = 365;
const DORMANT_AFTER_DAYS = 180;
const DORMANT_MIN_REVIEWS = 30;

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function monthOf(isoDate) {
  return Number(String(isoDate).slice(5, 7));
}

function monthsLabel(days) {
  const months = Math.max(1, Math.round(days / 30));
  return `${months} mies.`;
}

/**
 * Classifies one place from review dates (newest first or any order).
 * Verdicts:
 *   CLOSED_IN_GOOGLE - Google itself reports it not operational
 *   INACTIVE         - no review for over 12 months: a dead listing; hidden
 *   WINTER_SEASONAL  - recent reviews (almost) only from Dec-Mar and nothing
 *                      since spring: a winter-only place (ski lift stands);
 *                      shown as closed outside the winter season
 *   DORMANT          - an established place (30+ reviews) silent for 6+
 *                      months: shown with an "unconfirmed" warning
 *   LOW_DATA / OK    - nothing to act on
 * Ski-lift proximity is deliberately NOT an input: the ski_resort type in
 * Google also tags ski schools, rentals and even a sushi bar.
 * @returns {{verdict: string, reason: string|null, newestReview: string|null, silentDays: number|null}}
 */
function classifyActivity({ businessStatus, totalReviews = 0, reviewDates = [] }, now = new Date()) {
  const dates = [...reviewDates].filter(Boolean).sort().reverse();
  const newest = dates[0] || null;

  if (businessStatus && businessStatus !== 'OPERATIONAL') {
    return { verdict: 'CLOSED_IN_GOOGLE', reason: `Google: ${businessStatus}`, newestReview: newest, silentDays: null };
  }
  if (!newest) {
    return { verdict: 'LOW_DATA', reason: null, newestReview: null, silentDays: null };
  }

  const silentDays = daysBetween(new Date(`${newest}T12:00:00Z`), now);
  const base = { newestReview: newest, silentDays };

  if (silentDays > INACTIVE_AFTER_DAYS) {
    return { ...base, verdict: 'INACTIVE', reason: `Brak aktywności od ${monthsLabel(silentDays)}` };
  }

  const winter = dates.filter((d) => WINTER_MONTHS.has(monthOf(d))).length;
  const newestMonth = monthOf(newest);
  const newestInWinterOrEarlySpring = WINTER_MONTHS.has(newestMonth) || newestMonth === 4;
  if (dates.length >= 3 && winter >= dates.length - 1 && newestInWinterOrEarlySpring && silentDays > 60) {
    return { ...base, verdict: 'WINTER_SEASONAL', reason: 'Lokal sezonowy – działa głównie zimą' };
  }

  if (totalReviews >= DORMANT_MIN_REVIEWS && silentDays > DORMANT_AFTER_DAYS) {
    return { ...base, verdict: 'DORMANT', reason: `Brak aktywności od ${monthsLabel(silentDays)} – może być nieczynny` };
  }

  if (totalReviews < 10) return { ...base, verdict: 'LOW_DATA', reason: null };
  return { ...base, verdict: 'OK', reason: null };
}

/**
 * Validity window per verdict - every verdict must be re-confirmed by a new
 * audit, otherwise it lapses and Google data is shown unmodified again.
 */
function validUntilFor(verdict, now = new Date()) {
  const plus = (days) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  if (verdict === 'INACTIVE') return plus(120);
  if (verdict === 'DORMANT') return plus(45);
  if (verdict === 'WINTER_SEASONAL') {
    // valid until the end of this off-season (30 Nov); a December audit
    // starts the next season fresh
    const y = now.getUTCMonth() + 1 === 12 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    return `${y}-11-30`;
  }
  return plus(45);
}

const ACTIONABLE = new Set(['INACTIVE', 'WINTER_SEASONAL', 'DORMANT']);

function buildChecksFile(classified, now = new Date()) {
  const checks = {};
  for (const { placeId, verdict, reason } of classified) {
    if (!placeId || !ACTIONABLE.has(verdict)) continue;
    checks[placeId] = {
      verdict,
      reason,
      checkedAt: now.toISOString().slice(0, 10),
      validUntil: validUntilFor(verdict, now)
    };
  }
  return { rulesVersion: RULES_VERSION, generatedAt: now.toISOString(), checks };
}

function isoDateWarsaw(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${v.year}-${v.month}-${v.day}`;
}

function loadChecks(filePath = CHECKS_PATH) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { rulesVersion: null, generatedAt: null, checks: {} };
  }
}

/**
 * Applies checks to a search result. INACTIVE places are removed; winter-only
 * places (outside Dec-Mar) and dormant places get an availabilityOverride the
 * frontend renders as not-open with an explanation. A manual, locally verified
 * override (lib/availability-overrides.js) always wins over an automatic one.
 * @returns {{places: object[], hidden: number, annotated: number}}
 */
function applyAvailabilityChecks(places, { enabled, checksFile, now = new Date() } = {}) {
  if (!enabled || !Array.isArray(places) || !places.length) {
    return { places: places || [], hidden: 0, annotated: 0 };
  }
  const checks = (checksFile && checksFile.checks) || {};
  const today = isoDateWarsaw(now);
  const month = Number(today.slice(5, 7));
  const winterNow = WINTER_MONTHS.has(month);

  let hidden = 0;
  let annotated = 0;
  const out = [];
  for (const place of places) {
    const check = place && checks[place.id];
    if (!check || !check.validUntil || today > check.validUntil || place.availabilityOverride) {
      out.push(place);
      continue;
    }
    if (check.verdict === 'INACTIVE') {
      hidden += 1;
      continue;
    }
    if (check.verdict === 'WINTER_SEASONAL' && !winterNow) {
      annotated += 1;
      out.push({ ...place, availabilityOverride: {
        status: 'SEASONAL_CLOSED', season: 'WINTER', label: 'Lokal sezonowy – poza zimą zwykle nieczynny',
        verifiedAt: check.checkedAt, validUntil: check.validUntil, source: 'ACTIVITY_AUDIT'
      } });
      continue;
    }
    if (check.verdict === 'DORMANT') {
      annotated += 1;
      out.push({ ...place, availabilityOverride: {
        status: 'ACTIVITY_UNCONFIRMED', label: check.reason || 'Brak potwierdzenia, że lokal działa',
        verifiedAt: check.checkedAt, validUntil: check.validUntil, source: 'ACTIVITY_AUDIT'
      } });
      continue;
    }
    out.push(place);
  }
  return { places: out, hidden, annotated };
}

module.exports = {
  RULES_VERSION,
  CHECKS_PATH,
  classifyActivity,
  validUntilFor,
  buildChecksFile,
  loadChecks,
  applyAvailabilityChecks
};
