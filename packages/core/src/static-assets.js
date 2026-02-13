const STATIC_PATH_PREFIXES = ['/static/', '/assets/'];
const STATIC_EXACT_PATHS = ['/favicon.ico'];

export function isStaticAssetRequest(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) return false;
  if (STATIC_EXACT_PATHS.includes(pathname)) return true;
  return STATIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function getRequestPathname(request) {
  const raw = request?.url;
  if (typeof raw !== 'string' || !raw) return '/';
  try {
    return new URL(raw).pathname || '/';
  } catch {
    try {
      return new URL(raw, 'https://edgeapps.local').pathname || '/';
    } catch {
      return '/';
    }
  }
}

export function serveCloudflareStaticAsset(request, env) {
  const pathname = getRequestPathname(request);
  if (!isStaticAssetRequest(pathname)) return null;
  if (env?.ASSETS?.fetch) {
    return env.ASSETS.fetch(request);
  }
  return null;
}

export async function serveEdgeOneStaticAsset(context) {
  if (!context?.request) return null;
  const pathname = getRequestPathname(context.request);
  if (!isStaticAssetRequest(pathname)) return null;

  if (typeof context.next === 'function') {
    try {
      return await context.next();
    } catch {
      // Fall through to fetch for runtimes without next() support.
    }
  }

  try {
    return await fetch(context.request);
  } catch {
    return new Response('Static file not found', { status: 404 });
  }
}
