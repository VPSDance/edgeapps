import { requireAuth } from './auth-guard.js';
import { buildGhBases } from './gh-bases.js';
import { isGitPath, parseTarget } from './gh.js';
import { authorizeTarget } from './guard.js';
import { forbidden, textResponse } from './http.js';
import { renderLanding } from './landing.js';
import { DEFAULT_OWNERS, parseOwners } from './owners.js';
import {
  DEFAULT_HEADER_ALLOWLIST,
  GIT_HEADER_ALLOWLIST,
  getUserInfoToken,
  handleProxyRequest,
  resolveAliasTarget
} from './proxy.js';
import { handlePluginRequest, handlePluginResponse } from '@edgeapps/core/plugins';
import { getClientIpInfo } from './request.js';

function mergeRules(base, extra) {
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

function buildRuleSet(value) {
  const entries = new Set();
  for (const item of parseOwners(value)) {
    entries.add(item);
  }
  return entries;
}

function matchesRuleSet(target, ruleSet) {
  if (!ruleSet || ruleSet.size === 0) return false;
  if (ruleSet.has('*')) return true;
  const entries = new Set();
  if (target?.owner) entries.add(target.owner);
  if (target?.owner && target?.repo) entries.add(`${target.owner}/${target.repo}`);
  if (target?.owner && target?.gistId) entries.add(`${target.owner}/${target.gistId}`);
  return [...entries].some((entry) => ruleSet.has(entry));
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

function buildResolvedState({
  env,
  ghInjectToken,
  ghApiToken,
  injectRules,
  basicRules,
  extraTokenInject,
  extraBasicRules,
  pathRaw,
  resolvedOverride
}) {
  const rawToken = ghInjectToken || env?.GH_INJECT_TOKEN || '';
  const apiToken = ghApiToken || env?.GH_API_TOKEN || '';
  const injectEntries = mergeRules(
    parseOwners(injectRules || env?.GH_INJECT_RULES),
    extraTokenInject
  );
  const basicEntries = mergeRules(
    parseOwners(basicRules || env?.BASIC_AUTH_RULES),
    extraBasicRules
  );
  const injectSet = buildRuleSet(injectEntries);
  const basicSet = buildRuleSet(basicEntries);
  const ghBases = buildGhBases();
  const resolved = resolvedOverride || resolveAliasTarget(pathRaw, { bases: ghBases });
  const target = parseTarget(resolved, ghBases);
  const injectMatch = matchesRuleSet(target, injectSet);
  const basicMatch = matchesRuleSet(target, basicSet);
  return { rawToken, apiToken, ghBases, resolved, target, injectMatch, basicMatch };
}

function buildProxyAllowlist({ isGit, hasAuthHeader, requiresAuth }) {
  if (isGit) return GIT_HEADER_ALLOWLIST;
  if (hasAuthHeader && !requiresAuth) {
    return [...DEFAULT_HEADER_ALLOWLIST, 'authorization'];
  }
  return DEFAULT_HEADER_ALLOWLIST;
}

export async function handleProxyEntry({
  request,
  env,
  path = '',
  search = '',
  ghInjectToken = '',
  ghApiToken = '',
  injectRules = '',
  basicRules = '',
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
  const reqUserToken = getUserInfoToken(request.url);
  if (pathRaw === '_/ip') {
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
  if (pathRaw === '_/auth') {
    if (!basicAuth) {
      return textResponse('Missing env BASIC_AUTH', 500);
    }
    const authRes = await requireAuth(request, {
      env,
      path: pathRaw,
      basicAuth,
      basicRealm
    });
    if (!authRes.ok) return authRes.response;
    return textResponse('OK', 200);
  }

  let { rawToken, apiToken, ghBases, resolved, target, injectMatch, basicMatch } =
    buildResolvedState({
      env,
      ghInjectToken,
      ghApiToken,
      injectRules,
      basicRules,
      extraTokenInject: [],
      extraBasicRules: [],
      pathRaw
    });
  let extraOwners = [];
  let extraTokenInject = [];
  let extraBasicRules = [];

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
        let resolvedOverride = '';
        if (pluginRes.env && typeof pluginRes.env === 'object') {
          Object.assign(env, pluginRes.env);
          needsRecalc = true;
        }
        if (pluginRes.resolvedPath && typeof pluginRes.resolvedPath === 'string') {
          resolved = pluginRes.resolvedPath;
          resolvedOverride = pluginRes.resolvedPath;
          // Recompute target/inject rules because alias changed the resolved path.
          needsRecalc = true;
        }
        if (Array.isArray(pluginRes.extraOwners)) {
          extraOwners = extraOwners.concat(pluginRes.extraOwners);
        }
        if (pluginRes.extraTokenInject) {
          extraTokenInject = parseOwners(pluginRes.extraTokenInject);
          needsRecalc = true;
        }
        if (pluginRes.extraBasicRules) {
          extraBasicRules = parseOwners(pluginRes.extraBasicRules);
          needsRecalc = true;
        }
        if (needsRecalc) {
          ({
            rawToken,
            apiToken,
            ghBases,
            resolved,
            target,
            injectMatch,
            basicMatch
          } = buildResolvedState({
            env,
            ghInjectToken,
            ghApiToken,
            injectRules,
            basicRules,
            extraTokenInject,
            extraBasicRules,
            pathRaw,
            resolvedOverride
          }));
        }
      }
    }
  }

  const defaultOwners = DEFAULT_OWNERS.concat(extraOwners);
  const auth = await authorizeTarget(resolved, { env, defaultOwners });
  if (!auth.ok || !auth.upstreamUrl) return forbidden();

  if (basicMatch && !basicAuth) {
    return textResponse('Missing env BASIC_AUTH', 500);
  }
  const requiresAuth = basicMatch;
  let sessionToken = '';
  if (requiresAuth) {
    const authRes = await requireAuth(request, {
      env,
      path: pathRaw,
      basicAuth,
      basicRealm
    });
    if (!authRes.ok) return authRes.response;
    sessionToken = authRes.token || '';
  }

  let upstreamUrl = `${auth.upstreamUrl}${search || ''}`;
  if (auth.kind === 'raw' && injectMatch && rawToken) {
    upstreamUrl = injectRawTokenUrl(upstreamUrl, ghBases.raw, rawToken);
  }
  const isGit = auth.kind === 'github' && isGitPath(auth.pathParts);
  const isGithubReleaseLatest =
    auth.kind === 'github' &&
    auth.pathParts?.[2] === 'releases' &&
    auth.pathParts?.[3] === 'latest';
  const hasAuthHeader = request.headers.has('authorization') && !requiresAuth;
  const allowlist = buildProxyAllowlist({ isGit, hasAuthHeader, requiresAuth });
  const authToken =
    auth.kind === 'api'
      ? apiToken
      : auth.kind === 'github'
        ? reqUserToken
        : '';
  const authScheme = auth.kind === 'raw' || isGit ? 'basic' : 'bearer';
  const response = await handleProxyRequest(request, {
    url: upstreamUrl,
    bases: ghBases,
    authToken,
    authScheme,
    ignoreAuthHeader: requiresAuth,
    allowlist,
    returnRedirect: isGithubReleaseLatest,
    rewriteRedirectToProxy: isGithubReleaseLatest,
    // Git needs upstream 401/403 + WWW-Authenticate to retry with credentials.
    onUpstreamError: isGit ? null : undefined,
    injectToken: requiresAuth && Boolean(sessionToken),
    token: sessionToken
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
        injectToken: requiresAuth && Boolean(sessionToken),
        sessionToken,
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
