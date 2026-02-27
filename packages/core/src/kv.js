export function isKvStore(store) {
  return Boolean(
    store &&
      typeof store.get === 'function' &&
      typeof store.put === 'function' &&
      typeof store.list === 'function'
  );
}

export function normalizeKvKeys(listRes) {
  const keysRaw = Array.isArray(listRes?.keys)
    ? listRes.keys
    : Array.isArray(listRes?.objects)
      ? listRes.objects
      : [];
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

function isKvListComplete(listRes) {
  if (typeof listRes?.list_complete === 'boolean') return listRes.list_complete;
  if (typeof listRes?.complete === 'boolean') return listRes.complete;
  return !listRes?.cursor;
}

function getKvCursor(listRes) {
  if (typeof listRes?.cursor === 'string' && listRes.cursor) return listRes.cursor;
  return '';
}

/**
 * Generic paginated KV key listing for providers with different list response shapes.
 */
export async function listKvKeys(
  kv,
  { prefix = '', pageLimit = 256, maxPages = 40, cursor = '' } = {}
) {
  if (!kv || typeof kv.list !== 'function') {
    throw new Error('invalid kv store: missing list()');
  }

  const result = [];
  const seen = new Set();
  let nextCursor = cursor;

  for (let page = 0; page < maxPages; page += 1) {
    const listRes = await kv.list({
      ...(prefix ? { prefix } : {}),
      ...(pageLimit ? { limit: pageLimit } : {}),
      ...(nextCursor ? { cursor: nextCursor } : {})
    });

    for (const key of normalizeKvKeys(listRes)) {
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(key);
    }

    const upcomingCursor = getKvCursor(listRes);
    if (isKvListComplete(listRes) || !upcomingCursor || upcomingCursor === nextCursor) {
      break;
    }
    nextCursor = upcomingCursor;
  }

  return result;
}
