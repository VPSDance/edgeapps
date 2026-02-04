import { handleProxyEntry } from '@edgeapps/core/entry';
import { handleStatsRequest } from '@edgeapps/core/stats';
import { APP_NAME, PLATFORM_EO } from '../../meta.js';

export default async function onRequest(context) {
  const { request } = context;
  const baseEnv = context?.env || {};
  const globalEnv = globalThis || {};
  const env = {
    ...baseEnv,
    GH_KV: baseEnv.GH_KV ?? globalEnv.GH_KV,
    GH_INJECT_TOKEN: baseEnv.GH_INJECT_TOKEN ?? globalEnv.GH_INJECT_TOKEN,
    GH_API_TOKEN: baseEnv.GH_API_TOKEN ?? globalEnv.GH_API_TOKEN,
    GH_INJECT_RULES: baseEnv.GH_INJECT_RULES ?? globalEnv.GH_INJECT_RULES,
    BASIC_AUTH_RULES: baseEnv.BASIC_AUTH_RULES ?? globalEnv.BASIC_AUTH_RULES,
    BASIC_AUTH: baseEnv.BASIC_AUTH ?? globalEnv.BASIC_AUTH
  };
  const ghInjectToken = env?.GH_INJECT_TOKEN || '';
  const ghApiToken = env?.GH_API_TOKEN || '';
  const injectRules = env?.GH_INJECT_RULES || '';
  const basicRules = env?.BASIC_AUTH_RULES || '';
  const basicAuth = env?.BASIC_AUTH || '';
  const basicRealm = 'gh-proxy';
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
    platform: PLATFORM_EO
  });
}
