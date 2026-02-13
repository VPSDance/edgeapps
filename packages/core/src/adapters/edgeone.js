/**
 * EdgeOne Pages Adapter
 * Wraps a Hono app (or any fetch handler) to work with EdgeOne Pages functions.
 * Handles static asset fallback logic automatically.
 */

import {
  isStaticAssetRequest,
  serveEdgeOneStaticAsset
} from '../static-assets.js';

export { isStaticAssetRequest };

function ownKeysSafe(obj) {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return [];
  try {
    return Reflect.ownKeys(obj);
  } catch {
    return [];
  }
}

function readPropSafe(holder, prop) {
  if (!holder) return undefined;
  try {
    return holder[prop];
  } catch {
    return undefined;
  }
}

function resolveBinding(context, envTarget, prop) {
  if (prop === 'EDGEONE_CONTEXT') {
    return { value: context, source: 'synthetic.EDGEONE_CONTEXT' };
  }

  const candidates = [
    { source: 'context.env', obj: envTarget },
    { source: 'context.kv', obj: context.kv },
    { source: 'context.eo.env', obj: context.eo?.env },
    { source: 'context.eo.kv', obj: context.eo?.kv },
    { source: 'context.eo', obj: context.eo },
    { source: 'context', obj: context },
    { source: 'globalThis', obj: typeof globalThis !== 'undefined' ? globalThis : undefined }
  ];

  for (const item of candidates) {
    const holder = item.obj;
    if (!holder) continue;
    const value = readPropSafe(holder, prop);
    if (value !== undefined) {
      return { value, source: `${item.source}.${String(prop)}` };
    }
  }

  return { value: undefined, source: 'missing' };
}

function shouldDebug(options, context, envProxy) {
  if (options.debug) return true;

  try {
    if (context?.env?.DEBUG_EO === 'true') return true;
  } catch {
    // Some runtimes expose env as throwing proxy for unknown keys.
  }

  try {
    return envProxy?.DEBUG_EO === 'true';
  } catch {
    return false;
  }
}

function cloneResponseSafe(response) {
  try {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch {
    return response;
  }
}

function setHeaderSafe(response, key, value) {
  try {
    response.headers.set(key, value);
  } catch {
    // Ignore debug header failures to avoid breaking real responses.
  }
}

function keysCsvSafe(value) {
  return ownKeysSafe(value)
    .map((k) => (typeof k === 'symbol' ? k.toString() : String(k)))
    .join(',');
}

function appendDebugHeaders(response, context, envProxy, envTarget) {
  const newResp = cloneResponseSafe(response);
  setHeaderSafe(newResp, 'X-Debug-EO-Keys', 'enabled');

  const kvInfo = resolveBinding(context, envTarget, 'SHORT_URL_KV');
  const hasKv = Boolean(kvInfo.value);
  setHeaderSafe(newResp, 'X-Debug-EO-KV', hasKv ? 'Present' : 'Missing');
  setHeaderSafe(newResp, 'X-Debug-EO-KV-Source', kvInfo.source);

  return newResp;
}

function resolveMissingRequiredBindings(requiredBindings, context, envTarget) {
  if (!Array.isArray(requiredBindings) || requiredBindings.length === 0) {
    return [];
  }

  const missing = [];
  for (const binding of requiredBindings) {
    if (!binding) continue;
    const info = resolveBinding(context, envTarget, binding);
    if (info.value === undefined || info.value === null || info.value === '') {
      missing.push(String(binding));
    }
  }
  return missing;
}

/**
 * createEdgeOneHandler
 * @param {object} app - Hono app instance or object with fetch method
 * @param {object} options - Configuration options
 * @param {boolean} [options.debug=false] - Enable X-Debug-EO-* response headers
 * @param {string[]} [options.requiredBindings] - Required binding names for early validation
 * @returns {function} EdgeOne onRequest handler
 */
export function createEdgeOneHandler(app, options = {}) {
  return async function onRequest(context) {
    let envTarget = {};
    let env = {};

    try {
      if (!context || typeof context !== 'object') {
        return new Response('Invalid EdgeOne context object', {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
        });
      }

      if (!context.request) {
        return new Response('Missing request object in EdgeOne context', {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
        });
      }

      // 1. Static Asset Handling
      // For static asset requests, bypass the app entirely
      const staticRes = await serveEdgeOneStaticAsset(context);
      if (staticRes) {
        return staticRes;
      }

      // 2. App Handling
      // Prepare env/context for Hono via proxy to check all possible binding sources.
      envTarget = context.env && typeof context.env === 'object' ? context.env : {};
      env = new Proxy(envTarget, {
        get(target, prop) {
          return resolveBinding(context, target, prop).value;
        }
      });

      const missingBindings = resolveMissingRequiredBindings(
        options.requiredBindings,
        context,
        envTarget
      );
      if (missingBindings.length > 0) {
        const response = new Response(
          `Missing required bindings: ${missingBindings.join(', ')}`,
          {
            status: 500,
            headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
          }
        );
        return shouldDebug(options, context, env)
          ? appendDebugHeaders(response, context, env, envTarget)
          : response;
      }

      const resp = await app.fetch(context.request, env, context);

      // 3. Debug Headers (if enabled)
      if (shouldDebug(options, context, env)) {
        return appendDebugHeaders(resp, context, env, envTarget);
      }

      return cloneResponseSafe(resp);
    } catch (err) {
      const message = err?.message || String(err);
      const stack = err?.stack ? `\n${err.stack}` : '';
      const response = new Response(`Edge Function Error: ${message}${stack}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
      });

      if (shouldDebug(options, context, env)) {
        try {
          return appendDebugHeaders(response, context, env, envTarget);
        } catch {
          return response;
        }
      }
      return response;
    }
  };
}
