export function isKvStore(store) {
  return Boolean(
    store &&
      typeof store.get === 'function' &&
      typeof store.put === 'function' &&
      typeof store.list === 'function'
  );
}

export function normalizeKvKeys(listRes) {
  const keysRaw = Array.isArray(listRes?.keys) ? listRes.keys : [];
  return keysRaw
    .map((k) => {
      if (typeof k === 'string') return k;
      if (k && typeof k === 'object') {
        return k.name || k.key || k.Key || k.id || '';
      }
      return '';
    })
    .filter((k) => typeof k === 'string' && k);
}
