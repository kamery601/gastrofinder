const store = new Map();

function getCache(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCache(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function cached(key, ttlMs, compute) {
  const cachedValue = getCache(key);
  if (cachedValue !== undefined) return cachedValue;
  const value = await compute();
  setCache(key, value, ttlMs);
  return value;
}

module.exports = { getCache, setCache, cached };