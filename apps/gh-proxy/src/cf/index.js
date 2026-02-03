// Cloudflare Worker (Module Worker)

import { handleProxyEntry } from '@edgeapps/core/entry';
import { handleStatsRequest } from '@edgeapps/core/stats';
import { APP_NAME, PLATFORM_CF } from '../meta.js';

export default {
  async fetch(request, env, _ctx) {
    return onRequest(request, env);
  }
};

async function onRequest(request, env) {
  const ghToken = env?.GH_TOKEN || '';
  const basicAuth = env?.BASIC_AUTH || '';
  const basicRealm = env?.BASIC_REALM || 'gh-proxy';
  const urlObj = new URL(request.url);

  return handleProxyEntry({
    request,
    env,
    path: urlObj.pathname,
    search: urlObj.search,
    ghToken,
    basicAuth,
    basicRealm,
    statsHandler: handleStatsRequest,
    app: APP_NAME,
    platform: PLATFORM_CF
  });
}
