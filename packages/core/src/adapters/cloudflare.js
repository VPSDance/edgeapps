/**
 * Cloudflare Pages Adapter
 * Handles static asset serving via env.ASSETS binding in Pages Functions/Advanced Mode.
 */

// Paths that should be served as static files
const STATIC_PATH_PREFIXES = ['/static/', '/assets/'];
const STATIC_EXACT_PATHS = ['/favicon.ico'];

/**
 * Checks if a pathname is a static asset request
 * @param {string} pathname 
 * @returns {boolean}
 */
export function isStaticAssetRequest(pathname) {
  if (STATIC_EXACT_PATHS.includes(pathname)) return true;
  return STATIC_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

/**
 * createCloudflareHandler
 * @param {object} app - Hono app instance
 * @returns {object} Cloudflare Pages Functions Handler (fetch method)
 */
export function createCloudflareHandler(app) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);

      // 1. Static Asset Handling (via env.ASSETS)
      // In Cloudflare Pages, we ideally let the platform handle static files,
      // but in single-worker mode (advanced), we might need to explicitely fetch them from ASSETS binding.
      if (isStaticAssetRequest(url.pathname) && env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      // 2. App Handling
      return app.fetch(request, env, ctx);
    }
  };
}
