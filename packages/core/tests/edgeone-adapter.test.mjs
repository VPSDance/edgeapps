import test from 'node:test';
import assert from 'node:assert/strict';

import { createEdgeOneHandler } from '../src/adapters/edgeone.js';

test('edgeone adapter debug exposes global KV source', async () => {
  const original = globalThis.SHORT_URL_KV;
  globalThis.SHORT_URL_KV = {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true })
  };

  const app = {
    async fetch() {
      return new Response('ok', { status: 200 });
    }
  };

  try {
    const handler = createEdgeOneHandler(app, { debug: true });
    const res = await handler({
      request: new Request('https://short-url.edgeone.dev/_/api/links'),
      env: { ADMIN_AUTH: 'u:p' },
      eo: { geo: {}, clientIp: '1.1.1.1', uuid: 'x' }
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Debug-EO-KV'), 'Present');
    assert.equal(res.headers.get('X-Debug-EO-KV-Source'), 'globalThis.SHORT_URL_KV');
  } finally {
    if (original === undefined) {
      delete globalThis.SHORT_URL_KV;
    } else {
      globalThis.SHORT_URL_KV = original;
    }
  }
});

test('edgeone adapter returns 500 when request is missing', async () => {
  const app = {
    async fetch() {
      return new Response('ok', { status: 200 });
    }
  };

  const handler = createEdgeOneHandler(app, { debug: true });
  const res = await handler({ env: {} });
  const body = await res.text();

  assert.equal(res.status, 500);
  assert.match(body, /Missing request object/i);
});

test('edgeone adapter validates required bindings early', async () => {
  const app = {
    async fetch() {
      return new Response('ok', { status: 200 });
    }
  };

  const handler = createEdgeOneHandler(app, {
    debug: true,
    requiredBindings: ['SHORT_URL_KV', 'ADMIN_AUTH']
  });
  const res = await handler({
    request: new Request('https://short-url.edgeone.dev/_/api/links'),
    env: { ADMIN_AUTH: 'u:p' },
    eo: { geo: {}, clientIp: '1.1.1.1', uuid: 'x' }
  });
  const body = await res.text();

  assert.equal(res.status, 500);
  assert.match(body, /Missing required bindings: SHORT_URL_KV/);
  assert.equal(res.headers.get('X-Debug-EO-KV'), 'Missing');
});

test('edgeone adapter tolerates env getter errors when debug disabled', async () => {
  const app = {
    async fetch() {
      return new Response('ok', { status: 200 });
    }
  };

  const throwingEnv = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'DEBUG_EO') {
          throw new Error('env getter blocked');
        }
        return undefined;
      },
      has() {
        return false;
      }
    }
  );

  const handler = createEdgeOneHandler(app, { requiredBindings: [] });
  const res = await handler({
    request: new Request('https://short-url.edgeone.dev/'),
    env: throwingEnv,
    eo: {}
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Debug-EO-KV'), null);
});
