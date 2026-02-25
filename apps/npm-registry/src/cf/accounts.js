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
  const effectiveRead = read.length ? read : write.length ? [...write] : ['*'];
  return {
    username,
    token,
    read: effectiveRead,
    write
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
  if (!pkgName) return true;
  if (!Array.isArray(patterns) || !patterns.length) return false;
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

export function getAclSummary(env) {
  const accounts = resolveAccounts(env);
  return {
    enabled: accounts.length > 0,
    account_count: accounts.length,
    users: accounts.map((acc) => ({
      username: acc.username,
      read: acc.read,
      write: acc.write
    }))
  };
}

export function authorizeToken(env, { token, scope = 'read', packageName = '' } = {}) {
  const accounts = resolveAccounts(env);
  if (!accounts.length) {
    return { ok: false, reason: 'missing_token_config' };
  }

  const provided = String(token || '').trim();
  if (!provided) {
    return { ok: false, reason: 'missing_token' };
  }

  const account = accounts.find((acc) => acc.token === provided);
  if (!account) {
    return { ok: false, reason: 'invalid_token' };
  }

  const pkg = String(packageName || '').trim();
  const writeAllowed = hasPatternPermission(account.write, pkg);
  const readAllowed = hasPatternPermission(account.read, pkg) || writeAllowed;
  if (scope === 'write' && !writeAllowed) {
    return { ok: false, reason: 'write_not_allowed', account };
  }
  if (scope !== 'write' && !readAllowed) {
    return { ok: false, reason: 'read_not_allowed', account };
  }
  return { ok: true, account };
}
