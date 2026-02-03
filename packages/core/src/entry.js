import { requireAuth } from './auth-guard.js';
import { buildGhBases } from './gh-bases.js';
import { isGitPath, parseTarget } from './gh.js';
import { authorizeTarget } from './guard.js';
import { forbidden, textResponse } from './http.js';
import { renderLanding } from './landing.js';
import { DEFAULT_OWNERS, parseOwners } from './owners.js';
import {
  GIT_HEADER_ALLOWLIST,
  handleProxyRequest,
  hasUserInfo,
  resolveAliasTarget
} from './proxy.js';
import { handlePluginRequest, handlePluginResponse } from '@edgeapps/core/plugins';
import { getClientIpInfo } from './request.js';

export async function handleProxyEntry({
  request,
  env,
  path = '',
  search = '',
  ghInjectToken = '',
  ghApiToken = '',
  injectRules = '',
  basicAuth = '',
  basicRealm = 'edgeapps',
  statsHandler,
  app = '',
  platform = ''
} = {}) {
  if (!request) return forbidden();
  if (statsHandler) {
    try {
      const statsRes = await statsHandler(request, env, {
        basicAuth,
        basicRealm
      });
      if (statsRes) return statsRes;
    } catch (err) {
      console.error('stats handler error', err);
      return textResponse('Internal Error', 500);
    }
  }

  const pathRaw = String(path || '').replace(/^\/+/, '');
  if (!pathRaw) {
    return renderLanding(env);
  }
  if (pathRaw === 'ip') {
    const info = getClientIpInfo(request);
    return new Response(info.ip, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=UTF-8',
        'x-ip-source': info.source,
        'access-control-allow-origin': '*'
      }
    });
  }

  function mergeTokenInject(base, extra) {
    const out = [];
    const seen = new Set();
    for (const item of [...(base || []), ...(extra || [])]) {
      const key = String(item || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  function buildTokenInjectSet(value) {
    const entries = new Set();
    for (const item of parseOwners(value)) {
      entries.add(item);
    }
    return entries;
  }

  function matchesTokenInject(target, injectSet) {
    if (!injectSet || injectSet.size === 0) return false;
    const entries = new Set();
    if (target?.owner) entries.add(target.owner);
    if (target?.owner && target?.repo) entries.add(`${target.owner}/${target.repo}`);
    if (target?.owner && target?.gistId)
      entries.add(`${target.owner}/${target.gistId}`);
    return [...entries].some((entry) => injectSet.has(entry));
  }

  function injectRawTokenUrl(urlStr, rawBase, token) {
    if (!token || !urlStr) return urlStr;
    try {
      const url = new URL(urlStr);
      const rawHost = new URL(rawBase).host;
      if (url.host !== rawHost) return urlStr;
      url.username = token;
      url.password = '';
      return url.toString();
    } catch {
      return urlStr;
    }
  }

  let rawToken = ghInjectToken || env?.GH_INJECT_TOKEN || '';
  let apiToken = ghApiToken || env?.GH_API_TOKEN || '';
  let injectEntries = parseOwners(injectRules || env?.GH_INJECT_RULES);
  let injectSet = buildTokenInjectSet(injectEntries);
  let ghBases = buildGhBases();
  let resolved = resolveAliasTarget(pathRaw, { bases: ghBases });
  let target = parseTarget(resolved, ghBases);
  let injectMatch = matchesTokenInject(target, injectSet);
  let extraOwners = [];
  let extraTokenInject = [];

  if (handlePluginRequest) {
    const pluginRes = await handlePluginRequest({
      request,
      env,
      path: {
        raw: pathRaw,
        resolved,
        search
      },
      auth: {
        ghInjectToken: rawToken,
        ghApiToken: apiToken,
        basicAuth
      },
      bases: ghBases,
      target,
      meta: {
        version: 1,
        app,
        platform
      }
    });
    if (pluginRes) {
      if (pluginRes instanceof Response) return pluginRes;
      if (typeof pluginRes === 'object') {
        let needsRecalc = false;
        let hasResolvedOverride = false;
        if (pluginRes.env && typeof pluginRes.env === 'object') {
          Object.assign(env, pluginRes.env);
          needsRecalc = true;
        }
        if (pluginRes.resolvedPath && typeof pluginRes.resolvedPath === 'string') {
          resolved = pluginRes.resolvedPath;
          hasResolvedOverride = true;
        }
        if (Array.isArray(pluginRes.extraOwners)) {
          extraOwners = extraOwners.concat(pluginRes.extraOwners);
        }
        if (pluginRes.extraTokenInject) {
          extraTokenInject = parseOwners(pluginRes.extraTokenInject);
          needsRecalc = true;
        }
        if (needsRecalc) {
          rawToken = ghInjectToken || env?.GH_INJECT_TOKEN || '';
          apiToken = ghApiToken || env?.GH_API_TOKEN || '';
          injectEntries = mergeTokenInject(
            parseOwners(injectRules || env?.GH_INJECT_RULES),
            extraTokenInject
          );
          injectSet = buildTokenInjectSet(injectEntries);
          ghBases = buildGhBases();
          if (!hasResolvedOverride) {
            resolved = resolveAliasTarget(pathRaw, { bases: ghBases });
          }
          target = parseTarget(resolved, ghBases);
          injectMatch = matchesTokenInject(target, injectSet);
        }
      }
    }
  }

  const defaultOwners = DEFAULT_OWNERS.concat(extraOwners);
  const auth = await authorizeTarget(resolved, { env, defaultOwners });
  if (!auth.ok || !auth.upstreamUrl) return forbidden();

  const requiresAuth = hasUserInfo(auth.upstreamUrl);
  let issueToken = '';
  if (requiresAuth) {
    const authRes = await requireAuth(request, {
      env,
      path: pathRaw,
      basicAuth,
      basicRealm
    });
    if (!authRes.ok) return authRes.response;
    issueToken = authRes.token || '';
  }

  let upstreamUrl = `${auth.upstreamUrl}${search || ''}`;
  if (auth.kind === 'raw' && injectMatch && rawToken) {
    upstreamUrl = injectRawTokenUrl(upstreamUrl, ghBases.raw, rawToken);
  }
  const isGit = auth.kind === 'github' && isGitPath(auth.pathParts);
  const authToken =
    auth.kind === 'api'
      ? apiToken
      : auth.kind === 'gist'
        ? injectMatch
          ? rawToken
          : ''
        : '';
  const response = await handleProxyRequest(request, {
    url: upstreamUrl,
    authToken,
    authScheme: isGit ? 'basic' : 'bearer',
    allowlist: isGit ? GIT_HEADER_ALLOWLIST : undefined,
    injectToken: requiresAuth && Boolean(issueToken),
    token: issueToken
  });

  if (handlePluginResponse) {
    const pluginRes = await handlePluginResponse({
      request,
      env,
      path: {
        raw: pathRaw,
        resolved,
        search
      },
      auth: {
        ghInjectToken: rawToken,
        ghApiToken: apiToken,
        basicAuth
      },
      bases: ghBases,
      target,
      authResult: auth,
      proxy: {
        upstreamUrl,
        requiresAuth,
        injectToken: requiresAuth && Boolean(issueToken),
        issueToken,
        authToken,
        kind: auth.kind,
        isGit
      },
      response,
      meta: {
        version: 1,
        app,
        platform
      }
    });
    if (pluginRes) {
      if (pluginRes instanceof Response) return pluginRes;
      if (typeof pluginRes === 'object' && pluginRes.response instanceof Response) {
        return pluginRes.response;
      }
    }
  }

  return response;
}
