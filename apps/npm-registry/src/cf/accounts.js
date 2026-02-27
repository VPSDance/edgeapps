import { listKvKeys } from '@edgeapps/core/kv';

function normalizePatternList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeAccount(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const token = String(raw.token || '').trim();
  if (!token) return null;
  const username = String(raw.username || raw.user || `user${index + 1}`).trim() || `user${index + 1}`;
  const read = normalizePatternList(raw.read || raw.readPackages || raw.read_patterns);
  const write = normalizePatternList(raw.write || raw.writePackages || raw.write_patterns);
  const isAdmin = raw.admin === true || raw.is_admin === true;
  const effectiveWrite = isAdmin ? ['*'] : write;
  const effectiveRead = isAdmin
    ? ['*']
    : (read.length ? read : effectiveWrite.length ? [...effectiveWrite] : ['*']);
  return {
    username,
    token,
    read: effectiveRead,
    write: effectiveWrite,
    isAdmin
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function patternToRegex(pattern) {
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function packageMatchesPattern(pkgName, pattern) {
  const pkg = String(pkgName || '').trim();
  const rule = String(pattern || '').trim();
  if (!pkg || !rule) return false;
  if (rule === '*') return true;
  if (!rule.includes('*')) return pkg === rule;
  return patternToRegex(rule).test(pkg);
}

function hasPatternPermission(patterns, pkgName) {
  if (!Array.isArray(patterns) || !patterns.length) return false;
  if (!pkgName) return true;
  return patterns.some((rule) => packageMatchesPattern(pkgName, rule));
}

export function resolveAccounts(env) {
  const rawJson = String(env?.NPM_ACCOUNTS_JSON || '').trim();
  if (!rawJson) return [];
  const parsed = parseJson(rawJson);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item, index) => normalizeAccount(item, index))
    .filter(Boolean);
}

function isKvLike(value) {
  return (
    value &&
    typeof value.get === 'function' &&
    typeof value.put === 'function' &&
    typeof value.delete === 'function' &&
    typeof value.list === 'function'
  );
}

function getAuthKv(env) {
  if (isKvLike(env?.NPM_AUTH_KV)) return env.NPM_AUTH_KV;
  return null;
}

const NPM_AUTH_TOKEN_PREFIX = 'npm_auth:token:';
const NPM_TOKEN_LITERAL_PREFIX = 'npr_';

function getTokenKey(tokenId) {
  return `${NPM_AUTH_TOKEN_PREFIX}${tokenId}`;
}

function parseManagedToken(token) {
  const value = String(token || '').trim();
  const matched = value.match(/^npr_([a-z0-9]+)\.([a-f0-9]+)$/i);
  if (!matched) return null;
  return {
    tokenId: matched[1].toLowerCase(),
    secret: matched[2].toLowerCase()
  };
}

function getPepper(env) {
  return String(env?.NPM_AUTH_PEPPER || '').trim();
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(input || ''))
  );
  return toHex(new Uint8Array(digest));
}

async function hashTokenSecret(env, secret) {
  const pepper = getPepper(env);
  return sha256Hex(`${pepper}:${String(secret || '')}`);
}

function randomHex(byteLen = 16) {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function createTokenId() {
  return `${Date.now().toString(36)}${randomHex(4)}`;
}

function createTokenSecret() {
  return randomHex(24);
}

function normalizeManagedTokenRecord(raw, tokenId = '') {
  if (!raw || typeof raw !== 'object') return null;
  const username = String(raw.username || '').trim();
  const tokenHash = String(raw.token_hash || '').trim().toLowerCase();
  if (!username || !tokenHash) return null;
  const read = normalizePatternList(raw.read || raw.readPackages || raw.read_patterns);
  const write = normalizePatternList(raw.write || raw.writePackages || raw.write_patterns);
  const isAdmin = raw.admin === true || raw.is_admin === true;
  const effectiveWrite = isAdmin ? ['*'] : write;
  const effectiveRead = isAdmin
    ? ['*']
    : (read.length ? read : effectiveWrite.length ? [...effectiveWrite] : ['*']);
  return {
    tokenId: String(raw.token_id || tokenId || '').trim(),
    username,
    read: effectiveRead,
    write: effectiveWrite,
    isAdmin,
    tokenHash,
    createdAt: String(raw.created_at || '').trim()
  };
}

export function getAuthSource(env) {
  return getAuthKv(env) ? 'kv' : 'env';
}

export function hasAuthKvBinding(env) {
  return Boolean(getAuthKv(env));
}

export function isAuthConfigured(env) {
  if (hasAuthKvBinding(env)) return true;
  return resolveAccounts(env).length > 0;
}

export function isPatternSubset(subset, superset) {
  const child = normalizePatternList(subset);
  if (!child.length) return true;
  const parent = normalizePatternList(superset);
  if (!parent.length) return false;
  return child.every((item) =>
    parent.some((rule) => packageMatchesPattern(item, rule))
  );
}

export function isAccountAuthorized(account, { scope = 'read', packageName = '' } = {}) {
  if (!account || typeof account !== 'object') return false;
  const pkg = String(packageName || '').trim();
  const writeAllowed = hasPatternPermission(account.write, pkg);
  const readAllowed = hasPatternPermission(account.read, pkg) || writeAllowed;
  if (scope === 'write') return writeAllowed;
  return readAllowed;
}

export function isAccountAdmin(account) {
  return Boolean(account?.isAdmin);
}

async function resolveKvAccount(env, token) {
  const kv = getAuthKv(env);
  if (!kv) return { ok: false, reason: 'missing_npm_auth_kv' };
  const parsed = parseManagedToken(token);
  if (!parsed) return { ok: false, reason: 'invalid_token' };

  const raw = await kv.get(getTokenKey(parsed.tokenId));
  if (!raw) return { ok: false, reason: 'invalid_token' };

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
  const record = normalizeManagedTokenRecord(payload, parsed.tokenId);
  if (!record) return { ok: false, reason: 'invalid_token' };
  const hash = await hashTokenSecret(env, parsed.secret);
  if (hash !== record.tokenHash) {
    return { ok: false, reason: 'invalid_token' };
  }
  return {
    ok: true,
    account: {
      username: record.username,
      read: record.read,
      write: record.write,
      tokenId: record.tokenId,
      isAdmin: record.isAdmin
    }
  };
}

function resolveEnvAccountFromAccounts(token, accounts) {
  if (!accounts.length) {
    return { ok: false, reason: 'missing_token_config' };
  }
  const account = accounts.find((acc) => acc.token === token);
  if (!account) {
    return { ok: false, reason: 'invalid_token' };
  }
  return { ok: true, account };
}

function publicTokenItem(record) {
  return {
    token_id: record.tokenId,
    username: record.username,
    read: record.read,
    write: record.write,
    is_admin: Boolean(record.isAdmin),
    created_at: record.createdAt || ''
  };
}

export async function getAclSummary(env) {
  if (getAuthSource(env) === 'kv') {
    const kv = getAuthKv(env);
    if (!kv) {
      return {
        enabled: false,
        source: 'kv',
        account_count: 0,
        token_count: 0,
        users: []
      };
    }
    const userMap = new Map();
    let tokenCount = 0;
    const keys = await listKvKeys(kv, {
      prefix: NPM_AUTH_TOKEN_PREFIX,
      pageLimit: 1000,
      maxPages: 50
    });
    for (const key of keys) {
      if (!key.startsWith(NPM_AUTH_TOKEN_PREFIX)) continue;
      const raw = await kv.get(key);
      if (!raw) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const record = normalizeManagedTokenRecord(
        parsed,
        key.slice(NPM_AUTH_TOKEN_PREFIX.length)
      );
      if (!record) continue;
      tokenCount += 1;
      const existing = userMap.get(record.username) || {
        username: record.username,
        read: new Set(),
        write: new Set()
      };
      for (const rule of record.read) existing.read.add(rule);
      for (const rule of record.write) existing.write.add(rule);
      userMap.set(record.username, existing);
    }

    return {
      enabled: true,
      source: 'kv',
      account_count: userMap.size,
      token_count: tokenCount,
      users: [...userMap.values()].map((item) => ({
        username: item.username,
        read: [...item.read],
        write: [...item.write]
      }))
    };
  }

  const accounts = resolveAccounts(env);
  return {
    enabled: accounts.length > 0,
    source: 'env',
    account_count: accounts.length,
    token_count: accounts.length,
    users: accounts.map((acc) => ({
      username: acc.username,
      read: acc.read,
      write: acc.write,
      is_admin: Boolean(acc.isAdmin)
    }))
  };
}

export async function authorizeToken(env, { token, scope = 'read', packageName = '' } = {}) {
  const provided = String(token || '').trim();
  if (!provided) {
    return { ok: false, reason: 'missing_token' };
  }
  const kvBound = hasAuthKvBinding(env);
  const envAccounts = resolveAccounts(env);
  const envEnabled = envAccounts.length > 0;
  if (!kvBound && !envEnabled) {
    return { ok: false, source: 'env', reason: 'missing_token_config' };
  }

  const attempts = [];
  if (kvBound) {
    attempts.push({
      source: 'kv',
      resolve: () => resolveKvAccount(env, provided)
    });
  }
  if (envEnabled) {
    attempts.push({
      source: 'env',
      resolve: () => resolveEnvAccountFromAccounts(provided, envAccounts)
    });
  }

  for (const attempt of attempts) {
    const resolved = await attempt.resolve();
    if (!resolved.ok) {
      if (resolved.reason && resolved.reason !== 'invalid_token') {
        return {
          ok: false,
          source: attempt.source,
          reason: resolved.reason
        };
      }
      continue;
    }
    if (!isAccountAuthorized(resolved.account, { scope, packageName })) {
      return {
        ok: false,
        source: attempt.source,
        reason: scope === 'write' ? 'write_not_allowed' : 'read_not_allowed',
        account: resolved.account
      };
    }
    return {
      ok: true,
      source: attempt.source,
      account: resolved.account
    };
  }

  return {
    ok: false,
    source: kvBound ? 'kv' : 'env',
    reason: 'invalid_token'
  };
}

export async function listManagedTokens(env, { username = '' } = {}) {
  const kv = getAuthKv(env);
  if (!kv) {
    return { ok: false, reason: 'missing_npm_auth_kv', items: [] };
  }
  const userFilter = String(username || '').trim();
  const out = [];
  const keys = await listKvKeys(kv, {
    prefix: NPM_AUTH_TOKEN_PREFIX,
    pageLimit: 1000,
    maxPages: 50
  });
  for (const key of keys) {
    if (!key.startsWith(NPM_AUTH_TOKEN_PREFIX)) continue;
    const raw = await kv.get(key);
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const tokenId = key.slice(NPM_AUTH_TOKEN_PREFIX.length);
    const record = normalizeManagedTokenRecord(parsed, tokenId);
    if (!record) continue;
    if (userFilter && record.username !== userFilter) continue;
    out.push(publicTokenItem(record));
  }
  out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return { ok: true, items: out };
}

export async function createManagedToken(env, {
  username,
  read,
  write,
  isAdmin = false
} = {}) {
  const kv = getAuthKv(env);
  if (!kv) {
    return { ok: false, reason: 'missing_npm_auth_kv' };
  }
  const name = String(username || '').trim();
  if (!name) return { ok: false, reason: 'missing_username' };

  const normalizedRead = normalizePatternList(read);
  const normalizedWrite = normalizePatternList(write);
  const effectiveWrite = isAdmin ? ['*'] : normalizedWrite;
  const effectiveRead = isAdmin
    ? ['*']
    : normalizedRead.length
      ? normalizedRead
      : effectiveWrite.length
        ? [...effectiveWrite]
        : ['*'];

  const tokenId = createTokenId();
  const secret = createTokenSecret();
  const tokenHash = await hashTokenSecret(env, secret);
  const createdAt = new Date().toISOString();
  const record = {
    token_id: tokenId,
    username: name,
    read: effectiveRead,
    write: effectiveWrite,
    is_admin: Boolean(isAdmin),
    token_hash: tokenHash,
    created_at: createdAt
  };
  await kv.put(getTokenKey(tokenId), JSON.stringify(record));
  return {
    ok: true,
    token: `${NPM_TOKEN_LITERAL_PREFIX}${tokenId}.${secret}`,
    item: publicTokenItem(
      normalizeManagedTokenRecord(record, tokenId)
    )
  };
}

export async function updateManagedToken(env, {
  tokenId,
  read,
  write,
  isAdmin
} = {}) {
  const kv = getAuthKv(env);
  if (!kv) {
    return { ok: false, reason: 'missing_npm_auth_kv' };
  }

  const id = String(tokenId || '').trim();
  if (!id) return { ok: false, reason: 'missing_token_id' };

  const key = getTokenKey(id);
  const raw = await kv.get(key);
  if (!raw) return { ok: false, reason: 'token_not_found' };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'token_not_found' };
  }
  const existing = normalizeManagedTokenRecord(parsed, id);
  if (!existing) return { ok: false, reason: 'token_not_found' };

  const nextIsAdmin =
    typeof isAdmin === 'boolean'
      ? isAdmin
      : Boolean(existing.isAdmin);

  const normalizedRead = normalizePatternList(
    read !== undefined ? read : existing.read
  );
  const normalizedWrite = normalizePatternList(
    write !== undefined ? write : existing.write
  );
  const effectiveWrite = nextIsAdmin ? ['*'] : normalizedWrite;
  const effectiveRead = nextIsAdmin
    ? ['*']
    : normalizedRead.length
      ? normalizedRead
      : effectiveWrite.length
        ? [...effectiveWrite]
        : ['*'];

  const record = {
    token_id: existing.tokenId,
    username: existing.username,
    read: effectiveRead,
    write: effectiveWrite,
    is_admin: nextIsAdmin,
    token_hash: existing.tokenHash,
    created_at: existing.createdAt || String(parsed?.created_at || '')
  };

  await kv.put(key, JSON.stringify(record));

  return {
    ok: true,
    item: publicTokenItem(
      normalizeManagedTokenRecord(record, id)
    )
  };
}

export async function reissueManagedToken(env, {
  tokenId,
  replaceOld = true
} = {}) {
  const kv = getAuthKv(env);
  if (!kv) {
    return { ok: false, reason: 'missing_npm_auth_kv' };
  }

  const id = String(tokenId || '').trim();
  if (!id) return { ok: false, reason: 'missing_token_id' };

  const key = getTokenKey(id);
  const raw = await kv.get(key);
  if (!raw) return { ok: false, reason: 'token_not_found' };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'token_not_found' };
  }
  const existing = normalizeManagedTokenRecord(parsed, id);
  if (!existing) return { ok: false, reason: 'token_not_found' };

  const created = await createManagedToken(env, {
    username: existing.username,
    read: existing.read,
    write: existing.write,
    isAdmin: existing.isAdmin
  });
  if (!created.ok) {
    return created;
  }

  const replaced = replaceOld === true;
  if (replaced) {
    await kv.delete(key);
  }

  return {
    ok: true,
    token: created.token,
    item: created.item,
    old_token_id: id,
    replaced
  };
}

export async function deleteManagedToken(env, {
  tokenId,
  username
} = {}) {
  const kv = getAuthKv(env);
  if (!kv) {
    return { ok: false, reason: 'missing_npm_auth_kv' };
  }
  const id = String(tokenId || '').trim();
  if (!id) return { ok: false, reason: 'missing_token_id' };
  const key = getTokenKey(id);
  const raw = await kv.get(key);
  if (!raw) return { ok: false, reason: 'token_not_found' };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'token_not_found' };
  }
  const record = normalizeManagedTokenRecord(parsed, id);
  if (!record) return { ok: false, reason: 'token_not_found' };

  const expectedUser = String(username || '').trim();
  if (expectedUser && record.username !== expectedUser) {
    return { ok: false, reason: 'token_not_found' };
  }

  await kv.delete(key);
  return { ok: true, deleted: true };
}
