// Cloudflare Worker (Module Worker)

import { handleProxyEntry } from '@edgeapps/core/entry';
import { handleStatsRequest } from '@edgeapps/core/stats';
import { serveCloudflareStaticAsset } from '@edgeapps/core/static-assets';
import { APP_NAME, PLATFORM_CF } from '../meta.js';

export default {
  async fetch(request, env, _ctx) {
    return onRequest(request, env);
  }
};

async function onRequest(request, env) {
  const ghInjectToken = env?.GH_INJECT_TOKEN || '';
  const ghApiToken = env?.GH_API_TOKEN || '';
  const injectRules = env?.GH_INJECT_RULES || '';
  const basicRules = env?.BASIC_AUTH_RULES || '';
  const basicAuth = env?.BASIC_AUTH || '';
  const basicRealm = 'gh-proxy';
  const staticRes = serveCloudflareStaticAsset(request, env);
  if (staticRes) {
    return staticRes;
  }
  const urlObj = new URL(request.url);

  return handleProxyEntry({
    request,
    env,
    path: urlObj.pathname,
    search: urlObj.search,
    ghInjectToken,
    ghApiToken,
    injectRules,
    basicRules,
    basicAuth,
    basicRealm,
    statsHandler: handleStatsRequest,
    app: APP_NAME,
    platform: PLATFORM_CF
  });
}
