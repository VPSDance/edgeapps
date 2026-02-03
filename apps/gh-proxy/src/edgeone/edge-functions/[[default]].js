import { handleProxyEntry } from '@edgeapps/core/entry';
import { handleStatsRequest } from '@edgeapps/core/stats';
import { APP_NAME, PLATFORM_EO } from '../../meta.js';

export default async function onRequest(context) {
  const { request } = context;
  const baseEnv = context?.env || {};
  const globalEnv = globalThis || {};
  const env = {
    ...baseEnv,
    AUTH_STATS: baseEnv.AUTH_STATS ?? globalEnv.AUTH_STATS,
    GH_ALLOW_KV: baseEnv.GH_ALLOW_KV ?? globalEnv.GH_ALLOW_KV,
    GH_TOKEN: baseEnv.GH_TOKEN ?? globalEnv.GH_TOKEN,
    BASIC_AUTH: baseEnv.BASIC_AUTH ?? globalEnv.BASIC_AUTH,
    BASIC_REALM: baseEnv.BASIC_REALM ?? globalEnv.BASIC_REALM
  };
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
    platform: PLATFORM_EO
  });
}
