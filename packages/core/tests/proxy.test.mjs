import test from 'node:test';
import assert from 'node:assert/strict';

import { BASES } from '../src/gh.js';
import { handleProxyRequest, rewriteRedirectLocation } from '../src/proxy.js';

test('rewriteRedirectLocation rewrites github location to proxy domain', () => {
  const location = 'https://github.com/owner/repo/releases/tag/v1.2.3';
  const rewritten = rewriteRedirectLocation(location, {
    requestUrl: 'https://proxy.example/owner/repo/releases/latest',
    currentUrl: new URL('https://github.com/owner/repo/releases/latest'),
    bases: BASES
  });
  assert.equal(rewritten, 'https://proxy.example/owner/repo/releases/tag/v1.2.3');
});

test('handleProxyRequest can return rewritten redirect for releases/latest', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: {
        location: 'https://github.com/owner/repo/releases/tag/v1.2.3'
      }
    });
  try {
    const request = new Request('https://proxy.example/owner/repo/releases/latest');
    const response = await handleProxyRequest(request, {
      url: 'https://github.com/owner/repo/releases/latest',
      bases: BASES,
      returnRedirect: true,
      rewriteRedirectToProxy: true
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://proxy.example/owner/repo/releases/tag/v1.2.3');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handleProxyRequest keeps default follow behavior when redirect return mode is disabled', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(null, {
        status: 302,
        headers: {
          location: 'https://github.com/owner/repo/releases/tag/v1.2.3'
        }
      });
    }
    return new Response('ok', { status: 200 });
  };
  try {
    const request = new Request('https://proxy.example/owner/repo/releases/latest');
    const response = await handleProxyRequest(request, {
      url: 'https://github.com/owner/repo/releases/latest',
      bases: BASES
    });
    assert.equal(calls, 2);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
