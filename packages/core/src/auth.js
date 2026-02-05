const tokenEncoder = new TextEncoder();

function tokenKey(basicPass) {
  return basicPass || 'edgeapps';
}

async function hashStr(str) {
  const buf = await crypto.subtle.digest('SHA-256', tokenEncoder.encode(str));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export function checkBasic(req, { basicAuth }) {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Basic ')) return false;
  try {
    const decoded = atob(auth.slice(6));
    return decoded === basicAuth;
  } catch {
    return false;
  }
}

export async function buildToken({ basicPass }) {
  const ts = Date.now();
  const sig = await hashStr(`${tokenKey(basicPass)}:${ts}`);
  return `${ts}.${sig}`;
}

export async function verifyToken(token, { basicPass, tokenTtlMinutes }) {
  if (!token) return false;
  const [tsStr, sig] = token.split('.');
  if (!tsStr || !sig) return false;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  const age = Date.now() - ts;
  if (age < 0 || age > tokenTtlMinutes * 60 * 1000) return false;
  const expect = await hashStr(`${tokenKey(basicPass)}:${ts}`);
  return sig === expect;
}

export function getTokenFromReq(req) {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

export function getAuthType(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return 'token';
  if (auth.startsWith('Basic ')) return 'basic';
  return 'none';
}
