import { buildToken, checkBasic, getAuthType, getTokenFromReq, verifyToken } from './auth.js';
import { forbidden, unauthorized } from './http.js';
import { getClientIp } from './request.js';
import { getAuthRecord, isRecordBanned, recordAuthEvent } from './stats.js';
import { TOKEN_TTL_MIN } from './constants.js';

/**
 * @typedef {Object} RequireAuthOptions
 * @property {any} [env]
 * @property {string} [path]
 * @property {string} [basicAuth]
 * @property {string} [basicRealm]
 * @property {number} [tokenTtlMinutes]
 */

/**
 * Shared auth guard with optional auth-fail stats + auto-ban (via AUTH_KV).
 * @param {Request} req
 * @param {RequireAuthOptions} [options]
 */
export async function requireAuth(req, {
  env,
  app = '',
  path = '',
  basicAuth = '',
  basicRealm = 'edgeapps',
  tokenTtlMinutes = TOKEN_TTL_MIN
} = {}) {
  const ip = getClientIp(req);
  const currentRec = await getAuthRecord(env, ip);
  if (isRecordBanned(currentRec)) {
    return { ok: false, response: forbidden() };
  }

  const attempted = getAuthType(req);
  const hasAuth = attempted !== 'none';
  const bearerToken = getTokenFromReq(req);
  const pass = basicAuth.split(':')[1] || '';
  const tokenOk = await verifyToken(bearerToken, {
    basicPass: pass,
    tokenTtlMinutes
  });
  const basicOk = !tokenOk && attempted === 'basic' && checkBasic(req, { basicAuth });

  if (!tokenOk && !basicOk) {
    if (hasAuth) {
      const rec = await recordAuthEvent(env, {
        ip,
        kind: 'fail',
        app,
        path,
        auth: attempted
      });
      const bannedNow = isRecordBanned(rec);
      if (bannedNow) return { ok: false, response: forbidden() };
    }
    return { ok: false, response: unauthorized(basicRealm) };
  }

  const sessionToken = tokenOk ? bearerToken : await buildToken({ basicPass: pass });
  return { ok: true, token: sessionToken };
}
