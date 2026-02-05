import { buildToken, checkBasic, getAuthType, getTokenFromReq, verifyToken } from './auth.js';
import { forbidden, unauthorized } from './http.js';
import { getClientIp } from './request.js';
import { getAuthRecord, isRecordBanned, recordAuthEvent } from './stats.js';
import { TOKEN_TTL_MIN } from './constants.js';

export async function requireAuth(req, {
  env,
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
      const rec = await recordAuthEvent(env, { ip, kind: 'fail', path, auth: attempted });
      const bannedNow = isRecordBanned(rec);
      if (bannedNow) return { ok: false, response: forbidden() };
    }
    return { ok: false, response: unauthorized(basicRealm) };
  }

  if (hasAuth) {
    await recordAuthEvent(env, { ip, kind: 'ok', path, auth: attempted });
  }

  const sessionToken = tokenOk ? bearerToken : await buildToken({ basicPass: pass });
  return { ok: true, token: sessionToken };
}
