import { requireAuth } from './auth-guard.js';
import { buildGhBases } from './gh-bases.js';
import { parseTarget } from './gh.js';
import { authorizeTarget } from './guard.js';
import { forbidden, textResponse } from './http.js';
import { renderLanding } from './landing.js';
import { DEFAULT_OWNERS } from './owners.js';
import { handleProxyRequest, hasUserInfo, resolveAliasTarget } from './proxy.js';
import { handlePluginRequest, handlePluginResponse } from '@edgeapps/core/plugins';
import { getClientIpInfo } from './request.js';

export async function handleProxyEntry({
  request,
  env,
  path = '',
  search = '',
  ghToken = '',
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

  const ghBases = buildGhBases(ghToken);
  let resolved = resolveAliasTarget(pathRaw, { bases: ghBases });
  let target = parseTarget(resolved, ghBases);
  let extraOwners = [];

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
        ghToken,
        basicAuth,
        basicRealm
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
        if (pluginRes.env && typeof pluginRes.env === 'object') {
          Object.assign(env, pluginRes.env);
        }
        if (pluginRes.resolvedPath && typeof pluginRes.resolvedPath === 'string') {
          resolved = pluginRes.resolvedPath;
          target = parseTarget(resolved, ghBases);
        }
        if (Array.isArray(pluginRes.extraOwners)) {
          extraOwners = extraOwners.concat(pluginRes.extraOwners);
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

  const upstreamUrl = `${auth.upstreamUrl}${search || ''}`;
  const authToken = auth.kind === 'api' ? ghToken : '';
  const response = await handleProxyRequest(request, {
    url: upstreamUrl,
    authToken,
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
        ghToken,
        basicAuth,
        basicRealm
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
        kind: auth.kind
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
