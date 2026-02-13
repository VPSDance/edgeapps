/**
 * Cloudflare Pages Adapter
 * Handles static asset serving via env.ASSETS binding in Pages Functions/Advanced Mode.
 */

import {
  isStaticAssetRequest,
  serveCloudflareStaticAsset
} from '../static-assets.js';

export { isStaticAssetRequest };

/**
 * createCloudflareHandler
 * @param {object} app - Hono app instance
 * @returns {object} Cloudflare Pages Functions Handler (fetch method)
 */
export function createCloudflareHandler(app) {
  return {
    async fetch(request, env, ctx) {
      // 1. Static Asset Handling (via env.ASSETS)
      // In Cloudflare Pages, we ideally let the platform handle static files,
      // but in single-worker mode (advanced), we might need to explicitely fetch them from ASSETS binding.
      const staticRes = serveCloudflareStaticAsset(request, env);
      if (staticRes) {
        return staticRes;
      }

      // 2. App Handling
      return app.fetch(request, env, ctx);
    }
  };
}
