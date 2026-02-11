/**
 * EdgeOne Pages Adapter
 * Wraps a Hono app (or any fetch handler) to work with EdgeOne Pages functions.
 * Handles static asset fallback logic automatically.
 */

// Paths that should be served as static files by EdgeOne Pages
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
 * createEdgeOneHandler
 * @param {object} app - Hono app instance or object with fetch method
 * @param {object} options - Configuration options
 * @returns {function} EdgeOne onRequest handler
 */
export function createEdgeOneHandler(app, options = {}) {
  return async function onRequest(context) {
    const url = new URL(context.request.url);

    // 1. Static Asset Handling
    // For static asset requests, bypass the app entirely
    if (isStaticAssetRequest(url.pathname)) {
      // Try context.next() first (standard Pages way to serve static files)
      if (typeof context.next === 'function') {
        try {
          return await context.next();
        } catch {
          // next() failed, fall through to fetch
        }
      }
      // Fallback: fetch the URL directly from origin (EdgeOne static file layer)
      try {
        return await fetch(context.request);
      } catch {
        return new Response('Static file not found', { status: 404 });
      }
    }

    // 2. App Handling
    try {
      // Prepare env/context for Hono
      // We pass the whole context as env, or user can specify how to map it in options
      // But Hono usually expects 'env' as second arg to fetch.
      // In our app code: app.fetch(request, env, context)
      // Here we pass context.kv and context.env merged.
      
      // Prepare env via Proxy to check all possible sources (env, kv, globalThis)
      // This solves issues where bindings might be in global scope or context.kv depending on runtime version
      const env = new Proxy(context.env || {}, {
        get(target, prop) {
          // 1. Check context.env
          if (prop in target) return target[prop];
          // 2. Check context.kv
          if (context.kv && prop in context.kv) return context.kv[prop]; // @ts-ignore
          // 2.5 Check context root (direct binding)
          if (prop in context) return context[prop];
          // 3. Check globalThis (for legacy bindings or some runtime quirks)
          if (typeof globalThis !== 'undefined' && prop in globalThis) return globalThis[prop];
          // 4. Fallback helpers
          if (prop === 'EDGEONE_CONTEXT') return context;
          return undefined;
        },
        // Make it work with Object.keys() / spread (partial support)
        ownKeys(target) {
          return Array.from(new Set([
            ...Reflect.ownKeys(target),
            ...(context.kv ? Reflect.ownKeys(context.kv) : []),
            'EDGEONE_CONTEXT'
          ]));
        },
        getOwnPropertyDescriptor(target, prop) {
           // Basic descriptor to satisfy spread
           return { enumerable: true, configurable: true };
        }
      });

      const resp = await app.fetch(context.request, env, context);
      
      // 3. Debug Headers (if enabled)
      // We can check a specific env var or passed option
      if (options.debug || context.env?.DEBUG_EO === 'true') {
        const newResp = new Response(resp.body, resp);
        newResp.headers.set('X-Debug-EO-Keys', Object.keys(context).join(','));
        // Check if the Proxy found it anywhere
        const hasKV = Boolean(env.SHORT_URL_KV);
        newResp.headers.set('X-Debug-EO-KV', hasKV ? 'Present' : 'Missing');
        
        // Detailed debug for SHORT_URL_KV specific location
        if (typeof globalThis !== 'undefined') {
             const gKV = globalThis['SHORT_URL_KV'];
             const cKV = context['SHORT_URL_KV'];
             newResp.headers.set('X-Debug-EO-Global-DIRECT', gKV ? 'Found' : (cKV ? 'FoundInContext' : 'Missing'));
             // List all globals via getOwnPropertyNames to see non-enumerables
             const allGlobals = Object.getOwnPropertyNames(globalThis).filter(k => k.includes('SHORT') || k.includes('KV'));
             if (allGlobals.length > 0) {
                 newResp.headers.set('X-Debug-EO-Global-Keys', allGlobals.join(','));
             }
        }
        if (context.env) {
          newResp.headers.set('X-Debug-EO-Env', Object.keys(context.env).join(','));
        }
        return newResp;
      }
      
      return resp;
    } catch (err) {
      return new Response(`Edge Function Error: ${err.message}\n${err.stack}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  };
}
