// Platform Core domain contracts. Plain-JS "interfaces": documented shapes,
// a structural validator, and Null implementations that make the OFF state a
// first-class citizen - when flags are off or the DB is absent, the app wires
// the Null objects and behaves byte-for-byte like the pre-platform baseline.
//
// Contract: PlaceCatalog
//   upsertObservation({googlePlaceId, country, mode, seenAt}) -> Promise<{inserted:boolean}>
//   getKnownPlaceIds({country, city, module}) -> Promise<string[]>
//   markSeen(googlePlaceIds, seenAt) -> Promise<void>
//   isAvailable() -> boolean
//
// Contract: DynamicCache (Google data with TTL - never a permanent store)
//   get(placeId, fieldGroup) -> Promise<{payload, fetchedAt, validUntil, stale}|null>
//   put(placeId, fieldGroup, payload, ttlMs, meta) -> Promise<void>
//
// Contract: SourceAdapter (a discovery source, e.g. Google Nearby)
//   discover({center, module, country, strategy}) -> Promise<{places, apiCalls}>

const FIELD_GROUPS = ['SUMMARY', 'OPENING_HOURS', 'BUSINESS_STATUS', 'RATING', 'CONTACT', 'PHOTOS', 'REVIEWS_SAMPLE'];

const LIFECYCLE_STATUSES = ['DISCOVERED', 'ACTIVE', 'SUSPECTED_CLOSED', 'CLOSED', 'MOVED', 'HIDDEN', 'ARCHIVED'];
const CURATION_STATUSES = ['AUTOMATIC', 'VERIFIED', 'CURATED', 'PARTNER', 'REJECTED'];
const ACTIVITY_STATUSES = ['ACTIVE_CONFIRMED', 'ACTIVE_LIKELY', 'UNKNOWN', 'POSSIBLY_INACTIVE', 'CLOSED_CONFIRMED', 'MOVED'];

const CATALOG_METHODS = ['upsertObservation', 'upsertObservations', 'getKnownPlaceIds', 'markSeen', 'isAvailable'];
const DYNAMIC_CACHE_METHODS = ['get', 'put'];
const SOURCE_ADAPTER_METHODS = ['discover'];

function implementsContract(obj, methods) {
  return !!obj && methods.every((m) => typeof obj[m] === 'function');
}

/**
 * The OFF-state catalog: never available, remembers nothing, costs nothing.
 * Wired whenever CATALOG_CORE_ENABLED is false or the DB is unreachable, so
 * live search continues exactly as before Platform Core existed.
 */
function createNullCatalog() {
  return {
    isAvailable: () => false,
    upsertObservation: async () => ({ inserted: false }),
    upsertObservations: async () => ({ inserted: 0, updated: 0 }),
    getKnownPlaceIds: async () => [],
    markSeen: async () => {}
  };
}

/** The OFF-state dynamic cache: always miss, writes are dropped. */
function createNullDynamicCache() {
  return {
    get: async () => null,
    put: async () => {}
  };
}

module.exports = {
  FIELD_GROUPS,
  LIFECYCLE_STATUSES,
  CURATION_STATUSES,
  ACTIVITY_STATUSES,
  CATALOG_METHODS,
  DYNAMIC_CACHE_METHODS,
  SOURCE_ADAPTER_METHODS,
  implementsContract,
  createNullCatalog,
  createNullDynamicCache
};
