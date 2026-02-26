import {
  getAuthRecord,
  isRecordBanned,
  recordAuthEvent
} from '@edgeapps/core/stats';
import { getClientIp } from '@edgeapps/core/request';
import { isKvStore } from '@edgeapps/core/kv';
import {
  handlePluginRequest,
  handlePluginResponse
} from '@edgeapps/core/plugins';
import { serveCloudflareStaticAsset } from '@edgeapps/core/static-assets';
import {
  authorizeToken,
  getAclSummary
} from './accounts.js';
import { APP_NAME, PLATFORM_CF } from '../meta.js';

const STATUS_PATH = '/_/status';
const ADMIN_PATH = '/_/admin';
const LOGIN_PATH = '/login';
const ADMIN_API_WHOAMI = '/_/api/admin/whoami';
const ADMIN_API_PACKAGES = '/_/api/admin/packages';
const ADMIN_API_PACKAGE = '/_/api/admin/package';
const ADMIN_API_DIST_TAG = '/_/api/admin/dist-tag';
const ADMIN_API_DELETE_VERSION = '/_/api/admin/delete-version';
const PING_PATH = '/-/ping';
const WHOAMI_PATH = '/-/whoami';
const LEGACY_LOGIN_PREFIX = '/-/user/org.couchdb.user:';
const DIST_TAG_PREFIX = '/-/package/';
const TARBALL_PREFIX = '/-/tarballs/';
const AUDIT_PREFIX = '/-/npm/v1/security/';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store'
};
const ADMIN_SPA_HTML = __ADMIN_SPA_HTML__;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...headers
    }
  });
}

function badRequest(message) {
  return json({ error: 'bad_request', reason: message }, 400);
}

function forbidden(message = 'forbidden') {
  return json({ error: 'forbidden', reason: message }, 403);
}

function unauthorized(reason = 'unauthorized', {
  challenge = 'bearer'
} = {}) {
  const authHeader =
    challenge === 'basic'
      ? 'Basic realm="npm-registry-admin", charset="UTF-8"'
      : 'Bearer realm="npm-registry"';
  return json(
    { error: 'unauthorized', reason },
    401,
    { 'www-authenticate': authHeader }
  );
}

function notFound() {
  return json({ error: 'not_found' }, 404);
}

function internalError(message) {
  return json({ error: 'internal_error', reason: message }, 500);
}

function conflict(reason = 'conflict') {
  return json({ error: 'conflict', reason }, 409);
}

function decodeBase64(input) {
  const value = String(input || '');
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes) {
  let out = '';
  for (const n of bytes) out += String.fromCharCode(n);
  return btoa(out);
}

function isDisabledEnv(value) {
  return /^(0|false|no|off)$/i.test(String(value || '').trim());
}

async function sha1Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return toHex(new Uint8Array(digest));
}

async function sha512Base64(bytes) {
  const digest = await crypto.subtle.digest('SHA-512', bytes);
  return toBase64(new Uint8Array(digest));
}

function parseAuthCredentials(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    return {
      type: 'bearer',
      username: '',
      token: auth.slice(7).trim()
    };
  }
  if (!auth.startsWith('Basic ')) {
    return {
      type: 'none',
      username: '',
      token: ''
    };
  }
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    if (idx < 0) {
      return {
        type: 'basic',
        username: '',
        token: ''
      };
    }
    return {
      type: 'basic',
      username: decoded.slice(0, idx).trim(),
      token: decoded.slice(idx + 1).trim()
    };
  } catch {
    return {
      type: 'basic',
      username: '',
      token: ''
    };
  }
}

function extractBearerOrBasicToken(request) {
  return parseAuthCredentials(request).token;
}

function isR2BucketLike(value) {
  return (
    value &&
    typeof value.get === 'function' &&
    typeof value.put === 'function'
  );
}

function hasR2List(value) {
  return value && typeof value.list === 'function';
}

function hasR2Delete(value) {
  return value && typeof value.delete === 'function';
}

function getBucket(env) {
  const bindingName = 'NPM_BUCKET';
  const bucket = env?.NPM_BUCKET;
  return { bindingName, bucket };
}

function getUpstreamRegistry(env) {
  const value = String(env?.NPM_UPSTREAM_REGISTRY || 'https://registry.npmjs.org').trim();
  if (!value) return 'https://registry.npmjs.org';
  return value.replace(/\/+$/, '');
}

function resolveUpstreamBaseUrl(env) {
  const fallback = 'https://registry.npmjs.org';
  const raw = getUpstreamRegistry(env);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return new URL(fallback);
    }
    return url;
  } catch {
    return new URL(fallback);
  }
}

function normalizePackageName(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  const decoded = decodeURIComponent(value);
  return decoded.replace(/^\/+|\/+$/g, '');
}

function parsePackageNameFromPath(pathname) {
  const trimmed = String(pathname || '').replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed.startsWith('-/') || trimmed.startsWith('_/')) {
    return '';
  }
  if (trimmed.includes('/-/')) {
    return '';
  }
  if (trimmed.includes('/-rev/')) {
    return '';
  }
  if (trimmed.startsWith('@')) {
    const parts = trimmed.split('/');
    if (parts.length >= 2) {
      return normalizePackageName(`${parts[0]}/${parts[1]}`);
    }
  }
  return normalizePackageName(trimmed);
}

function metaKey(pkgName) {
  return `meta/${encodeURIComponent(pkgName)}.json`;
}

function tarballKey(pkgName, version) {
  return `tarballs/${encodeURIComponent(pkgName)}/${encodeURIComponent(version)}.tgz`;
}

function tarballPath(pkgName, version) {
  return `/-/tarballs/${encodeURIComponent(pkgName)}/${encodeURIComponent(version)}.tgz`;
}

async function readMeta(bucket, pkgName) {
  const object = await bucket.get(metaKey(pkgName));
  if (!object) return null;
  try {
    return JSON.parse(await object.text());
  } catch {
    return null;
  }
}

async function fetchUpstreamMetadata(request, env, pkgName) {
  const baseUrl = resolveUpstreamBaseUrl(env);
  const upstreamUrl = new URL(`${baseUrl.pathname.replace(/\/$/, '')}/${encodeURIComponent(pkgName)}`, baseUrl);
  const accept = request.headers.get('accept') || 'application/json';
  const res = await fetch(upstreamUrl.toString(), {
    method: 'GET',
    headers: {
      accept,
      'user-agent': 'edgeapps-npm-registry/1.0'
    }
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`upstream_metadata_${res.status}`);
  }
  return res.json();
}

function resolveUpstreamPathUrl(env, pathname, search = '') {
  const base = resolveUpstreamBaseUrl(env);
  const safePath = String(pathname || '').startsWith('/')
    ? String(pathname || '')
    : `/${String(pathname || '')}`;
  const prefix = base.pathname.replace(/\/$/, '');
  const upstreamUrl = new URL(`${prefix}${safePath}`, base.origin);
  upstreamUrl.search = search || '';
  return upstreamUrl;
}

async function handleAuditProxy(request, env) {
  if (request.method !== 'POST' && request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: '-/npm/v1/security'
  });
  if (!auth.ok) return auth.response;

  const reqUrl = new URL(request.url);
  const upstreamUrl = resolveUpstreamPathUrl(env, reqUrl.pathname, reqUrl.search);
  const upstreamRes = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers: {
      accept: request.headers.get('accept') || 'application/json',
      'content-type': request.headers.get('content-type') || 'application/json',
      'user-agent': request.headers.get('user-agent') || 'edgeapps-npm-registry/1.0'
    },
    body: request.method === 'POST' ? request.body : undefined
  });

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: {
      'content-type': upstreamRes.headers.get('content-type') || 'application/json; charset=UTF-8',
      'cache-control': 'no-store'
    }
  });
}

function createRevision() {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now}-${rand}`;
}

async function writeMeta(bucket, pkgName, doc) {
  doc._id = pkgName;
  doc.name = pkgName;
  doc._rev = createRevision();
  await bucket.put(metaKey(pkgName), JSON.stringify(doc), {
    httpMetadata: {
      contentType: 'application/json; charset=UTF-8'
    }
  });
}

function buildMetadataResponse(meta, origin) {
  const out = {
    _id: meta.name,
    _rev: String(meta._rev || createRevision()),
    name: meta.name,
    'dist-tags': meta['dist-tags'] || {},
    versions: {},
    time: meta.time || {}
  };
  for (const [version, manifest] of Object.entries(meta.versions || {})) {
    const cloned = JSON.parse(JSON.stringify(manifest));
    cloned.dist = cloned.dist || {};
    cloned.dist.tarball = `${origin}${tarballPath(meta.name, version)}`;
    out.versions[version] = cloned;
  }
  return out;
}

function parseDistTagRoute(pathname) {
  const raw = String(pathname || '');
  if (!raw.startsWith(DIST_TAG_PREFIX)) return null;
  const rest = raw.slice(DIST_TAG_PREFIX.length);
  const marker = '/dist-tags';
  const idx = rest.indexOf(marker);
  if (idx <= 0) return null;
  const pkgEncoded = rest.slice(0, idx);
  const suffix = rest.slice(idx + marker.length);
  if (!pkgEncoded) return null;
  if (!suffix || suffix === '/') {
    return {
      pkgName: normalizePackageName(pkgEncoded),
      tag: ''
    };
  }
  if (!suffix.startsWith('/')) return null;
  const tagRaw = suffix.slice(1);
  if (!tagRaw) return null;
  return {
    pkgName: normalizePackageName(pkgEncoded),
    tag: decodeURIComponent(tagRaw)
  };
}

function parseTarballRoute(pathname) {
  const raw = String(pathname || '');
  if (!raw.startsWith(TARBALL_PREFIX)) return null;
  const rest = raw.slice(TARBALL_PREFIX.length);
  const parts = rest.split('/');
  if (parts.length !== 2) return null;
  const pkgEncoded = parts[0];
  const file = parts[1];
  if (!file.endsWith('.tgz')) return null;
  const version = decodeURIComponent(file.slice(0, -4));
  return {
    pkgName: normalizePackageName(pkgEncoded),
    version
  };
}

function parseCanonicalTarballRoute(pathname) {
  const raw = String(pathname || '');
  let matched = raw.match(/^\/(@[^/]+\/[^/]+)\/-\/([^/]+\.tgz)$/);
  if (!matched) {
    matched = raw.match(/^\/([^/@][^/]*)\/-\/([^/]+\.tgz)$/);
  }
  if (!matched) return null;

  const pkgName = normalizePackageName(matched[1] || '');
  const fileName = decodeURIComponent(matched[2] || '');
  if (!pkgName || !fileName.endsWith('.tgz')) return null;

  const baseName = pkgName.includes('/') ? pkgName.split('/').pop() : pkgName;
  const expectedPrefix = `${baseName}-`;
  const version = fileName.startsWith(expectedPrefix)
    ? fileName.slice(expectedPrefix.length, -4)
    : fileName.slice(0, -4);

  if (!version) return null;
  return {
    pkgName,
    version,
    upstreamPath: raw
  };
}

function parsePackageRevisionRoute(pathname) {
  const raw = String(pathname || '');
  if (raw.startsWith(`${TARBALL_PREFIX}`)) return null;
  const marker = '/-rev/';
  const idx = raw.lastIndexOf(marker);
  if (idx <= 1) return null;
  const pkgRaw = raw.slice(1, idx);
  const revRaw = raw.slice(idx + marker.length);
  if (!revRaw) return null;
  if (!pkgRaw || pkgRaw.startsWith('-/')) return null;
  if (pkgRaw.includes('/-/')) return null;
  const pkgName = normalizePackageName(pkgRaw);
  if (!pkgName) return null;
  if (pkgName.startsWith('@')) {
    const scopedParts = pkgName.split('/');
    if (scopedParts.length !== 2 || !scopedParts[0] || !scopedParts[1]) {
      return null;
    }
  } else if (pkgName.includes('/')) {
    return null;
  }
  return {
    pkgName,
    rev: decodeURIComponent(revRaw)
  };
}

function parseTarballRevisionRoute(pathname) {
  const raw = String(pathname || '');

  // /-/tarballs/<encoded-package>/<version>.tgz/-rev/<rev>
  if (raw.startsWith(`${TARBALL_PREFIX}`)) {
    const marker = '/-rev/';
    const idx = raw.indexOf(marker);
    if (idx > 0) {
      const tarballPathOnly = raw.slice(0, idx);
      const rev = decodeURIComponent(raw.slice(idx + marker.length));
      const parsed = parseTarballRoute(tarballPathOnly);
      if (parsed) {
        return {
          ...parsed,
          rev
        };
      }
    }
  }

  // /<package>/-/<file>.tgz/-rev/<rev>
  let matched = raw.match(/^\/(@[^/]+\/[^/]+)\/-\/([^/]+\.tgz)\/-rev\/([^/]+)$/);
  if (!matched) {
    matched = raw.match(/^\/([^/@][^/]*)\/-\/([^/]+\.tgz)\/-rev\/([^/]+)$/);
  }
  if (!matched) return null;
  const parsedCanonical = parseCanonicalTarballRoute(
    `/${matched[1]}/-/${matched[2]}`
  );
  if (!parsedCanonical) return null;
  return {
    pkgName: parsedCanonical.pkgName,
    version: parsedCanonical.version,
    rev: decodeURIComponent(matched[3] || '')
  };
}

function pickAttachmentKey(version, manifest, attachments) {
  const keys = Object.keys(attachments || {});
  if (!keys.length) return '';
  const fromDist = manifest?.dist?.tarball
    ? decodeURIComponent(String(manifest.dist.tarball).split('/').pop() || '')
    : '';
  if (fromDist && attachments[fromDist]) return fromDist;
  const byVersion = keys.find((name) => name.includes(version));
  return byVersion || keys[0];
}

async function parseJsonBody(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') return null;
    return body;
  } catch {
    return null;
  }
}

function compareVersionDesc(a, b) {
  return String(b).localeCompare(String(a), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function pickNewestVersion(versions) {
  const list = Object.keys(versions || {});
  if (!list.length) return '';
  list.sort(compareVersionDesc);
  return list[0];
}

async function applyDistTag(bucket, pkgName, tag, version) {
  const meta = await readMeta(bucket, pkgName);
  if (!meta) return { ok: false, response: notFound() };
  if (!meta.versions?.[version]) {
    return { ok: false, response: badRequest(`unknown_version_${version}`) };
  }

  if (!meta['dist-tags']) meta['dist-tags'] = {};
  meta['dist-tags'][tag] = version;
  if (!meta.time) meta.time = {};
  meta.time.modified = new Date().toISOString();
  await writeMeta(bucket, pkgName, meta);
  return {
    ok: true,
    tags: meta['dist-tags']
  };
}

function summarizeMeta(pkgName, meta) {
  return {
    name: pkgName,
    latest: meta?.['dist-tags']?.latest || '',
    version_count: Object.keys(meta?.versions || {}).length,
    modified: meta?.time?.modified || meta?.time?.created || ''
  };
}

function packageNameFromMetaKey(key) {
  const value = String(key || '');
  if (!value.startsWith('meta/') || !value.endsWith('.json')) return '';
  const encoded = value.slice(5, -5);
  if (!encoded) return '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

async function authenticateRequest(request, env, {
  scope = 'read',
  path = '',
  packageName = '',
  tokenOverride,
  challenge = 'bearer'
} = {}) {
  const acl = getAclSummary(env);
  if (!acl.enabled) {
    return {
      ok: false,
      response: internalError('Missing env NPM_ACCOUNTS_JSON')
    };
  }
  if (!isKvStore(env?.AUTH_KV)) {
    return {
      ok: false,
      response: internalError('Missing env AUTH_KV')
    };
  }

  const ip = getClientIp(request);
  const rec = await getAuthRecord(env, ip);
  if (isRecordBanned(rec)) {
    return { ok: false, response: forbidden('ip_banned') };
  }

  const creds =
    tokenOverride !== undefined
      ? {
          type: 'override',
          username: '',
          token: String(tokenOverride || '').trim()
        }
      : parseAuthCredentials(request);
  const token = creds.token;
  const authz = authorizeToken(env, { token, scope, packageName });
  if (!authz.ok) {
    if (token && authz.reason !== 'missing_token') {
      const updated = await recordAuthEvent(env, {
        ip,
        kind: 'fail',
        path,
        auth: 'token'
      });
      if (isRecordBanned(updated)) {
        return { ok: false, response: forbidden('ip_banned') };
      }
    }
    return {
      ok: false,
      response: unauthorized('unauthorized', { challenge })
    };
  }

  if (
    creds.type === 'basic' &&
    creds.username &&
    authz.account?.username &&
    creds.username !== authz.account.username
  ) {
    const updated = await recordAuthEvent(env, {
      ip,
      kind: 'fail',
      path,
      auth: 'token'
    });
    if (isRecordBanned(updated)) {
      return { ok: false, response: forbidden('ip_banned') };
    }
    return {
      ok: false,
      response: unauthorized('username_token_mismatch', { challenge })
    };
  }

  await recordAuthEvent(env, {
    ip,
    kind: 'ok',
    path,
    auth: 'token'
  });
  return {
    ok: true,
    account: authz.account || null,
    token
  };
}

function parseLegacyLoginUsername(pathname) {
  const raw = String(pathname || '');
  if (!raw.startsWith(LEGACY_LOGIN_PREFIX)) return '';
  const usernameRaw = raw.slice(LEGACY_LOGIN_PREFIX.length);
  if (!usernameRaw) return '';
  try {
    return decodeURIComponent(usernameRaw);
  } catch {
    return usernameRaw;
  }
}

async function handleLegacyLogin(request, env, username) {
  if (request.method !== 'PUT') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const body = await parseJsonBody(request);
  const passwordToken = String(body?.password || body?.token || '').trim();
  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: `-/user/org.couchdb.user:${username}`,
    tokenOverride: passwordToken
  });
  if (!auth.ok) return auth.response;

  // Keep npm login behavior intuitive: entered username should match account username.
  if (username && auth?.account?.username && username !== auth.account.username) {
    return unauthorized('username_token_mismatch');
  }

  return json(
    {
      ok: true,
      id: `org.couchdb.user:${auth?.account?.username || username || 'user'}`,
      name: auth?.account?.username || username || 'user',
      token: auth.token
    },
    201
  );
}

async function handleStatus(request, env) {
  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: '_/status'
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  const ip = getClientIp(request);
  const rec = await getAuthRecord(env, ip);
  const acl = getAclSummary(env);
  return json({
    ok: true,
    app: APP_NAME,
    bucket_binding: bindingName,
    bucket_ready: isR2BucketLike(bucket),
    auth_kv: isKvStore(env?.AUTH_KV),
    ip,
    banned: isRecordBanned(rec),
    fail: rec?.fail || null,
    acl,
    upstream: {
      registry: resolveUpstreamBaseUrl(env).toString().replace(/\/$/, '')
    }
  });
}

async function handleWhoAmI(request, env) {
  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: '-/whoami'
  });
  if (!auth.ok) return auth.response;
  return json({ username: String(auth?.account?.username || 'npm-user') });
}

async function handleAdminWhoAmI(request, env) {
  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: '_/api/admin/whoami',
    challenge: 'basic'
  });
  if (!auth.ok) return auth.response;
  return json({ username: String(auth?.account?.username || 'npm-user') });
}

async function handlePing(request, env) {
  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: '-/ping'
  });
  if (!auth.ok) return auth.response;
  return json({
    ok: true,
    app: APP_NAME
  });
}

async function handleGetMetadata(request, env, pkgName) {
  const urlObj = new URL(request.url);
  const writeQuery = /^(1|true|yes)$/i.test(String(urlObj.searchParams.get('write') || ''));
  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: pkgName,
    packageName: pkgName
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }
  const meta = await readMeta(bucket, pkgName);
  if (meta) {
    const origin = new URL(request.url).origin;
    return json(buildMetadataResponse(meta, origin), 200, {
      'x-npm-registry-source': 'local'
    });
  }
  if (writeQuery) {
    // npm unpublish requests write-mode metadata and expects only local packuments.
    return notFound();
  }

  try {
    const upstream = await fetchUpstreamMetadata(request, env, pkgName);
    if (!upstream) return notFound();
    return json(upstream, 200, {
      'x-npm-registry-source': 'upstream'
    });
  } catch (err) {
    console.error('upstream metadata fetch error', err);
    return internalError('upstream_metadata_fetch_failed');
  }
}

async function fetchUpstreamTarballByPath(request, env, upstreamPath) {
  const reqUrl = new URL(request.url);
  const upstreamBase = resolveUpstreamBaseUrl(env);
  const upstreamUrl = new URL(upstreamPath, upstreamBase.origin);
  upstreamUrl.search = reqUrl.search;
  const method = request.method === 'HEAD' ? 'HEAD' : 'GET';

  const upstreamRes = await fetch(upstreamUrl.toString(), {
    method,
    headers: {
      accept: request.headers.get('accept') || '*/*',
      'user-agent': 'edgeapps-npm-registry/1.0'
    }
  });
  if (upstreamRes.status === 404) return notFound();
  if (!upstreamRes.ok) {
    console.error('upstream tarball fetch error', upstreamRes.status, upstreamUrl.toString());
    return internalError(`upstream_tarball_${upstreamRes.status}`);
  }

  return new Response(method === 'HEAD' ? null : upstreamRes.body, {
    status: 200,
    headers: {
      'content-type': upstreamRes.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'private, max-age=300',
      etag: upstreamRes.headers.get('etag') || ''
    }
  });
}

async function handleGetTarball(request, env, pkgName, version, options = {}) {
  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: `${pkgName}@${version}`,
    packageName: pkgName
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }
  const object = await bucket.get(tarballKey(pkgName, version));
  if (!object) {
    if (options.upstreamPath) {
      return fetchUpstreamTarballByPath(request, env, options.upstreamPath);
    }
    return notFound();
  }
  return new Response(request.method === 'HEAD' ? null : object.body, {
    status: 200,
    headers: {
      'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'private, max-age=60',
      etag: object.httpEtag || ''
    }
  });
}

async function deleteTarballsByPrefix(bucket, prefix) {
  if (!hasR2List(bucket) || !hasR2Delete(bucket)) {
    return;
  }
  let cursor = '';
  for (let page = 0; page < 200; page += 1) {
    const listed = await bucket.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {})
    });
    const objects = Array.isArray(listed?.objects) ? listed.objects : [];
    for (const item of objects) {
      const key = String(item?.key || item?.name || '');
      if (!key) continue;
      await bucket.delete(key);
    }
    if (!listed?.truncated) break;
    const next = String(listed?.cursor || '');
    if (!next || next === cursor) break;
    cursor = next;
  }
}

async function handlePackageRevisionWrite(request, env, pkgName, expectedRev) {
  const auth = await authenticateRequest(request, env, {
    scope: 'write',
    path: `${pkgName}:-rev`,
    packageName: pkgName
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }
  const currentMeta = await readMeta(bucket, pkgName);
  if (!currentMeta) return notFound();
  if (String(currentMeta._rev || '') !== String(expectedRev || '')) {
    return conflict('rev_mismatch');
  }

  const body = await parseJsonBody(request);
  if (!body || typeof body !== 'object') {
    return badRequest('invalid_json');
  }
  const payloadName = normalizePackageName(body.name || body._id || pkgName);
  if (payloadName && payloadName !== pkgName) {
    return badRequest('package_name_mismatch');
  }

  const nextMeta = {
    _id: pkgName,
    name: pkgName,
    'dist-tags': body['dist-tags'] && typeof body['dist-tags'] === 'object'
      ? body['dist-tags']
      : {},
    versions: body.versions && typeof body.versions === 'object'
      ? body.versions
      : {},
    time: body.time && typeof body.time === 'object'
      ? body.time
      : {}
  };
  nextMeta.time.modified = new Date().toISOString();

  const currentVersions = Object.keys(currentMeta?.versions || {});
  const nextVersions = new Set(Object.keys(nextMeta.versions || {}));
  const removedVersions = currentVersions.filter((version) => !nextVersions.has(version));
  if (removedVersions.length && !hasR2Delete(bucket)) {
    return internalError(`R2 binding ${bindingName} does not support delete()`);
  }

  await writeMeta(bucket, pkgName, nextMeta);
  for (const version of removedVersions) {
    await bucket.delete(tarballKey(pkgName, version));
  }
  return json({
    ok: true,
    name: pkgName,
    rev: nextMeta._rev,
    removed_tarballs: removedVersions.length
  });
}

async function handlePackageRevisionDelete(request, env, pkgName, expectedRev) {
  const auth = await authenticateRequest(request, env, {
    scope: 'write',
    path: `${pkgName}:-rev-delete`,
    packageName: pkgName
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }
  if (!hasR2Delete(bucket)) {
    return internalError(`R2 binding ${bindingName} does not support delete()`);
  }

  const meta = await readMeta(bucket, pkgName);
  if (!meta) return notFound();
  if (String(meta._rev || '') !== String(expectedRev || '')) {
    return conflict('rev_mismatch');
  }

  await bucket.delete(metaKey(pkgName));
  await deleteTarballsByPrefix(bucket, `tarballs/${encodeURIComponent(pkgName)}/`);
  return json({ ok: true, name: pkgName, package_deleted: true });
}

async function handleTarballRevisionDelete(request, env, pkgName, version) {
  const auth = await authenticateRequest(request, env, {
    scope: 'write',
    path: `${pkgName}@${version}:-rev-delete`,
    packageName: pkgName
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }
  if (!hasR2Delete(bucket)) {
    return internalError(`R2 binding ${bindingName} does not support delete()`);
  }

  await bucket.delete(tarballKey(pkgName, version));
  return json({ ok: true, name: pkgName, removed_version: version });
}

async function handlePublish(request, env, pkgName) {
  const auth = await authenticateRequest(request, env, {
    scope: 'write',
    path: pkgName,
    packageName: pkgName
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }
  const allowRepublish = !isDisabledEnv(env?.NPM_ALLOW_REPUBLISH);

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  if (!body || typeof body !== 'object') {
    return badRequest('invalid_payload');
  }

  const payloadName = normalizePackageName(body.name || body._id || '');
  if (payloadName && payloadName !== pkgName) {
    return badRequest('package_name_mismatch');
  }

  const versions = body.versions && typeof body.versions === 'object'
    ? body.versions
    : null;
  if (!versions || Object.keys(versions).length === 0) {
    return badRequest('missing_versions');
  }
  const attachments = body._attachments && typeof body._attachments === 'object'
    ? body._attachments
    : {};

  const nowIso = new Date().toISOString();
  const meta = (await readMeta(bucket, pkgName)) || {
    _id: pkgName,
    name: pkgName,
    'dist-tags': {},
    versions: {},
    time: {
      created: nowIso,
      modified: nowIso
    }
  };

  const nextMeta = JSON.parse(JSON.stringify(meta));
  let publishedCount = 0;
  let overwrittenCount = 0;

  for (const [version, manifestRaw] of Object.entries(versions)) {
    const versionExists = Boolean(nextMeta.versions?.[version]);
    if (versionExists && !allowRepublish) {
      return json(
        {
          error: 'version_exists',
          reason: `Version ${version} already exists`
        },
        409
      );
    }
    const manifest = JSON.parse(JSON.stringify(manifestRaw || {}));
    const attachKey = pickAttachmentKey(version, manifest, attachments);
    const attach = attachments[attachKey];
    if (!attach?.data) {
      return badRequest(`missing_attachment_for_${version}`);
    }

    let bytes;
    try {
      bytes = decodeBase64(attach.data);
    } catch {
      return badRequest(`invalid_attachment_base64_${version}`);
    }

    await bucket.put(tarballKey(pkgName, version), bytes, {
      httpMetadata: {
        contentType: attach.content_type || 'application/octet-stream'
      },
      customMetadata: {
        package: pkgName,
        version
      }
    });

    const shasum = await sha1Hex(bytes);
    const integrity = `sha512-${await sha512Base64(bytes)}`;
    manifest.name = pkgName;
    manifest.version = version;
    manifest.dist = {
      ...(manifest.dist || {}),
      shasum,
      integrity,
      tarball: tarballPath(pkgName, version)
    };

    if (!nextMeta.versions) nextMeta.versions = {};
    nextMeta.versions[version] = manifest;
    if (!nextMeta.time) nextMeta.time = {};
    nextMeta.time[version] = nowIso;
    if (versionExists) overwrittenCount += 1;
    else publishedCount += 1;
  }

  const distTags = body['dist-tags'] && typeof body['dist-tags'] === 'object'
    ? body['dist-tags']
    : {};
  const hasIncomingDistTags = Object.keys(distTags).length > 0;
  nextMeta['dist-tags'] = {
    ...(nextMeta['dist-tags'] || {}),
    ...distTags
  };
  if (!nextMeta['dist-tags'].latest) {
    // npm-compatible fallback:
    // only infer latest from this publish payload when payload has no dist-tags.
    // avoid overriding workflows like `npm publish --tag beta`.
    if (!hasIncomingDistTags) {
      const latestVersion = pickNewestVersion(versions || {});
      if (latestVersion) nextMeta['dist-tags'].latest = latestVersion;
    }
  }
  nextMeta.time.modified = nowIso;

  await writeMeta(bucket, pkgName, nextMeta);
  return json({
    ok: true,
    id: pkgName,
    published: publishedCount,
    overwritten: overwrittenCount,
    'dist-tags': nextMeta['dist-tags']
  }, 201);
}

async function handleDistTagUpdate(request, env, pkgName, tag) {
  const auth = await authenticateRequest(request, env, {
    scope: 'write',
    path: `${pkgName}:dist-tag:${tag}`,
    packageName: pkgName
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }

  const raw = await request.text();
  let version = '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') version = parsed.trim();
    else if (parsed && typeof parsed.version === 'string') version = parsed.version.trim();
  } catch {
    version = raw.trim().replace(/^"+|"+$/g, '');
  }

  if (!version) return badRequest('missing_version');
  const result = await applyDistTag(bucket, pkgName, tag, version);
  if (!result.ok) return result.response;
  return json(result.tags);
}

async function handleDistTagList(request, env, pkgName) {
  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: `${pkgName}:dist-tags`,
    packageName: pkgName
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }

  const meta = await readMeta(bucket, pkgName);
  if (!meta) {
    return notFound();
  }
  return json(meta['dist-tags'] || {});
}

async function handleDistTagDelete(request, env, pkgName, tag) {
  const auth = await authenticateRequest(request, env, {
    scope: 'write',
    path: `${pkgName}:dist-tag:${tag}`,
    packageName: pkgName
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }

  const meta = await readMeta(bucket, pkgName);
  if (!meta) return notFound();
  if (!meta['dist-tags'] || !(tag in meta['dist-tags'])) {
    return notFound();
  }

  delete meta['dist-tags'][tag];
  if (!meta['dist-tags'].latest) {
    const fallback = pickNewestVersion(meta.versions);
    if (fallback) meta['dist-tags'].latest = fallback;
  }
  if (!meta.time) meta.time = {};
  meta.time.modified = new Date().toISOString();

  await writeMeta(bucket, pkgName, meta);
  return json(meta['dist-tags']);
}

async function handleAdminListPackages(request, env) {
  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: '_/api/admin/packages',
    challenge: 'basic'
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }
  if (!hasR2List(bucket)) {
    return internalError(`R2 binding ${bindingName} does not support list()`);
  }

  const urlObj = new URL(request.url);
  const limitRaw = Number(urlObj.searchParams.get('limit') || '100');
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 100));
  const withTotal = /^(1|true|yes)$/i.test(
    String(urlObj.searchParams.get('with_total') || '').trim()
  );
  const keyword = String(urlObj.searchParams.get('q') || '').trim().toLowerCase();
  const cursor = urlObj.searchParams.get('cursor') || undefined;
  const listed = await bucket.list({
    prefix: 'meta/',
    limit,
    ...(cursor ? { cursor } : {})
  });
  const objects = Array.isArray(listed?.objects) ? listed.objects : [];
  const token = extractBearerOrBasicToken(request);
  const names = objects
    .map((item) => packageNameFromMetaKey(item?.key || item?.name))
    .filter(Boolean)
    .filter((name) => !keyword || name.toLowerCase().includes(keyword))
    .filter((name) =>
      authorizeToken(env, {
        token,
        scope: 'read',
        packageName: name
      }).ok
    );

  const items = (
    await Promise.all(
      names.map(async (name) => {
        const meta = await readMeta(bucket, name);
        if (!meta) return null;
        return summarizeMeta(name, meta);
      })
    )
  )
    .filter(Boolean)
    .sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')));

  return json({
    ok: true,
    returned_count: items.length,
    items,
    next_cursor: listed?.truncated ? listed?.cursor || '' : '',
    ...(withTotal
      ? await (async () => {
          let totalVisible = 0;
          let cursorValue = '';
          let pages = 0;
          let totalExact = true;
          const maxPages = 100;
          while (true) {
            const batch = await bucket.list({
              prefix: 'meta/',
              limit: 1000,
              ...(cursorValue ? { cursor: cursorValue } : {})
            });
            const batchObjects = Array.isArray(batch?.objects) ? batch.objects : [];
            for (const item of batchObjects) {
              const name = packageNameFromMetaKey(item?.key || item?.name);
              if (!name) continue;
              if (keyword && !name.toLowerCase().includes(keyword)) {
                continue;
              }
              if (
                authorizeToken(env, {
                  token,
                  scope: 'read',
                  packageName: name
                }).ok
              ) {
                totalVisible += 1;
              }
            }
            pages += 1;
            if (!batch?.truncated) break;
            cursorValue = String(batch?.cursor || '');
            if (!cursorValue || pages >= maxPages) {
              totalExact = false;
              break;
            }
          }
          return {
            total_visible: totalVisible,
            total_exact: totalExact
          };
        })()
      : {})
  });
}

function buildAdminPackageDetail(pkgName, meta, origin) {
  const versions = Object.entries(meta?.versions || {})
    .map(([version, manifest]) => ({
      version,
      shasum: manifest?.dist?.shasum || '',
      integrity: manifest?.dist?.integrity || '',
      tarball: `${origin}${tarballPath(pkgName, version)}`,
      time: meta?.time?.[version] || ''
    }))
    .sort((a, b) => compareVersionDesc(a.version, b.version));
  return {
    name: pkgName,
    distTags: meta?.['dist-tags'] || {},
    versions,
    time: meta?.time || {}
  };
}

async function handleAdminGetPackage(request, env) {
  const urlObj = new URL(request.url);
  const pkgName = normalizePackageName(urlObj.searchParams.get('name') || '');
  if (!pkgName) return badRequest('missing_package_name');

  const auth = await authenticateRequest(request, env, {
    scope: 'read',
    path: `_/api/admin/package:${pkgName}`,
    packageName: pkgName,
    challenge: 'basic'
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }
  const meta = await readMeta(bucket, pkgName);
  if (!meta) return notFound();
  return json(buildAdminPackageDetail(pkgName, meta, urlObj.origin));
}

async function handleAdminSetDistTag(request, env) {
  const body = await parseJsonBody(request);
  if (!body) return badRequest('invalid_json');
  const pkgName = normalizePackageName(body.name || '');
  const tag = String(body.tag || '').trim();
  const version = String(body.version || '').trim();
  if (!pkgName || !tag || !version) {
    return badRequest('name/tag/version_required');
  }

  const auth = await authenticateRequest(request, env, {
    scope: 'write',
    path: `_/api/admin/dist-tag:${pkgName}:${tag}`,
    packageName: pkgName,
    challenge: 'basic'
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }
  const result = await applyDistTag(bucket, pkgName, tag, version);
  if (!result.ok) return result.response;
  return json({
    ok: true,
    name: pkgName,
    tags: result.tags
  });
}

async function handleAdminDeleteVersion(request, env) {
  const body = await parseJsonBody(request);
  if (!body) return badRequest('invalid_json');
  const pkgName = normalizePackageName(body.name || '');
  const version = String(body.version || '').trim();
  if (!pkgName || !version) {
    return badRequest('name/version_required');
  }

  const auth = await authenticateRequest(request, env, {
    scope: 'write',
    path: `_/api/admin/delete-version:${pkgName}@${version}`,
    packageName: pkgName,
    challenge: 'basic'
  });
  if (!auth.ok) return auth.response;

  const { bindingName, bucket } = getBucket(env);
  if (!isR2BucketLike(bucket)) {
    return internalError(`Missing R2 binding ${bindingName}`);
  }
  if (!hasR2Delete(bucket)) {
    return internalError(`R2 binding ${bindingName} does not support delete()`);
  }

  const meta = await readMeta(bucket, pkgName);
  if (!meta) return notFound();
  if (!meta.versions?.[version]) {
    return badRequest(`unknown_version_${version}`);
  }

  await bucket.delete(tarballKey(pkgName, version));
  delete meta.versions[version];
  if (meta.time && typeof meta.time === 'object') {
    delete meta.time[version];
  }
  if (!meta['dist-tags']) meta['dist-tags'] = {};
  for (const [tag, mappedVersion] of Object.entries(meta['dist-tags'])) {
    if (mappedVersion === version) {
      delete meta['dist-tags'][tag];
    }
  }
  const remaining = Object.keys(meta.versions || {});
  if (!remaining.length) {
    await bucket.delete(metaKey(pkgName));
    return json({
      ok: true,
      name: pkgName,
      removed_version: version,
      package_deleted: true
    });
  }
  if (!meta['dist-tags'].latest) {
    meta['dist-tags'].latest = pickNewestVersion(meta.versions);
  }
  if (!meta.time) meta.time = {};
  meta.time.modified = new Date().toISOString();
  await writeMeta(bucket, pkgName, meta);
  return json({
    ok: true,
    name: pkgName,
    removed_version: version,
    package_deleted: false,
    distTags: meta['dist-tags']
  });
}

function landing() {
  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NPM Registry</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0f172a;
        color: #e2e8f0;
      }
      main {
        max-width: 720px;
        padding: 24px;
        line-height: 1.6;
      }
      code {
        background: rgba(255, 255, 255, 0.12);
        padding: 2px 6px;
        border-radius: 4px;
      }
      .login {
        display: inline-block;
        margin-top: 10px;
        color: #e2e8f0;
        background: #1f3b82;
        border: 1px solid #3857a8;
        text-decoration: none;
        padding: 8px 14px;
        border-radius: 8px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Private npm registry</h1>
      <p>Cloudflare Pages + R2 storage.</p>
      <p>Status endpoint: <code>/_/status</code></p>
      <p>Admin UI: <code>/_/admin</code></p>
      <p><a class="login" href="/_/admin">Login</a></p>
      <p>Ping endpoint: <code>/-/ping</code></p>
      <p>Whoami endpoint: <code>/-/whoami</code></p>
    </main>
  </body>
</html>`, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      'cache-control': 'no-store'
    }
  });
}

async function executeRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const staticRes = serveCloudflareStaticAsset(request, env);
  if (staticRes) return staticRes;

  if (pathname === '/' && request.method === 'GET') {
    return landing();
  }
  if (pathname === LOGIN_PATH && request.method === 'GET') {
    return new Response(null, {
      status: 302,
      headers: {
        location: ADMIN_PATH
      }
    });
  }
  if ((pathname === ADMIN_PATH || pathname.startsWith(`${ADMIN_PATH}/`)) && request.method === 'GET') {
    const auth = await authenticateRequest(request, env, {
      scope: 'read',
      path: '_/admin',
      challenge: 'basic'
    });
    if (!auth.ok) return auth.response;

    if (pathname !== ADMIN_PATH && env?.ASSETS?.fetch) {
      const res = await env.ASSETS.fetch(request);
      if (res.status !== 404) return res;
    }

    return new Response(ADMIN_SPA_HTML, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        'cache-control': 'no-store'
      }
    });
  }
  if (pathname === '/favicon.ico') return new Response(null, { status: 404 });
  if (pathname === STATUS_PATH && request.method === 'GET') {
    return handleStatus(request, env);
  }
  if (pathname === ADMIN_API_WHOAMI && request.method === 'GET') {
    return handleAdminWhoAmI(request, env);
  }
  if (pathname === ADMIN_API_PACKAGES && request.method === 'GET') {
    return handleAdminListPackages(request, env);
  }
  if (pathname === ADMIN_API_PACKAGE && request.method === 'GET') {
    return handleAdminGetPackage(request, env);
  }
  if (pathname === ADMIN_API_DIST_TAG && request.method === 'POST') {
    return handleAdminSetDistTag(request, env);
  }
  if (pathname === ADMIN_API_DELETE_VERSION && request.method === 'POST') {
    return handleAdminDeleteVersion(request, env);
  }
  if (pathname === PING_PATH && request.method === 'GET') {
    return handlePing(request, env);
  }
  if (pathname === WHOAMI_PATH && request.method === 'GET') {
    return handleWhoAmI(request, env);
  }
  if (pathname.startsWith(AUDIT_PREFIX)) {
    return handleAuditProxy(request, env);
  }

  const legacyLoginUser = parseLegacyLoginUsername(pathname);
  if (legacyLoginUser) {
    return handleLegacyLogin(request, env, legacyLoginUser);
  }

  const distTag = parseDistTagRoute(pathname);
  if (distTag) {
    if (request.method === 'GET' && !distTag.tag) {
      return handleDistTagList(request, env, distTag.pkgName);
    }
    if (request.method === 'PUT' && distTag.tag) {
      return handleDistTagUpdate(request, env, distTag.pkgName, distTag.tag);
    }
    if (request.method === 'DELETE' && distTag.tag) {
      return handleDistTagDelete(request, env, distTag.pkgName, distTag.tag);
    }
    return json({ error: 'method_not_allowed' }, 405);
  }

  const packageRev = parsePackageRevisionRoute(pathname);
  if (packageRev) {
    if (request.method === 'PUT') {
      return handlePackageRevisionWrite(request, env, packageRev.pkgName, packageRev.rev);
    }
    if (request.method === 'DELETE') {
      return handlePackageRevisionDelete(request, env, packageRev.pkgName, packageRev.rev);
    }
    return json({ error: 'method_not_allowed' }, 405);
  }

  const tarballRev = parseTarballRevisionRoute(pathname);
  if (tarballRev) {
    if (request.method === 'DELETE') {
      return handleTarballRevisionDelete(request, env, tarballRev.pkgName, tarballRev.version);
    }
    return json({ error: 'method_not_allowed' }, 405);
  }

  const tarball = parseTarballRoute(pathname);
  if (tarball && (request.method === 'GET' || request.method === 'HEAD')) {
    return handleGetTarball(request, env, tarball.pkgName, tarball.version);
  }
  const canonicalTarball = parseCanonicalTarballRoute(pathname);
  if (canonicalTarball && (request.method === 'GET' || request.method === 'HEAD')) {
    return handleGetTarball(
      request,
      env,
      canonicalTarball.pkgName,
      canonicalTarball.version,
      { upstreamPath: canonicalTarball.upstreamPath }
    );
  }

  const pkgName = parsePackageNameFromPath(pathname);
  if (!pkgName) return notFound();
  if (request.method === 'GET') {
    return handleGetMetadata(request, env, pkgName);
  }
  if (request.method === 'PUT') {
    return handlePublish(request, env, pkgName);
  }

  return json({ error: 'method_not_allowed' }, 405);
}

function createPluginContext(request, env, executionCtx) {
  const urlObj = new URL(request.url);
  return {
    request,
    env,
    executionCtx,
    path: {
      raw: urlObj.pathname.replace(/^\/+/, ''),
      resolved: urlObj.pathname,
      search: urlObj.search
    },
    meta: {
      version: 1,
      app: APP_NAME,
      platform: PLATFORM_CF
    }
  };
}

async function handleRequest(request, env, executionCtx) {
  const pluginCtxBase = createPluginContext(request, env, executionCtx);
  const preRes = await handlePluginRequest(pluginCtxBase);
  if (preRes instanceof Response) {
    return preRes;
  }

  const effectiveEnv = { ...env };
  if (preRes && typeof preRes === 'object' && preRes.env && typeof preRes.env === 'object') {
    Object.assign(effectiveEnv, preRes.env);
  }

  const response = await executeRequest(request, effectiveEnv);
  const postRes = await handlePluginResponse({
    ...pluginCtxBase,
    env: effectiveEnv,
    response
  });
  if (postRes instanceof Response) {
    return postRes;
  }
  if (postRes && typeof postRes === 'object' && postRes.response instanceof Response) {
    return postRes.response;
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      console.error('npm-registry handler error', err);
      return internalError(err?.message || 'unexpected_error');
    }
  }
};
